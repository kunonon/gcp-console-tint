import { browser } from 'wxt/browser';
import type { ColorSelection, MatchType, PaletteSettings } from '../types';
import {
  MatchTypeSchema,
  type ProjectRule,
  ProjectRuleSchema,
  type ProjectSettings,
  ProjectSettingsSchema,
  type TintSettings,
  UnknownRecordSchema,
} from '../types';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
import { compareVersions, VersionComparisonResult } from './version';

export const MATCH_TYPES: readonly MatchType[] = MatchTypeSchema.options;

export { DEFAULT_COLOR, DEFAULT_TEXT_COLOR, DEFAULT_TOP_BAR_HEIGHT } from '../types';

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape and is replaced by fresh defaults.
export const SCHEMA_MIN_VERSION = '0.1.0';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = ProjectSettingsSchema.parse({});

export function cloneProjectSettings(settings: ProjectSettings): ProjectSettings {
  return {
    palette: {
      enabled: settings.palette.enabled,
      entries: settings.palette.entries.map((entry) => ({ ...entry })),
    },
    topBar: { ...settings.topBar, color: { ...settings.topBar.color } },
    platformBar: { ...settings.platformBar, color: { ...settings.platformBar.color } },
    platformBarText: { ...settings.platformBarText, color: { ...settings.platformBarText.color } },
  };
}

export const DEFAULT_SETTINGS: TintSettings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  projectRules: [],
};

// Resolves a surface's effective color: the referenced palette entry when the palette is
// enabled and the reference resolves, otherwise the surface's own custom color.
export function resolveSelectedColor(palette: PaletteSettings, selection: ColorSelection): string {
  if (palette.enabled && selection.paletteId) {
    const entry = palette.entries.find((e) => e.id === selection.paletteId);
    if (entry) return entry.color;
  }
  return selection.custom;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return UnknownRecordSchema.safeParse(value).success;
}

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

function freshDefaults(currentVersion: string): TintSettings {
  return {
    schemaVersion: effectiveSchemaVersion(currentVersion),
    projectRules: [],
  };
}

// Reads whatever is in storage and returns it in the CURRENT schema shape:
// - no/invalid schemaVersion, or below SCHEMA_MIN_VERSION -> fresh defaults (nothing to
//   migrate from),
// - otherwise the migration chain folds the data forward version by version, then each rule
//   is parsed by ProjectRuleSchema (dropping only the ones whose pattern isn't a string;
//   every other field recovers via its own default) and merged with defaults. While the
//   chain is empty (pre-release), old-shaped fields are simply not recognized by the schemas
//   below and defaults fill in — destructive by design; rules' id/matchType/pattern still
//   survive.
// Pure: never writes storage. The background script persists the migrated form once via
// migrateStoredSettings.
export function loadSettings(stored: unknown, currentVersion: string): TintSettings {
  if (!isRecord(stored)) {
    return freshDefaults(currentVersion);
  }
  const schemaVersion = stored.schemaVersion;
  if (
    typeof schemaVersion !== 'string' ||
    compareVersions(schemaVersion, SCHEMA_MIN_VERSION) === VersionComparisonResult.Older
  ) {
    return freshDefaults(currentVersion);
  }

  const { data, version } = runMigrations(stored, schemaVersion);

  const projectRules: ProjectRule[] = [];
  if (Array.isArray(data.projectRules)) {
    for (const value of data.projectRules) {
      const parsed = ProjectRuleSchema.safeParse(value);
      if (parsed.success) projectRules.push(parsed.data);
    }
  }

  return {
    schemaVersion: version,
    projectRules,
  };
}

// Persists storage in the newest shape, stamped with the running extension version. Called
// from the background script only, so there is a single writer (content scripts and the
// side panel migrate in memory via loadSettings and never write back). No-ops when storage
// is empty — an unconfigured install stays unconfigured — or already current.
export async function migrateStoredSettings(currentVersion: string): Promise<void> {
  const result = await browser.storage.local.get('tintSettings');
  const stored: unknown = result.tintSettings;
  if (stored == null) return;
  if (isRecord(stored)) {
    const storedVersion = stored.schemaVersion;
    if (
      typeof storedVersion === 'string' &&
      compareVersions(storedVersion, CURRENT_SCHEMA_VERSION) !== VersionComparisonResult.Older
    ) {
      return;
    }
  }
  const migrated = loadSettings(stored, currentVersion);
  await browser.storage.local.set({
    tintSettings: { ...migrated, schemaVersion: effectiveSchemaVersion(currentVersion) },
  });
}

function ruleMatches(rule: ProjectRule, projectId: string): boolean {
  switch (rule.matchType) {
    case 'prefix':
      return projectId.startsWith(rule.pattern);
    case 'suffix':
      return projectId.endsWith(rule.pattern);
    case 'exact':
      return projectId === rule.pattern;
    case 'regex':
      try {
        // Full match: the pattern must cover the entire project id. The non-capturing
        // group keeps top-level alternation (a|b) from escaping the anchors.
        return new RegExp(`^(?:${rule.pattern})$`).test(projectId);
      } catch {
        // invalid regex: the rule never matches
        return false;
      }
  }
}

// Rules are ordered by priority (top of the list first). The first rule that matches the
// project id (per its matchType) wins; 'regex' rules with invalid patterns are skipped.
// Returns null when the URL has no project id or no rule matches — nothing is applied.
export function resolveProjectSettings(settings: TintSettings, projectId: string | null): ProjectSettings | null {
  if (projectId) {
    for (const rule of settings.projectRules) {
      if (ruleMatches(rule, projectId)) return rule.settings;
    }
  }
  return null;
}
