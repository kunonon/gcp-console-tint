import type { ProjectSettings, TintSettings } from '../types';
import { compareVersions } from './version';

export const DEFAULT_COLOR = '#ff6d00';
export const DEFAULT_TEXT_COLOR = '#ffffff';
export const DEFAULT_TOP_BAR_HEIGHT = 4;

// The lowest schemaVersion that can be read as-is with the current TintSettings shape.
// Bump this on a release that changes the schema shape; from that release onward, branch
// here (or add a migration step) for any stored data still below the new floor.
export const SCHEMA_MIN_VERSION = '0.1.0';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
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

export const DEFAULT_SETTINGS: TintSettings = {
  schemaVersion: SCHEMA_MIN_VERSION,
  paletteEnabled: true,
  palette: [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }],
  defaultProject: { ...DEFAULT_PROJECT_SETTINGS },
  projects: {},
};

function mergeProjectSettings(stored: Partial<ProjectSettings> | null | undefined): ProjectSettings {
  return { ...DEFAULT_PROJECT_SETTINGS, ...(stored ?? {}) };
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
    return { ...DEFAULT_SETTINGS, schemaVersion: currentVersion };
  }
  const raw = stored as Record<string, unknown>;
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'string' || compareVersions(schemaVersion, SCHEMA_MIN_VERSION) < 0) {
    return { ...DEFAULT_SETTINGS, schemaVersion: currentVersion };
  }

  const projects: Record<string, ProjectSettings> = {};
  if (raw.projects && typeof raw.projects === 'object') {
    for (const [id, value] of Object.entries(raw.projects as Record<string, unknown>)) {
      projects[id] = mergeProjectSettings(value as Partial<ProjectSettings>);
    }
  }

  return {
    schemaVersion,
    paletteEnabled: (raw.paletteEnabled as boolean) ?? DEFAULT_SETTINGS.paletteEnabled,
    palette: (raw.palette as TintSettings['palette']) ?? DEFAULT_SETTINGS.palette,
    defaultProject: mergeProjectSettings(raw.defaultProject as Partial<ProjectSettings>),
    projects,
  };
}

export function resolveProjectSettings(settings: TintSettings, projectId: string | null): ProjectSettings {
  if (projectId && settings.projects[projectId]) {
    return settings.projects[projectId];
  }
  return settings.defaultProject;
}
