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
import { runMigrations, SCHEMA_MIN_VERSION } from './migrations';
import { compareVersions, VersionComparisonResult } from './version';

// The import format: the same JSON shape settings-repository's toStored() writes, read back
// STRICTLY. Where toDomain() repairs corrupt storage field by field, an imported file is the
// user's own input: every field the exporter writes must be there with the right type and a
// usable value, and anything else is refused with the reason and the offending paths, so the
// user can fix the file instead of silently getting defaults back.
//
// The two validation stages are deliberately split:
//   1. STRUCTURE (the Zod schema below) — required keys and JSON types only. No enums, ranges
//      or formats live here; that would put the domain's rules in the adapter.
//   2. VALUES (toRules) — every value is handed to the domain factory that owns it
//      (Color.fromHex, TopBarHeight.fromPixels, isMatchType), and a rejection becomes an issue.

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Stage 1. `z.object` ignores unknown keys on purpose: a file written by a newer release may
// carry fields this one does not know yet, and that is not a reason to refuse it.
const colorSelectionSchema = z.object({
  // JSON has no undefined: an unset palette reference is written as null.
  paletteId: z.string().nullable(),
  custom: z.string(),
});

const settingsFileSchema = z.object({
  projectRules: z.array(
    z.object({
      id: z.string(),
      matchType: z.string(),
      pattern: z.string(),
      settings: z.object({
        palette: z.object({
          enabled: z.boolean(),
          entries: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
        }),
        topBar: z.object({
          enabled: z.boolean(),
          color: colorSelectionSchema,
          height: z.number(),
          stripes: z.boolean(),
        }),
        platformBar: z.object({ enabled: z.boolean(), color: colorSelectionSchema, stripes: z.boolean() }),
        platformBarText: z.object({ enabled: z.boolean(), color: colorSelectionSchema, auto: z.boolean() }),
      }),
    }),
  ),
});

type SettingsFile = z.infer<typeof settingsFileSchema>;

// A Zod path as it reads in the file: `projectRules[1].settings.topBar.height`.
function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (text, key) => (typeof key === 'number' ? `${text}[${key}]` : text === '' ? String(key) : `${text}.${String(key)}`),
    '',
  );
}

// Stage 2. Builds the domain objects, asking the domain to judge every value and collecting the
// rejections instead of throwing at the first one, so a file reports everything wrong with it in
// one pass. A rejected value is replaced by a placeholder here purely to keep building: the
// returned rules are used only when no issue was collected.
function toRules(file: SettingsFile): { rules: ProjectRule[]; issues: SettingsImportIssue[] } {
  const issues: SettingsImportIssue[] = [];
  const reject = (path: string, message: string) => {
    issues.push({ path, message });
  };

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
  // back to the custom color (see Palette.resolve).
  const selection = (value: { paletteId: string | null; custom: string }, path: string): ColorSelection =>
    new ColorSelection(
      value.paletteId === null ? undefined : PaletteEntryId.recreate(value.paletteId),
      color(value.custom, `${path}.custom`),
    );

  const rules = file.projectRules.map((rule, index) => {
    const at = `projectRules[${index}]`;
    const settingsAt = `${at}.settings`;
    const { palette, topBar, platformBar, platformBarText } = rule.settings;
    return ProjectRule.recreate(
      ProjectRuleId.recreate(rule.id),
      matchType(rule.matchType, `${at}.matchType`),
      rule.pattern,
      new ProjectSettings(
        new Palette(
          palette.enabled,
          palette.entries.map((entry, entryIndex) => {
            const entryAt = `${settingsAt}.palette.entries[${entryIndex}]`;
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

  return { rules, issues };
}

// Parses an imported settings file's text into current-shape settings, throwing
// SettingsImportError on anything the user needs to be told about: bad JSON, the wrong kind of
// file, a version predating every readable shape, fields that are missing/wrongly typed/unusable,
// or no rules at all.
export function parseSettingsFile(text: string): TintSettings {
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
  if (compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older) {
    throw new SettingsImportError({ reason: 'unsupported-version', version: schemaVersion });
  }

  // Folded forward to the current shape first, so an older file is judged against the shape it
  // migrates into rather than the one it was written in.
  const { data } = runMigrations(value, schemaVersion);

  const structure = settingsFileSchema.safeParse(data);
  if (!structure.success) {
    throw new SettingsImportError({
      reason: 'invalid-fields',
      issues: structure.error.issues.map((issue) => ({ path: issuePath(issue.path), message: issue.message })),
    });
  }

  const { rules, issues } = toRules(structure.data);
  if (issues.length > 0) {
    throw new SettingsImportError({ reason: 'invalid-fields', issues });
  }
  if (rules.length === 0) {
    throw new SettingsImportError({ reason: 'no-rules' });
  }
  return new TintSettings(rules);
}
