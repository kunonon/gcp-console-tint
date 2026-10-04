import { z } from 'zod';
import { Color } from '../../domain/color';
import { ColorSelection } from '../../domain/color-selection';
import { Palette, PaletteEntry, PaletteEntryId } from '../../domain/palette';
import { isMatchType, MATCH_TYPES, type MatchType, ProjectRule, ProjectRuleId } from '../../domain/project-rule';
import {
  PlatformBarSettings,
  PlatformBarTextSettings,
  ProjectSettings,
  TopBarSettings,
} from '../../domain/project-settings';
import { TintSettings } from '../../domain/tint-settings';
import { TopBarHeight } from '../../domain/top-bar-height';
import { SettingsImportError, type SettingsImportIssue } from '../../port/settings-store';
import { runMigrations, SCHEMA_MIGRATIONS, SCHEMA_MIN_VERSION, type SchemaMigration } from './migrations';
import { compareVersions, VersionComparisonResult } from './version';

// The import format: the same JSON shape settings-repository's toStored() writes, read back
// STRICTLY. Where toDomain() repairs corrupt storage field by field, an imported file is the
// user's own input: every field the exporter writes must be there with the right type and a
// usable value, and anything else is refused with the reason and the offending paths, so the
// user can fix the file instead of silently getting defaults back.
//
// The two validation stages are deliberately split:
//   1. STRUCTURE (checkStructure, with the Zod schemas below) — required keys and JSON types only. No enums, ranges
//      or formats live here; that would put the domain's rules in the adapter.
//   2. VALUES (toRules) — every value is handed to the domain factory that owns it
//      (Color.fromHex, TopBarHeight.fromPixels, isMatchType), and a rejection becomes an issue.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Stage 1. `z.object` ignores unknown keys within the supported schema version range.
// Stamps above this build's effective schema version ceiling are rejected before validation.
const colorSelectionSchema = z.object({
  // JSON has no undefined: an unset palette reference is written as null.
  paletteId: z.string().nullable(),
  custom: z.string(),
});

const paletteEntrySchema = z.object({ id: z.string(), name: z.string(), color: z.string() });

// One rule WITHOUT the contents of palette.entries. projectRules and palette.entries are walked
// element by element (see checkStructure) so validation can stop at the 101st issue without
// reading any element after it; handing a whole array to Zod would read every element first.
const ruleShellSchema = z.object({
  id: z.string(),
  matchType: z.string(),
  pattern: z.string(),
  settings: z.object({
    palette: z.object({ enabled: z.boolean() }),
    topBar: z.object({
      enabled: z.boolean(),
      color: colorSelectionSchema,
      height: z.number(),
      stripes: z.boolean(),
    }),
    platformBar: z.object({ enabled: z.boolean(), color: colorSelectionSchema, stripes: z.boolean() }),
    platformBarText: z.object({ enabled: z.boolean(), color: colorSelectionSchema, auto: z.boolean() }),
  }),
});

// Diagnoses, in Zod's own wording, a value that should have been an array. Only ever given a
// non-array: a real array would have every element read.
const arrayDiagnosis = z.array(z.unknown());

type PaletteEntryFile = z.infer<typeof paletteEntrySchema>;
type RuleFile = z.infer<typeof ruleShellSchema> & { settings: { palette: { entries: PaletteEntryFile[] } } };

// Each stage keeps at most this many issues, so a file that is wrong everywhere is neither
// walked nor reported in full.
const MAX_ISSUES = 100;

// Thrown by an issue collector instead of keeping the issue past MAX_ISSUES, and caught only by
// the stage that owns that collector, so validation stops on the spot.
class ValidationStopped {}

function issueCollector(issues: SettingsImportIssue[]) {
  return (path: string, message: string) => {
    if (issues.length === MAX_ISSUES) throw new ValidationStopped();
    issues.push({ path, message });
  };
}

