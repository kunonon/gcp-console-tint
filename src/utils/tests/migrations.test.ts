import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, runMigrations, SCHEMA_MIGRATIONS, type SchemaMigration } from '../migrations';
import { compareVersions, VersionComparisonResult } from '../version';

describe('runMigrations', () => {
  // SCHEMA_MIGRATIONS is currently EMPTY (see migrations.ts): the extension is unreleased, so
  // pre-release schema changes are destructive-read instead of migrated (see settings.test.ts's
  // "destructive pre-release read" tests). This assertion documents that invariant directly and
  // stays correct once real steps are added: it falls back to the empty-registry baseline only
  // while the registry is still empty.
  it("CURRENT_SCHEMA_VERSION equals the last migration step's `to` whenever steps exist, or the pre-release baseline while the registry is empty", () => {
    const expected = SCHEMA_MIGRATIONS.length > 0 ? SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1]!.to : '0.1.0';
    expect(CURRENT_SCHEMA_VERSION).toBe(expected);
  });

  it('SCHEMA_MIGRATIONS is ordered ascending by `to` (vacuously true while the registry is empty)', () => {
    for (let i = 1; i < SCHEMA_MIGRATIONS.length; i++) {
      expect(compareVersions(SCHEMA_MIGRATIONS[i - 1]!.to, SCHEMA_MIGRATIONS[i]!.to)).toBe(
        VersionComparisonResult.Older,
      );
    }
  });

  it('applies nothing via the real (currently empty) SCHEMA_MIGRATIONS registry, regardless of fromVersion', () => {
    const data = { projectRules: [{ id: '1', pattern: 'p', settings: { topBarColor: '#123456' } }] };

    expect(runMigrations(data, '0.1.0')).toEqual({ data, version: '0.1.0' });
    expect(runMigrations(data, '9.9.9')).toEqual({ data, version: '9.9.9' });
  });

  // The registry is empty today, but the folding service itself (this function plus the
  // injectable `steps` param) is dormant infrastructure for the first post-release migration.
  // These tests exercise that general capability against a synthetic multi-step chain so it's
  // proven correct now rather than only once a real step exists to test it against.
  describe('with an injected synthetic multi-step chain (proving the service for future post-release use)', () => {
    // Each step appends its own `to` to a `markers` array, so both WHICH steps ran and the
    // ORDER they ran in are directly observable in the output data.
    const markerStep = (to: string): SchemaMigration => ({
      to,
      migrate: (data) => ({
        ...data,
        markers: [...(Array.isArray(data.markers) ? data.markers : []), to],
      }),
    });
    const steps: SchemaMigration[] = [markerStep('0.1.1'), markerStep('0.2.0'), markerStep('0.3.0')];

    it('applies every step in order from the very first version (0.1.0)', () => {
      const result = runMigrations({}, '0.1.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.1.1', '0.2.0', '0.3.0']);
    });

    it('applies only the steps newer than an intermediate fromVersion, skipping earlier ones (0.1.5 skips the 0.1.1 step)', () => {
      const result = runMigrations({}, '0.1.5', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.2.0', '0.3.0']);
    });

    it("applies no steps when fromVersion is already at the last step's `to`", () => {
      const result = runMigrations({}, '0.3.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data).toEqual({});
    });

    it("applies no steps when fromVersion is above the last step's `to`", () => {
      const result = runMigrations({}, '9.9.9', steps);

      expect(result.version).toBe('9.9.9');
      expect(result.data).toEqual({});
    });
  });
});
