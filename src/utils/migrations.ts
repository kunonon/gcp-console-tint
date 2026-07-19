import { compareVersions } from './version';

// One schema upgrade step. `migrate` receives settings data in the shape that immediately
// precedes `to` and returns data in the `to` shape. Steps only reshape the data — they may
// leave fields missing; loadSettings validates and fills defaults after the chain runs.
export interface SchemaMigration {
  to: string;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

// --- 0.1.0 -> 0.2.0: flat per-surface keys become nested per-surface objects ------------
//
// Old shape (ProjectSettings): paletteEnabled, palette[], topBarEnabled, topBarColor,
// topBarPaletteId, topBarHeight, topBarStripes, platformBarEnabled, platformBarColor,
// platformBarPaletteId, platformBarStripes, platformBarTextEnabled, platformBarTextColor,
// platformBarTextPaletteId, platformBarTextAuto.
function migrateFlatSettingsToNested(data: Record<string, unknown>): Record<string, unknown> {
  const rules = Array.isArray(data.projectRules) ? data.projectRules : [];
  return {
    ...data,
    projectRules: rules.map((value) => {
      if (value == null || typeof value !== 'object') return value;
      const rule = value as Record<string, unknown>;
      const old = rule.settings;
      if (old == null || typeof old !== 'object' || Array.isArray(old)) return rule;
      const flat = old as Record<string, unknown>;
      return {
        ...rule,
        settings: {
          palette: { enabled: flat.paletteEnabled, entries: flat.palette },
          topBar: {
            enabled: flat.topBarEnabled,
            color: { paletteId: flat.topBarPaletteId, custom: flat.topBarColor },
            height: flat.topBarHeight,
            stripes: flat.topBarStripes,
          },
          platformBar: {
            enabled: flat.platformBarEnabled,
            color: { paletteId: flat.platformBarPaletteId, custom: flat.platformBarColor },
            stripes: flat.platformBarStripes,
          },
          platformBarText: {
            enabled: flat.platformBarTextEnabled,
            color: { paletteId: flat.platformBarTextPaletteId, custom: flat.platformBarTextColor },
            auto: flat.platformBarTextAuto,
          },
        },
      };
    }),
  };
}

// Ascending by `to`. The last entry's `to` is, by definition, the current schema version.
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [{ to: '0.2.0', migrate: migrateFlatSettingsToNested }];

export const CURRENT_SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1].to;

// Applies every migration step newer than `fromVersion`, in order, so data recorded under
// any past release folds forward into the current shape (0.1.0 -> 0.2.0 -> ... -> latest).
export function runMigrations(
  data: Record<string, unknown>,
  fromVersion: string,
): { data: Record<string, unknown>; version: string } {
  let current = data;
  let version = fromVersion;
  for (const step of SCHEMA_MIGRATIONS) {
    if (compareVersions(version, step.to) < 0) {
      current = step.migrate(current);
      version = step.to;
    }
  }
  return { data: current, version };
}
