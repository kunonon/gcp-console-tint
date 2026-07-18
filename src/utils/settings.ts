import type { ProjectRule, ProjectSettings, TintSettings } from '../types';
import { compareVersions } from './version';

export const DEFAULT_COLOR = '#ff6d00';
export const DEFAULT_TEXT_COLOR = '#ffffff';
export const DEFAULT_TOP_BAR_HEIGHT = 4;

// The lowest schemaVersion that can be read as-is with the current TintSettings shape.
// Bump this on a release that changes the schema shape; from that release onward, branch
// here (or add a migration step) for any stored data still below the new floor.
export const SCHEMA_MIN_VERSION = '0.1.0';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  paletteEnabled: true,
  palette: [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }],
  topBarEnabled: true,
  topBarColor: DEFAULT_COLOR,
  topBarPaletteId: 'default',
  topBarHeight: DEFAULT_TOP_BAR_HEIGHT,
  topBarStripes: false,
  platformBarEnabled: true,
  platformBarColor: DEFAULT_COLOR,
  platformBarPaletteId: 'default',
  platformBarStripes: false,
  platformBarTextEnabled: true,
  platformBarTextColor: DEFAULT_TEXT_COLOR,
  platformBarTextPaletteId: null,
  platformBarTextAuto: false,
};

// ProjectSettings contains an array (palette); a spread copy would share it by reference,
// so rule add/duplicate must go through this instead.
export function cloneProjectSettings(settings: ProjectSettings): ProjectSettings {
  return { ...settings, palette: settings.palette.map((entry) => ({ ...entry })) };
}

export const DEFAULT_SETTINGS: TintSettings = {
  schemaVersion: SCHEMA_MIN_VERSION,
  projectRules: [],
};

function mergeProjectSettings(stored: Partial<ProjectSettings> | null | undefined): ProjectSettings {
  const base = cloneProjectSettings(DEFAULT_PROJECT_SETTINGS);
  // Arrays pass a bare typeof check and would spread their indices as extraneous keys.
  if (stored == null || typeof stored !== 'object' || Array.isArray(stored)) return base;
  const merged: ProjectSettings = { ...base, ...stored };
  merged.palette = Array.isArray(stored.palette)
    ? stored.palette.map((entry) => ({ ...entry }))
    : base.palette;
  return merged;
}

function freshDefaults(currentVersion: string): TintSettings {
  return {
    schemaVersion: currentVersion,
    projectRules: [],
  };
}

// Reads whatever is in storage and either returns it (merged with defaults for forward
// compatibility) or discards it in favor of fresh defaults. Storage is discarded when:
// - it doesn't have a schemaVersion at all (unknown/pre-release shape), or
// - its schemaVersion is older than SCHEMA_MIN_VERSION.
// This is a pre-release app: no migration path from older shapes is implemented, so any
// data that doesn't meet the floor is simply replaced by defaults stamped with the
// currently-running extension version.
export function loadSettings(stored: unknown, currentVersion: string): TintSettings {
  if (stored == null || typeof stored !== 'object') {
    return freshDefaults(currentVersion);
  }
  const raw = stored as Record<string, unknown>;
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'string' || compareVersions(schemaVersion, SCHEMA_MIN_VERSION) < 0) {
    return freshDefaults(currentVersion);
  }

  const projectRules: ProjectRule[] = [];
  if (Array.isArray(raw.projectRules)) {
    for (const value of raw.projectRules) {
      if (value == null || typeof value !== 'object') continue;
      const rule = value as Record<string, unknown>;
      if (typeof rule.pattern !== 'string') continue;
      projectRules.push({
        id: typeof rule.id === 'string' ? rule.id : crypto.randomUUID(),
        pattern: rule.pattern,
        settings: mergeProjectSettings(rule.settings as Partial<ProjectSettings>),
      });
    }
  }

  return {
    schemaVersion,
    projectRules,
  };
}

// Rules are ordered by priority (top of the list first). The first rule whose regex
// pattern matches the project id wins; rules with invalid regexes are skipped.
// Returns null when the URL has no project id or no rule matches — nothing is applied.
export function resolveProjectSettings(settings: TintSettings, projectId: string | null): ProjectSettings | null {
  if (projectId) {
    for (const rule of settings.projectRules) {
      try {
        if (new RegExp(rule.pattern).test(projectId)) return rule.settings;
      } catch {
        // invalid regex: skip this rule
      }
    }
  }
  return null;
}
