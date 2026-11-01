import { describe, expect, it } from 'vitest';
import { SettingsImportError, type SettingsImportFailure } from '../../../port/settings-store';
import { CURRENT_SCHEMA_VERSION, runMigrations, SCHEMA_MIGRATIONS, type SchemaMigration } from '../migrations';
import { compareVersions, VersionComparisonResult } from '../version';

// Runs `fn`, returning whatever it throws. Fails the test if `fn` does not throw.
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected function to throw, but it did not');
}

function failureOf(error: unknown): SettingsImportFailure {
  expect(error).toBeInstanceOf(SettingsImportError);
  return (error as SettingsImportError).failure;
}

// The paths a step refused, after checking it refused with invalid-fields.
function refusedPaths(error: unknown): string[] {
  const failure = failureOf(error);
  expect(failure.reason).toBe('invalid-fields');
  return failure.reason === 'invalid-fields' ? failure.issues.map((issue) => issue.path) : [];
}

// A rule's settings as 0.1.x-0.4.x stored them: '#rrggbb' strings in every fill slot.
const settings = (
  fills: { entry: unknown; topBar: unknown; platformBar: unknown } = {
    entry: '#111111',
    topBar: '#222222',
    platformBar: '#333333',
  },
  height: unknown = 5,
) => ({
  palette: { enabled: true, entries: [{ id: 'e1', name: 'One', color: fills.entry }] },
  topBar: { enabled: true, color: { paletteId: null, custom: fills.topBar }, height, stripes: false },
  platformBar: { enabled: true, color: { paletteId: 'e1', custom: fills.platformBar }, stripes: false },
  platformBarText: { enabled: true, color: { paletteId: null, custom: '#abcdef' }, auto: false },
});
const tagged = (height: unknown = 5) =>
  settings(
    {
      entry: { type: 'solid', color: '#111111' },
      topBar: { type: 'solid', color: '#222222' },
      platformBar: { type: 'solid', color: '#333333' },
    },
    height,
  );
