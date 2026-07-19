import { browser } from 'wxt/browser';
import type { ColorSelection, MatchType, PaletteSettings, ProjectRule, ProjectSettings, TintSettings } from '../types';
import { CURRENT_SCHEMA_VERSION, runMigrations } from './migrations';
import { compareVersions } from './version';

export const MATCH_TYPES: readonly MatchType[] = ['prefix', 'suffix', 'exact', 'regex'];

export const DEFAULT_COLOR = '#ff6d00';
export const DEFAULT_TEXT_COLOR = '#ffffff';
export const DEFAULT_TOP_BAR_HEIGHT = 4;

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape and is replaced by fresh defaults.
export const SCHEMA_MIN_VERSION = '0.1.0';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  palette: {
    enabled: true,
    entries: [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }],
  },
  topBar: {
    enabled: true,
    color: { paletteId: 'default', custom: DEFAULT_COLOR },
    height: DEFAULT_TOP_BAR_HEIGHT,
    stripes: false,
  },
  platformBar: {
    enabled: true,
    color: { paletteId: 'default', custom: DEFAULT_COLOR },
    stripes: false,
  },
  platformBarText: {
    enabled: true,
    color: { paletteId: null, custom: DEFAULT_TEXT_COLOR },
    auto: false,
  },
};

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
  // Arrays pass a bare typeof check and would spread their indices as extraneous keys.
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

// Spread, but stored fields that are absent or explicitly undefined never clobber the
// default (migration steps may emit undefined for fields the old shape lacked).
function mergeDefined<T extends object>(base: T, stored: unknown): T {
  if (!isRecord(stored)) return base;
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

function mergeProjectSettings(stored: unknown): ProjectSettings {
  const base = cloneProjectSettings(DEFAULT_PROJECT_SETTINGS);
  if (!isRecord(stored)) return base;

  const palette = mergeDefined(base.palette, stored.palette);
  palette.entries = Array.isArray(palette.entries)
    ? palette.entries.map((entry) => ({ ...entry }))
    : base.palette.entries;

  const topBar = mergeDefined(base.topBar, stored.topBar);
  topBar.color = mergeDefined(base.topBar.color, isRecord(stored.topBar) ? stored.topBar.color : undefined);

  const platformBar = mergeDefined(base.platformBar, stored.platformBar);
  platformBar.color = mergeDefined(
    base.platformBar.color,
    isRecord(stored.platformBar) ? stored.platformBar.color : undefined,
  );

  const platformBarText = mergeDefined(base.platformBarText, stored.platformBarText);
  platformBarText.color = mergeDefined(
    base.platformBarText.color,
    isRecord(stored.platformBarText) ? stored.platformBarText.color : undefined,
  );

  return { palette, topBar, platformBar, platformBarText };
}

// The schemaVersion to stamp on anything we write: the running release version, floored at
// CURRENT_SCHEMA_VERSION. The floor is the invariant that matters — data written in the
// current NESTED shape must never carry a label older than the nested schema, or the next
// load would re-run the flat->nested migration against nested data and silently reset the
// user's values to defaults (reachable if a new migration step ships without the manifest
// version catching up).
export function effectiveSchemaVersion(currentVersion: string): string {
  return compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) >= 0 ? currentVersion : CURRENT_SCHEMA_VERSION;
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
// - otherwise the migration chain folds the data forward version by version
//   (0.1.0 -> 0.2.0 -> ...), then each rule is validated and merged with defaults.
// Pure: never writes storage. The background script persists the migrated form once via
// migrateStoredSettings.
export function loadSettings(stored: unknown, currentVersion: string): TintSettings {
  if (!isRecord(stored)) {
    return freshDefaults(currentVersion);
  }
  const schemaVersion = stored.schemaVersion;
  if (typeof schemaVersion !== 'string' || compareVersions(schemaVersion, SCHEMA_MIN_VERSION) < 0) {
    return freshDefaults(currentVersion);
  }

  const { data, version } = runMigrations(stored, schemaVersion);

  const projectRules: ProjectRule[] = [];
  if (Array.isArray(data.projectRules)) {
    for (const value of data.projectRules) {
      if (!isRecord(value)) continue;
      if (typeof value.pattern !== 'string') continue;
      projectRules.push({
        id: typeof value.id === 'string' ? value.id : crypto.randomUUID(),
        // Missing (early 0.1.0 data) or unknown values fall back to 'regex' — the shape
        // every pre-matchType pattern was written as.
        matchType: MATCH_TYPES.includes(value.matchType as MatchType) ? (value.matchType as MatchType) : 'regex',
        pattern: value.pattern,
        settings: mergeProjectSettings(value.settings),
      });
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
    if (typeof storedVersion === 'string' && compareVersions(storedVersion, CURRENT_SCHEMA_VERSION) >= 0) {
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
