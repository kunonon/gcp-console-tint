import { z } from 'zod';
import { Color } from '../../domain/color';
import { ColorSelection } from '../../domain/color-selection';
import { Palette, PaletteEntry } from '../../domain/palette';
import { MATCH_TYPES, ProjectRule } from '../../domain/project-rule';
import {
  PlatformBarSettings,
  PlatformBarTextSettings,
  ProjectSettings,
  TopBarSettings,
} from '../../domain/project-settings';
import { TintSettings } from '../../domain/tint-settings';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
import { compareVersions, VersionComparisonResult } from './version';

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape and is replaced by fresh defaults.
const SCHEMA_MIN_VERSION = '0.1.0';

// The domain owns the default VALUES, this module owns which field recovers to what: every
// `.catch()` below reads its fallback out of ProjectSettings.DEFAULT rather than restating it.
const DEFAULTS = ProjectSettings.DEFAULT;
// The product default color, reached through the domain's public surface; a junk palette entry
// color falls back to it the same way the surfaces' own colors do.
const DEFAULT_ENTRY_COLOR = DEFAULTS.topBar.color.custom;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Fresh instances on every call so two independently-recovered defaults never alias each other.
function defaultPaletteEntries(): PaletteEntry[] {
  return DEFAULTS.palette.entries.map((entry) => new PaletteEntry(entry.id, entry.name, entry.color));
}

// Anything that is not a '#rrggbb' string recovers to `fallback`, the same per-field policy
// `.catch()` gives the other fields.
function colorField(fallback: Color) {
  return z
    .unknown()
    .optional()
    .transform((value) => (typeof value === 'string' ? Color.parse(value) : null) ?? fallback);
}

// Parameterized by defaults because each surface falls back to a different selection: topBar
// and platformBar point at the default palette entry, while platformBarText has no palette
// reference and falls back to a plain custom color instead.
function colorSelectionSchema(defaults: ColorSelection) {
  return z
    .object({
      paletteId: z.string().nullable().catch(defaults.paletteId),
      custom: colorField(defaults.custom),
    })
    .transform((value) => new ColorSelection(value.paletteId, value.custom))
    .catch(() => new ColorSelection(defaults.paletteId, defaults.custom));
}

const paletteEntrySchema = z
  .object({
    id: z.string().catch(() => crypto.randomUUID()),
    name: z.string().catch(''),
    color: colorField(DEFAULT_ENTRY_COLOR),
  })
  .transform((value) => new PaletteEntry(value.id, value.name, value.color));

// Parses `value` as a PaletteEntry[]: a non-array value (missing or junk) falls back to the
// default entries wholesale, otherwise each element is parsed independently and invalid
// elements are dropped (not substituted) so one bad entry can't nuke its valid siblings.
function parseEntries(value: unknown): PaletteEntry[] {
  if (!Array.isArray(value)) return defaultPaletteEntries();
  return value.reduce<PaletteEntry[]>((kept, item) => {
    const parsed = paletteEntrySchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
    return kept;
  }, []);
}

const paletteObjectSchema = z
  .object({
    enabled: z.boolean().catch(DEFAULTS.palette.enabled),
    // `.optional()` is required (not just cosmetic) even though parseEntries already handles
    // `undefined`: without it, Zod treats an entirely-absent `entries` key as an error
    // ("expected nonoptional") before the transform ever runs, regardless of what the
    // transform itself would accept.
    entries: z.unknown().optional().transform(parseEntries),
  })
  .transform((value) => new Palette(value.enabled, value.entries));
const paletteSchema = paletteObjectSchema.catch(() => paletteObjectSchema.parse({}));

const topBarObjectSchema = z
  .object({
    enabled: z.boolean().catch(DEFAULTS.topBar.enabled),
    color: colorSelectionSchema(DEFAULTS.topBar.color),
    height: z.number().catch(DEFAULTS.topBar.height),
    stripes: z.boolean().catch(DEFAULTS.topBar.stripes),
  })
  .transform((value) => new TopBarSettings(value.enabled, value.color, value.height, value.stripes));
const topBarSchema = topBarObjectSchema.catch(() => topBarObjectSchema.parse({}));

const platformBarObjectSchema = z
  .object({
    enabled: z.boolean().catch(DEFAULTS.platformBar.enabled),
    color: colorSelectionSchema(DEFAULTS.platformBar.color),
    stripes: z.boolean().catch(DEFAULTS.platformBar.stripes),
  })
  .transform((value) => new PlatformBarSettings(value.enabled, value.color, value.stripes));
const platformBarSchema = platformBarObjectSchema.catch(() => platformBarObjectSchema.parse({}));