// A Zod path as it reads in the file: `projectRules[1].settings.topBar.height`.
function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`),
    '',
  );
}

// Stage 1, walked element by element. Issues come out in exactly the order one Zod schema over
// the whole file would list them (its shape order, whatever the file's key order), so the 100
// kept and the 101st that stops validation are the ones that schema would list first. Per rule
// that order is: the fields before palette.entries, then the entries, then the rest of settings,
// so the shell's issues are split around the entries by their rule-relative path. Every array
// element is read exactly once, and only Zod's parsed (unknown-key-stripped) data is returned.
function checkStructure(data: unknown, reject: (path: string, message: string) => void): RuleFile[] {
  const rejectAll = (at: readonly PropertyKey[], issues: readonly z.core.$ZodIssue[] = []) => {
    for (const issue of issues) reject(issuePath([...at, ...issue.path]), issue.message);
  };
  // Under settings, everything but the palette sorts after palette.entries.
  const isAfterEntries = (issue: z.core.$ZodIssue) =>
    issue.path[0] === 'settings' && issue.path.length > 1 && issue.path[1] !== 'palette';

  if (!isRecord(data)) {
    rejectAll([], z.object({}).safeParse(data).error?.issues);
    return [];
  }
  const projectRules = data.projectRules;
  if (!Array.isArray(projectRules)) {
    rejectAll(['projectRules'], arrayDiagnosis.safeParse(projectRules).error?.issues);
    return [];
  }

  const rules: RuleFile[] = [];
  for (let index = 0; index < projectRules.length; index++) {
    const rule: unknown = projectRules[index];
    const at = ['projectRules', index];
    const shell = ruleShellSchema.safeParse(rule);
    const shellIssues = shell.error?.issues ?? [];
    rejectAll(
      at,
      shellIssues.filter((issue) => !isAfterEntries(issue)),
    );

    // A rule, settings or palette that is not an object is already one issue above; its entries
    // are neither read nor reported.
    const settings = isRecord(rule) ? rule.settings : undefined;
    const palette = isRecord(settings) ? settings.palette : undefined;
    let entries: PaletteEntryFile[] | undefined;
    if (isRecord(palette)) {
      const entriesAt = [...at, 'settings', 'palette', 'entries'];
      const rawEntries = palette.entries;
      if (Array.isArray(rawEntries)) {
        entries = [];
        for (let entryIndex = 0; entryIndex < rawEntries.length; entryIndex++) {
          const entry = paletteEntrySchema.safeParse(rawEntries[entryIndex]);
          if (entry.success) entries.push(entry.data);
          else rejectAll([...entriesAt, entryIndex], entry.error.issues);
        }
      } else {
        rejectAll(entriesAt, arrayDiagnosis.safeParse(rawEntries).error?.issues);
      }
    }

    rejectAll(at, shellIssues.filter(isAfterEntries));
    if (shell.success && entries) {
      const { palette: shellPalette, ...otherSettings } = shell.data.settings;
      rules.push({ ...shell.data, settings: { ...otherSettings, palette: { ...shellPalette, entries } } });
    }
  }
  return rules;
}

// Stage 2. Builds the domain objects, asking the domain to judge every value and collecting the
// rejections instead of throwing at the first one, so a file reports everything wrong with it in
// one pass. A rejected value is replaced by a placeholder here purely to keep building: the
// returned rules are used only when no issue was collected. Values are judged in a fixed order
// (per rule: matchType, each palette entry's duplicate id then color, topBar color and height,
// platformBar color, platformBarText color); the judgment that yields the 101st issue stops
// validation on the spot, and no partial rules are returned.
function toRules(fileRules: readonly RuleFile[]): {
  rules: ProjectRule[];
  issues: SettingsImportIssue[];
  validationStopped: boolean;
} {
  const issues: SettingsImportIssue[] = [];
  const reject = issueCollector(issues);

  const color = (value: string, path: string): Color => {
    const parsed = Color.fromHex(value);
    if (parsed) return parsed;
    reject(path, 'expected a color like #rrggbb');
    return Color.BLACK;
  };

  const matchType = (value: string, path: string): MatchType => {
    if (isMatchType(value)) return value;
    reject(path, `expected one of ${MATCH_TYPES.join(', ')}`);
    return 'exact';
  };

  const height = (value: number, path: string): TopBarHeight => {
    const parsed = TopBarHeight.fromPixels(value);
    if (parsed) return parsed;
    reject(path, `expected an integer from ${TopBarHeight.MIN.toPixels()} to ${TopBarHeight.MAX.toPixels()}`);
    return TopBarHeight.MIN;
  };

  // Ids are opaque strings to the domain (recreate() takes any string, including an empty one),
  // so there is no value rule to apply here. A paletteId naming no entry of the rule's own
  // palette is NOT an issue either: the domain treats a dangling reference as legal and falls
  // back to the custom color (see Palette.resolve). Palette-local id uniqueness is checked
  // below as an import-file constraint, without changing domain ids or storage recovery.
  const selection = (value: { paletteId: string | null; custom: string }, path: string): ColorSelection =>
    new ColorSelection(
      value.paletteId === null ? undefined : PaletteEntryId.recreate(value.paletteId),
      color(value.custom, `${path}.custom`),
    );

  let rules: ProjectRule[];
  try {
    rules = fileRules.map((rule, index) => {
      const at = `projectRules[${index}]`;
      const settingsAt = `${at}.settings`;
      const { palette, topBar, platformBar, platformBarText } = rule.settings;
      const paletteEntryIds = new Set<string>();
      return ProjectRule.recreate(
        ProjectRuleId.recreate(rule.id),
        matchType(rule.matchType, `${at}.matchType`),
        rule.pattern,
        new ProjectSettings(
          new Palette(
            palette.enabled,
            palette.entries.map((entry, entryIndex) => {
              const entryAt = `${settingsAt}.palette.entries[${entryIndex}]`;
              if (paletteEntryIds.has(entry.id)) reject(`${entryAt}.id`, 'duplicate palette entry id');
              paletteEntryIds.add(entry.id);
              return PaletteEntry.recreate(
                PaletteEntryId.recreate(entry.id),
                entry.name,
                color(entry.color, `${entryAt}.color`),
              );
            }),
          ),
          new TopBarSettings(
            topBar.enabled,
            selection(topBar.color, `${settingsAt}.topBar.color`),
            height(topBar.height, `${settingsAt}.topBar.height`),
            topBar.stripes,
          ),
          new PlatformBarSettings(
            platformBar.enabled,
            selection(platformBar.color, `${settingsAt}.platformBar.color`),
            platformBar.stripes,
          ),
          new PlatformBarTextSettings(
            platformBarText.enabled,
            selection(platformBarText.color, `${settingsAt}.platformBarText.color`),
            platformBarText.auto,
          ),
        ),
      );
    });
  } catch (error) {
    if (!(error instanceof ValidationStopped)) throw error;
    return { rules: [], issues, validationStopped: true };
  }
  return { rules, issues, validationStopped: false };
}

function invalidFields(issues: readonly SettingsImportIssue[], validationStopped: boolean): SettingsImportError {
  return new SettingsImportError(
    validationStopped ? { reason: 'invalid-fields', issues, validationStopped } : { reason: 'invalid-fields', issues },
  );
}

// Parses an imported settings file's text into current-shape settings, throwing
// SettingsImportError on anything the user needs to be told about: bad JSON, the wrong kind of
// file, a version predating every readable shape or postdating this build, a file whose
// migration to the current shape fails, fields that are missing/wrongly typed/unusable, or no
// rules at all.
//
// `currentVersion` is this build's effective schema version ceiling (the running extension
// version floored at CURRENT_SCHEMA_VERSION). It bounds legacy release-stamped files; stamps
// below SCHEMA_MIN_VERSION are also refused. `steps` is injectable for tests; production uses
// the registry.
export function parseSettingsFile(
  text: string,
  currentVersion: string,
  steps: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): TintSettings {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new SettingsImportError({ reason: 'invalid-json' }, { cause: error });
  }

  if (!isRecord(value)) {
    throw new SettingsImportError({ reason: 'not-settings' });
  }
  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== 'string') {
    throw new SettingsImportError({ reason: 'not-settings' });
  }
  if (schemaVersion.split('.').some((part) => part.length === 0 || /[^0-9]/.test(part))) {
    throw new SettingsImportError({ reason: 'not-settings' });
  }
  if (compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older) {
    throw new SettingsImportError({ reason: 'unsupported-version', version: schemaVersion });
  }
  if (compareVersions(schemaVersion, currentVersion) === VersionComparisonResult.Newer) {
    throw new SettingsImportError({ reason: 'newer-version', version: schemaVersion });
  }

  // Folded forward to the current shape first, so an older file is judged against the shape it
  // migrates into rather than the one it was written in. Only steps newer than the file's own
  // stamp run (see runMigrations), so a file already in a later shape is not migrated twice.
  // Only a throw from the migration itself is migration-failed, reported against the file's own
  // stamp (the step that threw is an internal detail the user cannot act on); every check after
  // the migration keeps its own reason, and an unexpected error from one of those checks
  // propagates unchanged.
  let data: unknown;
  try {
    ({ data } = runMigrations(value, schemaVersion, steps));
  } catch (error) {
    throw new SettingsImportError({ reason: 'migration-failed', version: schemaVersion }, { cause: error });
  }

  // Only a structurally complete file reaches the value stage: it builds from Zod's parsed data.
  const structureIssues: SettingsImportIssue[] = [];
  let fileRules: RuleFile[];
  try {
    fileRules = checkStructure(data, issueCollector(structureIssues));
  } catch (error) {
    if (!(error instanceof ValidationStopped)) throw error;
    throw invalidFields(structureIssues, true);
  }
  if (structureIssues.length > 0) throw invalidFields(structureIssues, false);

  const { rules, issues, validationStopped } = toRules(fileRules);
  if (issues.length > 0) throw invalidFields(issues, validationStopped);
  if (rules.length === 0) {
    throw new SettingsImportError({ reason: 'no-rules' });
  }
  return new TintSettings(rules);
}
