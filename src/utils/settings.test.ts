import { describe, it, expect } from 'vitest';
import {
  loadSettings,
  resolveProjectSettings,
  cloneProjectSettings,
  DEFAULT_SETTINGS,
  DEFAULT_PROJECT_SETTINGS,
  MATCH_TYPES,
} from './settings';
import type { MatchType, ProjectRule, TintSettings } from '../types';

const CURRENT_VERSION = '0.1.0';

describe('loadSettings', () => {
  it('returns fresh defaults stamped with the current version for null/undefined input', () => {
    expect(loadSettings(null, CURRENT_VERSION)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
    expect(loadSettings(undefined, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
  });

  it('returns fresh defaults for non-object input', () => {
    expect(loadSettings('a string', CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
    expect(loadSettings(42, CURRENT_VERSION)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data with no schemaVersion (old flat v1 shape) and returns defaults', () => {
    const oldFlatShape = {
      topBarEnabled: true,
      topBarColor: '#111111',
      paletteEnabled: false,
    };

    const loaded = loadSettings(oldFlatShape, CURRENT_VERSION);

    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data whose schemaVersion is below SCHEMA_MIN_VERSION', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.0.9', projectRules: [{ id: '1', pattern: 'x', settings: { topBarColor: '#123456' } }] },
      CURRENT_VERSION,
    );

    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data whose schemaVersion is missing or not a string', () => {
    expect(loadSettings({ schemaVersion: 123, projectRules: [] }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
    expect(loadSettings({ projectRules: [] }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
  });

  it('reads data with a schemaVersion newer than SCHEMA_MIN_VERSION as-is', () => {
    const stored = {
      schemaVersion: '9.9.9',
      projectRules: [{ id: '1', pattern: 'x', settings: { topBarColor: '#00ff00' } }],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.schemaVersion).toBe('9.9.9');
    expect(loaded.projectRules[0].settings.topBarColor).toBe('#00ff00');
  });

  // Schema change: `defaultProject` has been removed from TintSettings entirely — there is no
  // longer a fallback project when no rule matches. loadSettings() never reads a
  // `defaultProject` key, so v0/v1 data still carrying one (even at a valid schemaVersion)
  // simply has it ignored; only `projectRules` is read. This is the intended breaking change.
  it('ignores a legacy `defaultProject` key; only projectRules is read', () => {
    const stored = {
      schemaVersion: '0.1.0',
      defaultProject: { topBarColor: '#654321' },
      projectRules: [{ id: '1', pattern: 'x', settings: { topBarColor: '#00ff00' } }],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded).not.toHaveProperty('defaultProject');
    expect(loaded.projectRules).toEqual([
      { id: '1', matchType: 'regex', pattern: 'x', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#00ff00' } },
    ]);
  });

  // Schema change: paletteEnabled/palette moved from TintSettings (top-level) into each
  // ProjectSettings. loadSettings() no longer reads any top-level palette fields, so v0 data
  // still carrying them (even at a valid schemaVersion) has them silently dropped — every
  // rule falls back to its own default palette. This is the intended breaking change.
  it('ignores a legacy top-level palette/paletteEnabled (pre-move schema); rules get the default palette', () => {
    const stored = {
      schemaVersion: '0.1.0',
      paletteEnabled: false,
      palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
      projectRules: [{ id: '1', pattern: 'x', settings: {} }],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules[0].settings.paletteEnabled).toBe(true);
    expect(loaded.projectRules[0].settings.palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
  });

  // Schema change: the old `projects: Record<projectId, ProjectSettings>` map has been
  // replaced by the ordered `projectRules` array. loadSettings() only reads `projectRules`,
  // so data still carrying the legacy `projects` key (even at a valid schemaVersion) is
  // accepted as-is but ends up with an empty projectRules — this is the intended breaking
  // change, not a migration.
  it('ignores a legacy `projects` map (pre-array schema), leaving projectRules empty', () => {
    const stored = {
      schemaVersion: '0.1.0',
      projects: {
        'my-project': { topBarColor: '#00ff00' },
      },
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('keeps each valid projectRules entry, merging its settings with the ProjectSettings defaults', () => {
    const stored = {
      schemaVersion: '0.1.0',
      projectRules: [
        { id: 'rule-1', pattern: 'my-app', settings: { topBarColor: '#00ff00' } },
        { id: 'rule-2', pattern: 'other-app', settings: { platformBarStripes: true } },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([
      {
        id: 'rule-1',
        matchType: 'regex',
        pattern: 'my-app',
        settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#00ff00' },
      },
      {
        id: 'rule-2',
        matchType: 'regex',
        pattern: 'other-app',
        settings: { ...DEFAULT_PROJECT_SETTINGS, platformBarStripes: true },
      },
    ]);
  });

  it('preserves the on-disk order of projectRules (order encodes priority)', () => {
    const stored = {
      schemaVersion: '0.1.0',
      projectRules: [
        { id: 'b', pattern: 'second', settings: {} },
        { id: 'a', pattern: 'first', settings: {} },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules.map((rule) => rule.id)).toEqual(['b', 'a']);
  });

  it('defaults to an empty projectRules array when absent from otherwise-valid data', () => {
    const loaded = loadSettings({ schemaVersion: '0.1.0' }, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as an empty array', () => {
    const loaded = loadSettings({ schemaVersion: '0.1.0', projectRules: { notAnArray: true } }, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('excludes non-object entries and entries whose pattern is not a string', () => {
    const loaded = loadSettings(
      {
        schemaVersion: '0.1.0',
        projectRules: [
          null,
          'a string',
          42,
          { id: 'no-pattern', settings: {} },
          { id: 'non-string-pattern', pattern: 123, settings: {} },
          { id: 'valid', pattern: 'ok', settings: {} },
        ],
      },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toEqual([
      { id: 'valid', matchType: 'regex', pattern: 'ok', settings: { ...DEFAULT_PROJECT_SETTINGS } },
    ]);
  });

  it('generates a UUID for a rule id when missing from storage', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', projectRules: [{ pattern: 'no-id', settings: {} }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toHaveLength(1);
    expect(typeof loaded.projectRules[0].id).toBe('string');
    expect(loaded.projectRules[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('supplies the default palette when a projectRule settings.palette is missing or not an array', () => {
    const loaded = loadSettings(
      {
        schemaVersion: '0.1.0',
        projectRules: [
          { id: 'no-palette', pattern: 'a', settings: {} },
          { id: 'non-array-palette', pattern: 'b', settings: { palette: 'not-an-array' } },
        ],
      },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings.palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
    expect(loaded.projectRules[1].settings.palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
  });

  it('keeps a valid palette array on a projectRule settings as-is', () => {
    const customPalette = [{ id: 'custom', name: 'Custom', color: '#123123' }];
    const loaded = loadSettings(
      {
        schemaVersion: '0.1.0',
        projectRules: [{ id: '1', pattern: 'a', settings: { palette: customPalette } }],
      },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings.palette).toEqual(customPalette);
  });

  it('falls back to the default ProjectSettings when rule.settings is a string', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', projectRules: [{ id: '1', pattern: 'a', settings: 'not-an-object' }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it('falls back to the default ProjectSettings when rule.settings is null', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', projectRules: [{ id: '1', pattern: 'a', settings: null }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  // Arrays pass a bare `typeof value === 'object'` check; mergeProjectSettings() explicitly
  // rejects them (Array.isArray guard) so their numeric indices never spread onto the merged
  // ProjectSettings as extraneous keys.
  it('treats an empty array for rule.settings as invalid, falling back to defaults', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', projectRules: [{ id: '1', pattern: 'a', settings: [] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it('treats a non-empty array for rule.settings as invalid, falling back to defaults without extraneous keys', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', projectRules: [{ id: '1', pattern: 'a', settings: ['x', 'y'] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(loaded.projectRules[0].settings).not.toHaveProperty('0');
    expect(loaded.projectRules[0].settings).not.toHaveProperty('1');
  });

  describe('matchType', () => {
    it('defaults matchType to "regex" when missing from a stored rule (pre-matchType 0.1.0 data)', () => {
      const loaded = loadSettings(
        { schemaVersion: '0.1.0', projectRules: [{ id: '1', pattern: 'x', settings: {} }] },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules[0].matchType).toBe('regex');
    });

    it('defaults matchType to "regex" when a stored rule has an invalid matchType value', () => {
      const loaded = loadSettings(
        {
          schemaVersion: '0.1.0',
          projectRules: [
            { id: 'a', pattern: 'x', matchType: 'contains', settings: {} },
            { id: 'b', pattern: 'y', matchType: 42, settings: {} },
          ],
        },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules[0].matchType).toBe('regex');
      expect(loaded.projectRules[1].matchType).toBe('regex');
    });

    it('preserves each valid matchType value from storage', () => {
      const loaded = loadSettings(
        {
          schemaVersion: '0.1.0',
          projectRules: MATCH_TYPES.map((matchType, index) => ({
            id: `${index}`,
            pattern: 'x',
            matchType,
            settings: {},
          })),
        },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules.map((rule) => rule.matchType)).toEqual(MATCH_TYPES);
    });
  });
});

describe('cloneProjectSettings', () => {
  it('deep-copies the palette array so mutating the clone does not affect the original', () => {
    const original = cloneProjectSettings(DEFAULT_PROJECT_SETTINGS);
    const clone = cloneProjectSettings(original);

    clone.palette.push({ id: 'extra', name: 'Extra', color: '#000000' });
    clone.palette[0].color = '#ffffff';

    expect(original.palette).toHaveLength(1);
    expect(original.palette[0].color).toBe(DEFAULT_PROJECT_SETTINGS.palette[0].color);
  });
});

describe('resolveProjectSettings', () => {
  // Explicit `ProjectRule`/`TintSettings` return types on these two builders are load-bearing:
  // without them, the `matchType` string literals below would widen to `string` and no longer
  // satisfy the `MatchType` union when passed into resolveProjectSettings().
  const rule = (id: string, matchType: MatchType, pattern: string, color: string): ProjectRule => ({
    id,
    matchType,
    pattern,
    settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: color },
  });

  const withRules = (...rules: ProjectRule[]): TintSettings => ({ ...DEFAULT_SETTINGS, projectRules: rules });

  it('returns null when projectId is null', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#known'));
    expect(resolveProjectSettings(settings, null)).toBeNull();
  });

  it('returns null when projectId does not match any rule', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#known'));
    expect(resolveProjectSettings(settings, 'unrelated-project')).toBeNull();
  });

  it('returns null when there are no rules at all', () => {
    expect(resolveProjectSettings(DEFAULT_SETTINGS, 'anything')).toBeNull();
  });

  it('returns null for an empty-string projectId (falsy, treated the same as no project id)', () => {
    const settings = withRules(rule('catch-all', 'prefix', '', '#any'));
    expect(resolveProjectSettings(settings, '')).toBeNull();
  });

  it('gives priority to the earlier rule when multiple rules of different matchTypes match the same projectId', () => {
    const settings = withRules(
      rule('first', 'exact', 'my-app', '#first'),
      rule('second', 'prefix', 'my', '#second'),
    );

    expect(resolveProjectSettings(settings, 'my-app')?.topBarColor).toBe('#first');
  });

  describe('matchType "prefix"', () => {
    it('matches when the projectId starts with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#p'));
      expect(resolveProjectSettings(settings, 'my-app-prod')?.topBarColor).toBe('#p');
    });

    it('does not match when the projectId does not start with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#p'));
      expect(resolveProjectSettings(settings, 'other-my-app')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const openParen = withRules(rule('1', 'prefix', '(', '#p'));
      expect(resolveProjectSettings(openParen, '(abc')?.topBarColor).toBe('#p');

      const dot = withRules(rule('1', 'prefix', 'a.c', '#p'));
      expect(resolveProjectSettings(dot, 'abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'prefix', '', '#p'));
      expect(resolveProjectSettings(settings, 'literally-anything')?.topBarColor).toBe('#p');
    });
  });

  describe('matchType "suffix"', () => {
    it('matches when the projectId ends with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#s'));
      expect(resolveProjectSettings(settings, 'my-app-prod')?.topBarColor).toBe('#s');
    });

    it('does not match when the projectId does not end with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#s'));
      expect(resolveProjectSettings(settings, 'my-app-prod-2')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const closeParen = withRules(rule('1', 'suffix', ')', '#s'));
      expect(resolveProjectSettings(closeParen, 'abc)')?.topBarColor).toBe('#s');

      const dot = withRules(rule('1', 'suffix', 'a.c', '#s'));
      expect(resolveProjectSettings(dot, 'abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'suffix', '', '#s'));
      expect(resolveProjectSettings(settings, 'literally-anything')?.topBarColor).toBe('#s');
    });
  });

  describe('matchType "exact"', () => {
    it('matches only when the projectId equals the pattern exactly', () => {
      const settings = withRules(rule('1', 'exact', 'my-app', '#e'));
      expect(resolveProjectSettings(settings, 'my-app')?.topBarColor).toBe('#e');
    });

    it('does not match a projectId that merely contains the pattern as a substring', () => {
      const settings = withRules(rule('1', 'exact', 'my-app', '#e'));
      expect(resolveProjectSettings(settings, 'my-app-prod')).toBeNull();
      expect(resolveProjectSettings(settings, 'not-my-app')).toBeNull();
    });

    it('an empty pattern matches nothing, since no real projectId is an empty string', () => {
      const settings = withRules(rule('1', 'exact', '', '#e'));
      expect(resolveProjectSettings(settings, 'my-app')).toBeNull();
    });
  });

  describe('matchType "regex"', () => {
    it('requires a full match: an unanchored pattern no longer matches as a substring', () => {
      const settings = withRules(rule('1', 'regex', 'test', '#r'));
      expect(resolveProjectSettings(settings, 'test-project')).toBeNull();
    });

    it('matches when the pattern itself covers the entire projectId (e.g. via a trailing .*)', () => {
      const settings = withRules(rule('1', 'regex', '^test-project.*', '#r'));
      expect(resolveProjectSettings(settings, 'test-project-123')?.topBarColor).toBe('#r');
    });

    it('continues to work for patterns already anchored with ^...$', () => {
      const settings = withRules(rule('1', 'regex', '^abc$', '#r'));
      expect(resolveProjectSettings(settings, 'abc')?.topBarColor).toBe('#r');
      expect(resolveProjectSettings(settings, 'abcd')).toBeNull();
    });

    // The `^(?:...)$` wrapper wraps a non-capturing group around the whole pattern before
    // anchoring, so a top-level `|` stays scoped inside it instead of splitting the anchors
    // themselves (which would let e.g. "bbb" alone escape the leading `^`).
    it('keeps top-level alternation scoped inside the full-match wrapper', () => {
      const settings = withRules(rule('1', 'regex', 'aaa|bbb', '#r'));
      expect(resolveProjectSettings(settings, 'aaa')?.topBarColor).toBe('#r');
      expect(resolveProjectSettings(settings, 'bbb')?.topBarColor).toBe('#r');
      expect(resolveProjectSettings(settings, 'xaaa')).toBeNull();
    });

    it('skips a rule with an invalid regex pattern and evaluates the next rule', () => {
      const settings = withRules(
        rule('invalid', 'regex', '(', '#invalid'),
        rule('valid', 'regex', 'my-app', '#valid'),
      );

      expect(resolveProjectSettings(settings, 'my-app')?.topBarColor).toBe('#valid');
    });

    it('returns null when every rule has an invalid regex pattern (no fallback project)', () => {
      const settings = withRules(
        rule('invalid-1', 'regex', '(', '#invalid1'),
        rule('invalid-2', 'regex', '[', '#invalid2'),
      );

      expect(resolveProjectSettings(settings, 'my-app')).toBeNull();
    });

    it('an empty pattern only matches an empty projectId, so it never matches a real projectId', () => {
      const settings = withRules(rule('1', 'regex', '', '#r'));
      expect(resolveProjectSettings(settings, 'literally-anything')).toBeNull();
      expect(resolveProjectSettings(settings, 'my-app')).toBeNull();
    });
  });
});
