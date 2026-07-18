import { describe, it, expect } from 'vitest';
import { loadSettings, resolveProjectSettings, DEFAULT_SETTINGS, DEFAULT_PROJECT_SETTINGS } from './settings';

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
      { schemaVersion: '0.0.9', defaultProject: { topBarColor: '#123456' } },
      CURRENT_VERSION,
    );

    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: CURRENT_VERSION });
  });

  it('discards data whose schemaVersion is missing or not a string', () => {
    expect(loadSettings({ schemaVersion: 123, defaultProject: {} }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
    expect(loadSettings({ defaultProject: { topBarColor: '#123456' } }, CURRENT_VERSION)).toEqual({
      ...DEFAULT_SETTINGS,
      schemaVersion: CURRENT_VERSION,
    });
  });

  it('reads data at exactly SCHEMA_MIN_VERSION, merging defaultProject with defaults', () => {
    const stored = {
      schemaVersion: '0.1.0',
      paletteEnabled: true,
      palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
      defaultProject: { topBarColor: '#654321' },
      projectRules: [],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.schemaVersion).toBe('0.1.0');
    expect(loaded.defaultProject).toEqual({ ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#654321' });
    expect(loaded.projectRules).toEqual([]);
  });

  it('reads data with a schemaVersion newer than SCHEMA_MIN_VERSION as-is', () => {
    const stored = {
      schemaVersion: '9.9.9',
      paletteEnabled: true,
      palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
      defaultProject: { topBarColor: '#00ff00' },
      projectRules: [],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.schemaVersion).toBe('9.9.9');
    expect(loaded.defaultProject.topBarColor).toBe('#00ff00');
  });

  // Schema change: the old `projects: Record<projectId, ProjectSettings>` map has been
  // replaced by the ordered `projectRules` array. loadSettings() only reads `projectRules`,
  // so data still carrying the legacy `projects` key (even at a valid schemaVersion) is
  // accepted as-is but ends up with an empty projectRules — this is the intended breaking
  // change, not a migration.
  it('ignores a legacy `projects` map (pre-array schema), leaving projectRules empty', () => {
    const stored = {
      schemaVersion: '0.1.0',
      defaultProject: {},
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
      defaultProject: {},
      projectRules: [
        { id: 'rule-1', pattern: 'my-app', settings: { topBarColor: '#00ff00' } },
        { id: 'rule-2', pattern: 'other-app', settings: { platformBarStripes: true } },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([
      { id: 'rule-1', pattern: 'my-app', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#00ff00' } },
      { id: 'rule-2', pattern: 'other-app', settings: { ...DEFAULT_PROJECT_SETTINGS, platformBarStripes: true } },
    ]);
  });

  it('preserves the on-disk order of projectRules (order encodes priority)', () => {
    const stored = {
      schemaVersion: '0.1.0',
      defaultProject: {},
      projectRules: [
        { id: 'b', pattern: 'second', settings: {} },
        { id: 'a', pattern: 'first', settings: {} },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules.map((rule) => rule.id)).toEqual(['b', 'a']);
  });

  it('defaults to an empty projectRules array and default defaultProject when both are absent from otherwise-valid data', () => {
    const loaded = loadSettings({ schemaVersion: '0.1.0', paletteEnabled: false }, CURRENT_VERSION);

    expect(loaded.paletteEnabled).toBe(false);
    expect(loaded.defaultProject).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(loaded.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as an empty array', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', defaultProject: {}, projectRules: { notAnArray: true } },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toEqual([]);
  });

  it('excludes non-object entries and entries whose pattern is not a string', () => {
    const loaded = loadSettings(
      {
        schemaVersion: '0.1.0',
        defaultProject: {},
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

    expect(loaded.projectRules).toEqual([{ id: 'valid', pattern: 'ok', settings: { ...DEFAULT_PROJECT_SETTINGS } }]);
  });

  it('generates a UUID for a rule id when missing from storage', () => {
    const loaded = loadSettings(
      { schemaVersion: '0.1.0', defaultProject: {}, projectRules: [{ pattern: 'no-id', settings: {} }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toHaveLength(1);
    expect(typeof loaded.projectRules[0].id).toBe('string');
    expect(loaded.projectRules[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('resolveProjectSettings', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultProject: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#default' },
    projectRules: [
      { id: '1', pattern: 'my-app', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#known' } },
    ],
  };

  it('matches a pattern as a substring within the projectId (RegExp#test semantics)', () => {
    expect(resolveProjectSettings(settings, 'my-app-prod').topBarColor).toBe('#known');
  });

  it('requires a full match when the pattern is anchored with ^...$', () => {
    const anchored = {
      ...settings,
      projectRules: [
        { id: '1', pattern: '^my-app$', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#exact' } },
      ],
    };

    expect(resolveProjectSettings(anchored, 'my-app').topBarColor).toBe('#exact');
    expect(resolveProjectSettings(anchored, 'my-app-prod').topBarColor).toBe('#default');
  });

  it('gives priority to the earlier rule when multiple rules match the same projectId', () => {
    const prioritized = {
      ...settings,
      projectRules: [
        { id: 'first', pattern: 'my-app', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#first' } },
        { id: 'second', pattern: 'app', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#second' } },
      ],
    };

    expect(resolveProjectSettings(prioritized, 'my-app').topBarColor).toBe('#first');
  });

  it('skips a rule with an invalid regex pattern and evaluates the next rule', () => {
    const withInvalid = {
      ...settings,
      projectRules: [
        { id: 'invalid', pattern: '(', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#invalid' } },
        { id: 'valid', pattern: 'my-app', settings: { ...DEFAULT_PROJECT_SETTINGS, topBarColor: '#valid' } },
      ],
    };

    expect(resolveProjectSettings(withInvalid, 'my-app').topBarColor).toBe('#valid');
  });

  it('returns defaultProject when projectId is null', () => {
    expect(resolveProjectSettings(settings, null).topBarColor).toBe('#default');
  });

  it('returns defaultProject when projectId does not match any rule', () => {
    expect(resolveProjectSettings(settings, 'unrelated-project').topBarColor).toBe('#default');
  });
});
