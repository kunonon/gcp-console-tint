import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, runMigrations, SCHEMA_MIGRATIONS, type SchemaMigration } from '../migrations';
import { compareVersions, VersionComparisonResult } from '../version';

describe('runMigrations', () => {
  it("CURRENT_SCHEMA_VERSION equals the last migration step's `to`", () => {
    expect(SCHEMA_MIGRATIONS.length).toBeGreaterThan(0);
    expect(CURRENT_SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1]!.to);
  });

  it('SCHEMA_MIGRATIONS is ordered ascending by release version in `to`', () => {
    for (let i = 1; i < SCHEMA_MIGRATIONS.length; i++) {
      expect(compareVersions(SCHEMA_MIGRATIONS[i - 1]!.to, SCHEMA_MIGRATIONS[i]!.to)).toBe(
        VersionComparisonResult.Older,
      );
    }
  });

  describe('the real SCHEMA_MIGRATIONS registry', () => {
    const data = { projectRules: [{ id: '1', pattern: 'p', settings: { topBarColor: '#123456' } }] };

    it.each(['0.1.0', '0.2.1'])('adds theme auto to %s data at 0.3.0, keeping every other key', (fromVersion) => {
      expect(runMigrations(data, fromVersion)).toEqual({ data: { ...data, theme: 'auto' }, version: '0.3.0' });
    });

    it.each(['0.3.0', '0.3.1', '9.9.9'])('applies nothing from %s up', (fromVersion) => {
      const current = { ...data, theme: 'dark' };

      expect(runMigrations(current, fromVersion)).toEqual({ data: current, version: fromVersion });
    });
  });

  // Synthetic release versions exercise the first post-baseline migration and a major release.
  describe('with an injected release-version migration chain', () => {
    // Each step appends its own `to` to a `markers` array, so both WHICH steps ran and the
    // ORDER they ran in are directly observable in the output data.
    const markerStep = (to: string): SchemaMigration => ({
      to,
      migrate: (data) => ({
        ...data,
        markers: [...(Array.isArray(data.markers) ? data.markers : []), to],
      }),
    });
    const steps: SchemaMigration[] = [markerStep('0.1.4'), markerStep('0.2.0'), markerStep('0.3.0')];

    it('applies every step in order from the baseline schema version (0.1.0)', () => {
      const result = runMigrations({}, '0.1.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.1.4', '0.2.0', '0.3.0']);
    });

    it('migrates 0.1.3 data stamped with its release version at the shape change in 0.1.4', () => {
      const result = runMigrations({}, '0.1.3', [markerStep('0.1.4')]);

      expect(result.version).toBe('0.1.4');
      expect(result.data.markers).toEqual(['0.1.4']);
    });

    it('applies only steps newer than an intermediate release stamp (0.1.5 skips the 0.1.4 step)', () => {
      const result = runMigrations({}, '0.1.5', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data.markers).toEqual(['0.2.0', '0.3.0']);
    });

    it("applies no steps when fromVersion is already at the last migration's release version", () => {
      const result = runMigrations({}, '0.3.0', steps);

      expect(result.version).toBe('0.3.0');
      expect(result.data).toEqual({});
    });

    it("applies no steps when fromVersion is above the last step's `to`", () => {
      const result = runMigrations({}, '9.9.9', steps);

      expect(result.version).toBe('9.9.9');
      expect(result.data).toEqual({});
    });

    // runMigrations is shared with storage reads (settings-repository's toDomain), where a step's
    // error propagates unchanged. Only the import wraps it as migration-failed, so the wrapping
    // must not move in here.
    it("rethrows a step's error as the same object", () => {
      const stepError = new TypeError('step broke');
      const throwing: SchemaMigration = {
        to: '0.2.0',
        migrate: () => {
          throw stepError;
        },
      };

      expect(() => runMigrations({}, '0.1.0', [markerStep('0.1.4'), throwing])).toThrow(stepError);
      let thrown: unknown;
      try {
        runMigrations({}, '0.1.0', [throwing]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(stepError);
    });
  });
});
