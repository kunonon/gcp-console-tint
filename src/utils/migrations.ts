import { compareVersions } from './version';

// One schema upgrade step. `migrate` receives settings data in the shape that immediately
// precedes `to` and returns data in the `to` shape. Steps only reshape the data — they may
// leave fields missing; loadSettings validates and fills defaults after the chain runs.
export interface SchemaMigration {
  to: string;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

// Ascending by `to`. Empty while the extension is unreleased: pre-release schema changes
// are destructive (old-shaped fields are simply ignored on read and defaults fill in), so
// no steps exist yet. From the first public release onward, every shape change must ship
// as a step here — and bump CURRENT_SCHEMA_VERSION to match its `to`.
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [];

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
    if (compareVersions(version, step.to) < 0) {
      current = step.migrate(current);
      version = step.to;
    }
  }
  return { data: current, version };
}
