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

    // This data has no fills for the 0.5.0 step to wrap, so the chain ends there with only the 0.3.0
    // theme added.
    it.each(['0.1.0', '0.2.1'])(
      'adds theme auto to %s data and ends at 0.5.0, keeping every other key',
      (fromVersion) => {
        expect(runMigrations(data, fromVersion)).toEqual({ data: { ...data, theme: 'auto' }, version: '0.5.0' });
      },
    );

    it.each(['0.3.0', '0.3.1'])('moves %s data to 0.5.0 without changing it', (fromVersion) => {
      const current = { ...data, theme: 'dark' };

      expect(runMigrations(current, fromVersion)).toEqual({ data: current, version: '0.5.0' });
    });

    it.each(['0.5.0', '0.5.1', '9.9.9'])('applies nothing from %s up', (fromVersion) => {
      const current = { ...data, theme: 'dark' };

      expect(runMigrations(current, fromVersion)).toEqual({ data: current, version: fromVersion });
    });
  });

  describe('the 0.5.0 step', () => {
    const settings = (fills: { entry: unknown; topBar: unknown; platformBar: unknown }) => ({
      palette: { enabled: true, entries: [{ id: 'e1', name: 'One', color: fills.entry }] },
      topBar: { enabled: true, color: { paletteId: null, custom: fills.topBar }, height: 5, stripes: false },
      platformBar: { enabled: true, color: { paletteId: 'e1', custom: fills.platformBar }, stripes: false },
      platformBarText: { enabled: true, color: { paletteId: null, custom: '#abcdef' }, auto: false },
    });
    const file = (ruleSettings: unknown) => ({
      theme: 'dark',
      projectRules: [{ id: 'r1', matchType: 'exact', pattern: 'p', settings: ruleSettings }],
    });

    it.each(['0.3.0', '0.4.1'])("wraps %s's '#rrggbb' fills as solid, leaving the text's custom a string", (from) => {
      const input = file(settings({ entry: '#111111', topBar: '#222222', platformBar: '#333333' }));

      expect(runMigrations(input, from)).toEqual({
        data: file(
          settings({
            entry: { type: 'solid', color: '#111111' },
            topBar: { type: 'solid', color: '#222222' },
            platformBar: { type: 'solid', color: '#333333' },
          }),
        ),
        version: '0.5.0',
      });
    });

    // Only strings are wrapped: a fill that is already tagged is not wrapped twice, and anything else
    // is left for the reader to repair or the import to refuse.
    it.each([
      ['a tagged solid', { type: 'solid', color: '#111111' }],
      ['a tagged gradient', { type: 'gradient', stops: [{ color: '#111111', position: 0 }] }],
      ['an untagged { stops }', { stops: [{ color: '#111111', position: 0 }] }],
      ['a number', 5],
      ['null', null],
    ])('passes %s through untouched', (_label, fill) => {
      const input = file(settings({ entry: fill, topBar: fill, platformBar: fill }));

      expect(runMigrations(input, '0.4.1').data).toEqual(input);
    });

    // toStrictEqual, since toEqual would let an added `color: undefined` or `topBar: undefined` through.
    it.each([
      ['fill slots', { palette: { entries: [{ id: 'e1' }] }, topBar: { color: {} }, platformBar: {} }],
      ['bars', { palette: { entries: [] } }],
    ])('does not add %s the data did not have', (_label, ruleSettings) => {
      const input = file(ruleSettings);

      expect(runMigrations(input, '0.4.1').data).toStrictEqual(input);
    });

    it.each(['0.5.0', '0.5.1'])('wraps nothing from %s up', (from) => {
      const input = file(settings({ entry: '#111111', topBar: '#222222', platformBar: '#333333' }));

      expect(runMigrations(input, from).data).toEqual(input);
    });

    // toDomain runs the chain against raw storage without a catch, so no JSON may make it throw, and
    // the caller's data must come back unchanged.
    it.each([
      ['projectRules that is not an array', { projectRules: { 0: 'x' } }],
      ['a rule that is not an object', { projectRules: ['x', null, 5] }],
      ['settings that is not an object', file('x')],
      ['null settings', file(null)],
      ['the pre-0.3.0 flat settings (palette an array)', file({ palette: ['#111111'], topBarColor: '#222222' })],
      ['entries that is not an array', file({ palette: { entries: '#111111' } })],
      ['an entry that is not an object', file({ palette: { entries: ['#111111', null] } })],
      ['a null palette', file({ palette: null })],
      ['a null topBar color', file({ topBar: { color: null }, platformBar: { color: '#111111' } })],
      ['a null bar', file({ topBar: null, platformBar: 'x' })],
    ])('neither throws on nor mutates %s', (_label, data) => {
      const before = structuredClone(data);

      expect(() => runMigrations(data, '0.4.1')).not.toThrow();
      expect(data).toEqual(before);
    });

    it('does not mutate the input it wraps', () => {
      const input = file(settings({ entry: '#111111', topBar: '#222222', platformBar: '#333333' }));
      const before = structuredClone(input);

      runMigrations(input, '0.4.1');

      expect(input).toEqual(before);
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
