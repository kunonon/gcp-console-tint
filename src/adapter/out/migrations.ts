import { compareVersions, VersionComparisonResult } from './version';

// One schema upgrade step. `to` is the extension release version that first ships the target
// shape; do not use an independent schema counter. `migrate` receives data in the shape that
// immediately precedes `to` and returns data in the `to` shape. The full chain must yield the
// complete current shape: settings-repository's toDomain fills defaults
// for missing values when reading storage, but settings-file's import is strict, so a chain that
// leaves a field missing makes older files fail to import.
export interface SchemaMigration {
  to: string;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

// Ascending by `to`. A shape change must ship with a step whose `to` is the first extension
// release that introduces it (and is therefore above every prior release); update
// CURRENT_SCHEMA_VERSION to that same release version. Each step is a frozen snapshot of its
// release: write literal values, never reference live domain defaults that may change later.
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  // 0.3.0 adds the side panel theme; data from earlier releases starts on 'auto'.
  { to: '0.3.0', migrate: (data) => ({ ...data, theme: 'auto' }) },
];

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape: storage falls back to fresh defaults, an imported
// file is refused as unsupported-version.
export const SCHEMA_MIN_VERSION = '0.1.0';

// The version of the current schema shape. Must equal the last SCHEMA_MIGRATIONS entry's
// `to` (asserted in tests). Bump it only in the release that introduces a new shape.
export const CURRENT_SCHEMA_VERSION = '0.3.0';

// Applies every migration step newer than `fromVersion`, in order, so data recorded under
// any past release folds forward step by step into the current shape. `steps` is
// injectable for tests; production callers use the real registry.
export function runMigrations(
  data: Record<string, unknown>,
  fromVersion: string,
  steps: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): { data: Record<string, unknown>; version: string } {
  let current = data;
  let version = fromVersion;
  for (const step of steps) {
    if (compareVersions(version, step.to) === VersionComparisonResult.Older) {
      current = step.migrate(current);
      version = step.to;
    }
  }
  return { data: current, version };
}