const platformBarTextObjectSchema = z
  .object({
    enabled: z.boolean().catch(DEFAULTS.platformBarText.enabled),
    color: colorSelectionSchema(DEFAULTS.platformBarText.color),
    auto: z.boolean().catch(DEFAULTS.platformBarText.auto),
  })
  .transform((value) => new PlatformBarTextSettings(value.enabled, value.color, value.auto));
const platformBarTextSchema = platformBarTextObjectSchema.catch(() => platformBarTextObjectSchema.parse({}));

const projectSettingsSchema = z
  .object({
    palette: paletteSchema,
    topBar: topBarSchema,
    platformBar: platformBarSchema,
    platformBarText: platformBarTextSchema,
  })
  .transform((value) => new ProjectSettings(value.palette, value.topBar, value.platformBar, value.platformBarText))
  // Sharing the immutable DEFAULT instance is safe: nothing in the model mutates in place.
  .catch(() => ProjectSettings.DEFAULT);

// A rule is only ever dropped for having a non-string `pattern` (see toDomain, which parses
// projectRules per-element and drops whichever fail this schema) — every other field recovers
// via its own default instead of invalidating the whole rule.
const projectRuleSchema = z
  .object({
    id: z.string().catch(() => crypto.randomUUID()),
    matchType: z.enum(MATCH_TYPES).catch('regex'),
    pattern: z.string(),
    settings: projectSettingsSchema,
  })
  .transform((value) => new ProjectRule(value.id, value.matchType, value.pattern, value.settings));

// The schemaVersion to stamp on anything we write: the running release version, floored at
// CURRENT_SCHEMA_VERSION. The floor is the invariant that matters — data written in the
// current shape must never carry a label older than that shape's schema version, or the
// next load would re-run migration steps against already-migrated data and silently reset
// the user's values (reachable if a new migration step ships without the manifest version
// catching up).
export function effectiveSchemaVersion(currentVersion: string): string {
  return compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) === VersionComparisonResult.Older
    ? CURRENT_SCHEMA_VERSION
    : currentVersion;
}

// Reads whatever is in storage and returns it in the CURRENT schema shape:
// - no/invalid schemaVersion, or below SCHEMA_MIN_VERSION -> fresh defaults (nothing to
//   migrate from),
// - otherwise the migration chain folds the data forward version by version, then each rule
//   is parsed by projectRuleSchema (dropping only the ones whose pattern isn't a string;
//   every other field recovers via its own default) and merged with defaults. While the
//   chain is empty (pre-release), old-shaped fields are simply not recognized by the schemas
//   and defaults fill in — destructive by design; rules' id/matchType/pattern still survive.
// Pure: never writes storage. The background script persists the migrated form once via
// migrateStoredSettings (browser-settings-store.ts).
export function toDomain(stored: unknown): TintSettings {
  if (!isRecord(stored)) {
    return new TintSettings([]);
  }
  const schemaVersion = stored.schemaVersion;
  if (
    typeof schemaVersion !== 'string' ||
    compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older
  ) {
    return new TintSettings([]);
  }

  const { data } = runMigrations(stored, schemaVersion);

  const projectRules: ProjectRule[] = [];
  if (Array.isArray(data.projectRules)) {
    for (const value of data.projectRules) {
      const parsed = projectRuleSchema.safeParse(value);
      if (parsed.success) projectRules.push(parsed.data);
    }
  }

  return new TintSettings(projectRules);
}

// The stored JSON shape. Colors leave the model as '#rrggbb' strings, everything else is
// written verbatim — this is the persisted contract, so keep it in sync with the schemas
// that read it back (adapter/out/tests/browser-settings-store.test.ts asserts it).
export function toStored(settings: TintSettings, schemaVersion: string): Record<string, unknown> {
  return {
    schemaVersion,
    projectRules: settings.projectRules.map((rule) => ({
      id: rule.id,
      matchType: rule.matchType,
      pattern: rule.pattern,
      settings: {
        palette: {
          enabled: rule.settings.palette.enabled,
          entries: rule.settings.palette.entries.map((entry) => ({
            id: entry.id,
            name: entry.name,
            color: entry.color.toHex(),
          })),
        },
        topBar: {
          enabled: rule.settings.topBar.enabled,
          color: storedSelection(rule.settings.topBar.color),
          height: rule.settings.topBar.height,
          stripes: rule.settings.topBar.stripes,
        },
        platformBar: {
          enabled: rule.settings.platformBar.enabled,
          color: storedSelection(rule.settings.platformBar.color),
          stripes: rule.settings.platformBar.stripes,
        },
        platformBarText: {
          enabled: rule.settings.platformBarText.enabled,
          color: storedSelection(rule.settings.platformBarText.color),
          auto: rule.settings.platformBarText.auto,
        },
      },
    })),
  };
}

function storedSelection(selection: ColorSelection) {
  return { paletteId: selection.paletteId, custom: selection.custom.toHex() };
}
