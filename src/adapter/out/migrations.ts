import { compareVersions, VersionComparisonResult } from './version';

// One schema upgrade step. `migrate` receives settings data in the shape that immediately
// precedes `to` and returns data in the `to` shape. A step must yield the COMPLETE current
// shape: settings-repository's toDomain still fills defaults for whatever is missing when
// reading storage, but settings-file's import is strict, so a step that leaves a field missing
// makes every file written before that step fail to import.
export interface SchemaMigration {
  to: string;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

// Ascending by `to`. Empty while the extension is unreleased: pre-release schema changes
// are destructive (old-shaped fields are simply ignored on read and defaults fill in), so
// no steps exist yet. From the first public release onward, every shape change must ship
// as a step here — and bump CURRENT_SCHEMA_VERSION to match its `to`.
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [];

// The oldest schemaVersion the migration chain can read. Anything below (or missing, or
// invalid) predates every released shape: storage falls back to fresh defaults, an imported
// file is refused as unsupported-version.
export const SCHEMA_MIN_VERSION = '0.1.0';

// The version of the current schema shape. Must equal the last SCHEMA_MIGRATIONS entry's
// `to` whenever steps exist (asserted in tests); stays at the initial version while the
// registry is empty.
export const CURRENT_SCHEMA_VERSION = '0.1.0';

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