const file = (ruleSettings: unknown, theme?: string) => ({
  ...(theme === undefined ? {} : { theme }),
  projectRules: [{ id: 'r1', matchType: 'exact', pattern: 'p', settings: ruleSettings }],
});

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
    it.each(['0.1.0', '0.1.3', '0.2.1'])(
      'adds theme auto to %s data, wraps its fills and ends at 0.5.0, keeping every other value',
      (fromVersion) => {
        expect(runMigrations(file(settings()), fromVersion)).toEqual({
          data: file(tagged(), 'auto'),
          version: '0.5.0',
        });
      },
    );

    it.each(['0.3.0', '0.4.1'])('keeps the theme of %s data and only wraps its fills', (fromVersion) => {
      expect(runMigrations(file(settings(), 'dark'), fromVersion)).toEqual({
        data: file(tagged(), 'dark'),
        version: '0.5.0',
      });
    });

    it.each(['0.5.0', '0.5.1', '9.9.9'])('applies nothing from %s up', (fromVersion) => {
      const current = file(tagged(), 'dark');

      expect(runMigrations(current, fromVersion)).toEqual({ data: current, version: fromVersion });
    });

    // The walk is the steps', not the import's: values off it (pattern, matchType, the text's custom)
    // pass through for the checks after the chain to judge.
    it('passes through values off the walk, however wrong', () => {
      const input = {
        projectRules: [{ id: 5, matchType: 'glob', pattern: 42, settings: { ...settings(), platformBarText: 'x' } }],
      };

      expect(runMigrations(input, '0.1.0').data).toEqual({
        theme: 'auto',
        projectRules: [{ id: 5, matchType: 'glob', pattern: 42, settings: { ...tagged(), platformBarText: 'x' } }],
      });
    });
  });

  // 0.1.x saved any finite height; 0.2.0 stores what 0.1.x painted.
  describe('the 0.2.0 step', () => {
    const heightAfter = (height: unknown, from = '0.1.3') =>
      (
        runMigrations(file(settings(undefined, height)), from).data as {
          projectRules: [{ settings: { topBar: { height: unknown } } }];
        }
      ).projectRules[0].settings.topBar.height;

    it.each([
      [2.5, 3],
      [0.5, 1],
      [7.6, 8],
      [40.4, 40],
      [12, 12],
    ])('rounds a 0.1.x height of %s to %s', (stored, expected) => {
      expect(heightAfter(stored)).toBe(expected);
    });

    it.each([
      ['0', 0],
      ['50', 50],
      ['-3', -3],
      ['40.5 (rounds to 41)', 40.5],
      ['1e21', 1e21],
    ])("replaces a 0.1.x height of %s with 0.1.x's default 4", (_label, stored) => {
      expect(heightAfter(stored)).toBe(4);
    });

    it.each(['0.2.0', '0.2.1', '0.4.1'])('does not run from %s up', (from) => {
      expect(heightAfter(2.5, from)).toBe(2.5);
    });

    it.each([
      ['a string height', file(settings(undefined, '12')), ['projectRules[0].settings.topBar.height']],
      [
        'a missing height',
        file({ ...settings(), topBar: { enabled: true } }),
        ['projectRules[0].settings.topBar.height'],
      ],
      ['a missing topBar', file({ palette: settings().palette }), ['projectRules[0].settings.topBar']],
      ['a null topBar', file({ ...settings(), topBar: null }), ['projectRules[0].settings.topBar']],
      [
        'the pre-release flat settings',
        file({ palette: ['#111111'], topBarColor: '#222222', topBarHeight: 22 }),
        ['projectRules[0].settings.topBar'],
      ],
      ['settings that is not an object', file('x'), ['projectRules[0].settings']],
      ['null settings', file(null), ['projectRules[0].settings']],
      ['a missing settings', { projectRules: [{ id: 'r1', pattern: 'p' }] }, ['projectRules[0].settings']],
      [
        'rules that are not objects',
        { projectRules: ['x', null, [], 5] },
        ['projectRules[0]', 'projectRules[1]', 'projectRules[2]', 'projectRules[3]'],
      ],
      ['projectRules that is not an array', { projectRules: { 0: 'x' } }, ['projectRules']],
      ['a missing projectRules', {}, ['projectRules']],
    ])('refuses 0.1.x data with %s, at its path, without mutating it', (_label, data, expected) => {
      const before = structuredClone(data);

      expect(refusedPaths(thrownBy(() => runMigrations(data, '0.1.3')))).toEqual(expected);
      expect(data).toEqual(before);
    });

    // 0.1.x saved a height only when Number.isFinite passed, so a non-finite one is not 0.1.x data.
    it.each([
      ['a string', '12'],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ])("refuses %s height in the step's own words", (_label, height) => {
      expect(failureOf(thrownBy(() => runMigrations(file(settings(undefined, height)), '0.1.0')))).toEqual({
        reason: 'invalid-fields',
        issues: [{ path: 'projectRules[0].settings.topBar.height', message: 'expected a finite number' }],
      });
    });

    // The chain stops at the first step that refuses: a 0.1.x file with both a bad height and a
    // bad fill reports only the height.
    it('stops the chain before the 0.5.0 step', () => {
      const data = file(settings({ entry: 5, topBar: '#222222', platformBar: '#333333' }, '12'));

      expect(refusedPaths(thrownBy(() => runMigrations(data, '0.1.3')))).toEqual([
        'projectRules[0].settings.topBar.height',
      ]);
    });

    it('does not mutate the input it converts', () => {
      const input = file(settings(undefined, 2.5));
      const before = structuredClone(input);

      runMigrations(input, '0.1.3');

      expect(input).toEqual(before);
    });
  });

  describe('the 0.5.0 step', () => {
    it.each(['0.3.0', '0.4.1'])("wraps %s's '#rrggbb' fills as solid, leaving the text's custom a string", (from) => {
      expect(runMigrations(file(settings(), 'dark'), from)).toEqual({ data: file(tagged(), 'dark'), version: '0.5.0' });
    });

    // A string is wrapped whatever it holds: whether it is a usable color is judged after the chain.
    it('wraps a string that is not a color too', () => {
      const input = file(settings({ entry: 'banana', topBar: '', platformBar: '#333333' }), 'dark');

      expect(runMigrations(input, '0.4.1').data).toEqual(
        file(
          settings({
            entry: { type: 'solid', color: 'banana' },
            topBar: { type: 'solid', color: '' },
            platformBar: { type: 'solid', color: '#333333' },
          }),
          'dark',
        ),
      );
    });

    // Only strings are wrapped. A tagged fill under a pre-0.5.0 stamp is a shape no release wrote.
    it.each([
      ['a tagged solid', { type: 'solid', color: '#111111' }],
      ['a tagged gradient', { type: 'gradient', stops: [{ color: '#111111', position: 0 }] }],
      ['an untagged { stops }', { stops: [{ color: '#111111', position: 0 }] }],
      ['a number', 5],
      ['null', null],
    ])('refuses %s in every fill slot, at each path', (_label, fill) => {
      const input = file(settings({ entry: fill, topBar: fill, platformBar: fill }), 'dark');
      const before = structuredClone(input);

      expect(failureOf(thrownBy(() => runMigrations(input, '0.4.1')))).toEqual({
        reason: 'invalid-fields',
        issues: [
          { path: 'projectRules[0].settings.palette.entries[0].color', message: 'expected a color like #rrggbb' },
          { path: 'projectRules[0].settings.topBar.color.custom', message: 'expected a color like #rrggbb' },
          { path: 'projectRules[0].settings.platformBar.color.custom', message: 'expected a color like #rrggbb' },
        ],
      });
      expect(input).toEqual(before);
    });

    it.each([
      [
        'missing fill slots',
        { palette: { entries: [{ id: 'e1' }] }, topBar: { color: {} }, platformBar: { color: {} } },
        [
          'projectRules[0].settings.palette.entries[0].color',
          'projectRules[0].settings.topBar.color.custom',
          'projectRules[0].settings.platformBar.color.custom',
        ],
      ],
      [
        'missing bars',
        { palette: { entries: [] } },
        ['projectRules[0].settings.topBar', 'projectRules[0].settings.platformBar'],
      ],
      [
        'missing colors',
        { palette: { entries: [] }, topBar: {}, platformBar: { color: null } },
        ['projectRules[0].settings.topBar.color', 'projectRules[0].settings.platformBar.color'],
      ],
      [
        'a missing palette',
        { topBar: settings().topBar, platformBar: settings().platformBar },
        ['projectRules[0].settings.palette'],
      ],
      [
        'a null palette and bars that are not objects',
        { palette: null, topBar: 'x', platformBar: 5 },
        ['projectRules[0].settings.palette', 'projectRules[0].settings.topBar', 'projectRules[0].settings.platformBar'],
      ],
      [
        'entries that is not an array',
        { ...settings(), palette: { enabled: true, entries: '#111111' } },
        ['projectRules[0].settings.palette.entries'],
      ],
      [
        'entries that are not objects',
        { ...settings(), palette: { enabled: true, entries: ['#111111', null] } },
        ['projectRules[0].settings.palette.entries[0]', 'projectRules[0].settings.palette.entries[1]'],
      ],
      [
        'the pre-release flat settings (palette an array)',
        { palette: ['#111111'], topBarColor: '#222222' },
        ['projectRules[0].settings.palette', 'projectRules[0].settings.topBar', 'projectRules[0].settings.platformBar'],
      ],
    ])('refuses 0.4.x data with %s, at each path, without mutating it', (_label, ruleSettings, expected) => {
      const input = file(ruleSettings, 'dark');
      const before = structuredClone(input);

      expect(refusedPaths(thrownBy(() => runMigrations(input, '0.4.1')))).toEqual(expected);
      expect(input).toEqual(before);
    });

    it.each([
      ['projectRules that is not an array', { projectRules: { 0: 'x' } }, ['projectRules']],
      [
        'a rule that is not an object',
        { projectRules: ['x', null, 5] },
        ['projectRules[0]', 'projectRules[1]', 'projectRules[2]'],
      ],
      ['null settings', file(null), ['projectRules[0].settings']],
    ])('refuses %s', (_label, data, expected) => {
      expect(refusedPaths(thrownBy(() => runMigrations(data, '0.4.1')))).toEqual(expected);
    });

    // Every rule is walked: the issues of all of them come out in one refusal, in rule order.
    it('collects the issues of every rule in one pass', () => {
      const input = {
        theme: 'dark',
        projectRules: [
          {
            id: 'a',
            matchType: 'exact',
            pattern: 'a',
            settings: settings({ entry: 1, topBar: '#222222', platformBar: '#333333' }),
          },
          { id: 'b', matchType: 'exact', pattern: 'b', settings: settings() },
          {
            id: 'c',
            matchType: 'exact',
            pattern: 'c',
            settings: settings({ entry: '#111111', topBar: '#222222', platformBar: {} }),
          },
        ],
      };

      expect(refusedPaths(thrownBy(() => runMigrations(input, '0.4.1')))).toEqual([
        'projectRules[0].settings.palette.entries[0].color',
        'projectRules[2].settings.platformBar.color.custom',
      ]);
    });

    // As the import's own stages: 100 issues are kept, and the 101st stops the walk.
    it('keeps 100 issues and marks the refusal validationStopped at the 101st', () => {
      const entries = Array.from({ length: 150 }, (_, i) => ({ id: `e${i}`, name: '', color: i }));
      const input = file({ ...settings(), palette: { enabled: true, entries } }, 'dark');

      const failure = failureOf(thrownBy(() => runMigrations(input, '0.4.1')));

      expect(failure).toMatchObject({ reason: 'invalid-fields', validationStopped: true });
      const issues = failure.reason === 'invalid-fields' ? failure.issues : [];
      expect(issues).toHaveLength(100);
      expect(issues[99]!.path).toBe('projectRules[0].settings.palette.entries[99].color');
    });

    it('does not mark exactly 100 issues validationStopped', () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({ id: `e${i}`, name: '', color: i }));
      const input = file({ ...settings(), palette: { enabled: true, entries } }, 'dark');

      const failure = failureOf(thrownBy(() => runMigrations(input, '0.4.1')));

      expect(failure.reason).toBe('invalid-fields');
      expect(failure).not.toHaveProperty('validationStopped');
      expect(failure.reason === 'invalid-fields' ? failure.issues : []).toHaveLength(100);
    });

    it.each(['0.5.0', '0.5.1'])('wraps nothing from %s up', (from) => {
      const input = file(settings(), 'dark');

      expect(runMigrations(input, from).data).toEqual(input);
    });

    it('does not mutate the input it wraps', () => {
      const input = file(settings(), 'dark');
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

    // The reader (settings-file's readSettingsValue) decides what a step's error means: a step's
    // SettingsImportError keeps its paths, anything else becomes migration-failed. So the error
    // must reach it as the same object.
    it("rethrows a step's error as the same object", () => {
      const stepError = new TypeError('step broke');
      const throwing: SchemaMigration = {
        to: '0.2.0',
        migrate: () => {
          throw stepError;
        },
      };

      expect(() => runMigrations({}, '0.1.0', [markerStep('0.1.4'), throwing])).toThrow(stepError);
      expect(thrownBy(() => runMigrations({}, '0.1.0', [throwing]))).toBe(stepError);
    });
  });
});
