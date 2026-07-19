import { describe, expect, it } from 'vitest';
import type {
  MatchType,
  PaletteSettings,
  PlatformBarSettings,
  PlatformBarTextSettings,
  ProjectRule,
  ProjectSettings,
  TintSettings,
  TopBarSettings,
} from '../types';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import {
  cloneProjectSettings,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_SETTINGS,
  effectiveSchemaVersion,
  loadSettings,
  MATCH_TYPES,
  resolveProjectSettings,
  resolveSelectedColor,
} from './settings';

const CURRENT_VERSION = '0.2.0';

// Shallow, section-by-section builder for expected/fixture ProjectSettings values. When
// overriding a section's `color`, the full { paletteId, custom } pair must be given (this
// helper does not deep-merge into color) — every call site below does that explicitly.
function projectSettings(
  overrides: {
    palette?: Partial<PaletteSettings>;
    topBar?: Partial<TopBarSettings>;
    platformBar?: Partial<PlatformBarSettings>;
    platformBarText?: Partial<PlatformBarTextSettings>;
  } = {},
): ProjectSettings {
  return {
    palette: { ...DEFAULT_PROJECT_SETTINGS.palette, ...overrides.palette },
    topBar: { ...DEFAULT_PROJECT_SETTINGS.topBar, ...overrides.topBar },
    platformBar: { ...DEFAULT_PROJECT_SETTINGS.platformBar, ...overrides.platformBar },
    platformBarText: { ...DEFAULT_PROJECT_SETTINGS.platformBarText, ...overrides.platformBarText },
  };
}

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

  it('discards data with no schemaVersion (pre-release shape) and returns defaults', () => {
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

  // Regression: freshDefaults() used to stamp the raw currentVersion verbatim. If currentVersion
  // (the manifest version) ever lags behind CURRENT_SCHEMA_VERSION, that wrote a schemaVersion
  // BELOW the nested shape's own version, which the next load would treat as "still needs the
  // flat->nested migration" and silently reset every value to defaults. freshDefaults() now goes
  // through effectiveSchemaVersion() to floor at CURRENT_SCHEMA_VERSION.
  it('floors the stamped schemaVersion at CURRENT_SCHEMA_VERSION when currentVersion is below it (freshDefaults path)', () => {
    const laggingVersion = '0.1.5';

    expect(loadSettings(null, laggingVersion).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(loadSettings('not-an-object', laggingVersion).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(loadSettings({ schemaVersion: '0.0.9', projectRules: [] }, laggingVersion).schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  describe('migration integration', () => {
    it('folds a real 0.1.0 flat fixture forward into the nested shape, preserving every value at its new nested path (with and without a stored matchType)', () => {
      const flatSettings = {
        paletteEnabled: false,
        palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
        topBarEnabled: false,
        topBarColor: '#111111',
        topBarPaletteId: 'custom',
        topBarHeight: 22,
        topBarStripes: true,
        platformBarEnabled: false,
        platformBarColor: '#222222',
        platformBarPaletteId: null,
        platformBarStripes: true,
        platformBarTextEnabled: false,
        platformBarTextColor: '#333333',
        platformBarTextPaletteId: 'custom',
        platformBarTextAuto: true,
      };
      const expectedNested: ProjectSettings = {
        palette: { enabled: false, entries: [{ id: 'custom', name: 'Custom', color: '#abcdef' }] },
        topBar: { enabled: false, color: { paletteId: 'custom', custom: '#111111' }, height: 22, stripes: true },
        platformBar: { enabled: false, color: { paletteId: null, custom: '#222222' }, stripes: true },
        platformBarText: { enabled: false, color: { paletteId: 'custom', custom: '#333333' }, auto: true },
      };

      const loaded = loadSettings(
        {
          schemaVersion: '0.1.0',
          projectRules: [
            { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: flatSettings },
            // No matchType on this one: pre-matchType 0.1.0 data falls back to 'regex'.
            { id: 'r2', pattern: 'other-app', settings: flatSettings },
          ],
        },
        CURRENT_VERSION,
      );

      expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(loaded.projectRules).toEqual([
        { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: expectedNested },
        { id: 'r2', matchType: 'regex', pattern: 'other-app', settings: expectedNested },
      ]);
    });

    it('reads data whose schemaVersion is already newer than CURRENT_SCHEMA_VERSION as-is, without migrating', () => {
      const stored = {
        schemaVersion: '9.9.9',
        projectRules: [
          { id: '1', matchType: 'exact', pattern: 'x', settings: { topBar: { color: { custom: '#00ff00' } } } },
        ],
      };

      const loaded = loadSettings(stored, CURRENT_VERSION);

      expect(loaded.schemaVersion).toBe('9.9.9');
      expect(loaded.projectRules[0].settings.topBar.color.custom).toBe('#00ff00');
    });

    it('does not attempt to migrate data already exactly at CURRENT_SCHEMA_VERSION', () => {
      const stored = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: { platformBarText: { auto: true } } }],
      };

      const loaded = loadSettings(stored, CURRENT_VERSION);

      expect(loaded.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(loaded.projectRules[0].settings.platformBarText.auto).toBe(true);
    });
  });

  // Schema change: `defaultProject` has been removed from TintSettings entirely — there is no
  // longer a fallback project when no rule matches. loadSettings() never reads a
  // `defaultProject` key, so data still carrying one (even at a valid schemaVersion) simply has
  // it ignored; only `projectRules` is read. This is the intended breaking change.
  it('ignores a legacy `defaultProject` key; only projectRules is read', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultProject: projectSettings({ topBar: { color: { paletteId: null, custom: '#654321' } } }),
      projectRules: [
        {
          id: '1',
          matchType: 'exact',
          pattern: 'x',
          settings: { topBar: { color: { paletteId: null, custom: '#00ff00' } } },
        },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded).not.toHaveProperty('defaultProject');
    expect(loaded.projectRules).toEqual([
      {
        id: '1',
        matchType: 'exact',
        pattern: 'x',
        settings: projectSettings({ topBar: { color: { paletteId: null, custom: '#00ff00' } } }),
      },
    ]);
  });

  // Schema change: a legacy top-level `paletteEnabled`/`palette` on TintSettings (pre-dating
  // even the per-rule flat shape) is not read anywhere in loadSettings — only each rule's own
  // `settings.palette` matters. Junk top-level keys are ignored; the rule falls back to its own
  // default palette.
  it('ignores a legacy top-level palette/paletteEnabled; rules get the default palette', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      paletteEnabled: false,
      palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: {} }],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules[0].settings.palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
  });

  // Schema change: the old `projects: Record<projectId, ProjectSettings>` map has been replaced
  // by the ordered `projectRules` array. loadSettings() only reads `projectRules`, so data still
  // carrying the legacy `projects` key (even at a valid schemaVersion) ends up with an empty
  // projectRules — this is the intended breaking change, not a migration.
  it('ignores a legacy `projects` map (pre-array schema), leaving projectRules empty', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projects: {
        'my-project': { topBarColor: '#00ff00' },
      },
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('keeps each valid projectRules entry, merging its settings with the ProjectSettings defaults', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [
        {
          id: 'rule-1',
          matchType: 'exact',
          pattern: 'my-app',
          settings: { topBar: { color: { custom: '#00ff00' } } },
        },
        { id: 'rule-2', matchType: 'prefix', pattern: 'other-app', settings: { platformBar: { stripes: true } } },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([
      {
        id: 'rule-1',
        matchType: 'exact',
        pattern: 'my-app',
        settings: projectSettings({
          topBar: { color: { paletteId: DEFAULT_PROJECT_SETTINGS.topBar.color.paletteId, custom: '#00ff00' } },
        }),
      },
      {
        id: 'rule-2',
        matchType: 'prefix',
        pattern: 'other-app',
        settings: projectSettings({ platformBar: { stripes: true } }),
      },
    ]);
  });

  it('preserves the on-disk order of projectRules (order encodes priority)', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [
        { id: 'b', matchType: 'regex', pattern: 'second', settings: {} },
        { id: 'a', matchType: 'regex', pattern: 'first', settings: {} },
      ],
    };

    const loaded = loadSettings(stored, CURRENT_VERSION);

    expect(loaded.projectRules.map((rule) => rule.id)).toEqual(['b', 'a']);
  });

  it('defaults to an empty projectRules array when absent from otherwise-valid data', () => {
    const loaded = loadSettings({ schemaVersion: CURRENT_SCHEMA_VERSION }, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as an empty array', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: { notAnArray: true } },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toEqual([]);
  });

  it('excludes non-object entries and entries whose pattern is not a string', () => {
    const loaded = loadSettings(
      {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: [
          null,
          'a string',
          42,
          { id: 'no-pattern', settings: {} },
          { id: 'non-string-pattern', pattern: 123, settings: {} },
          { id: 'valid', matchType: 'exact', pattern: 'ok', settings: {} },
        ],
      },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toEqual([
      { id: 'valid', matchType: 'exact', pattern: 'ok', settings: DEFAULT_PROJECT_SETTINGS },
    ]);
  });

  it('generates a UUID for a rule id when missing from storage', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ pattern: 'no-id', settings: {} }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toHaveLength(1);
    expect(typeof loaded.projectRules[0].id).toBe('string');
    expect(loaded.projectRules[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('falls back to the default ProjectSettings when rule.settings is a string', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: 'not-an-object' }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it('falls back to the default ProjectSettings when rule.settings is null', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: null }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  // Arrays pass a bare `typeof value === 'object'` check; mergeProjectSettings() explicitly
  // rejects them (Array.isArray guard) so their numeric indices never spread onto the merged
  // ProjectSettings as extraneous keys.
  it('treats an empty array for rule.settings as invalid, falling back to defaults', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: [] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  });

  it('treats a non-empty array for rule.settings as invalid, falling back to defaults without extraneous keys', () => {
    const loaded = loadSettings(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: ['x', 'y'] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0].settings).toEqual(DEFAULT_PROJECT_SETTINGS);
    expect(loaded.projectRules[0].settings).not.toHaveProperty('0');
    expect(loaded.projectRules[0].settings).not.toHaveProperty('1');
  });

  describe('matchType', () => {
    it('defaults matchType to "regex" when missing from a stored rule (pre-matchType 0.1.0 data)', () => {
      const loaded = loadSettings(
        { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'x', settings: {} }] },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules[0].matchType).toBe('regex');
    });

    it('defaults matchType to "regex" when a stored rule has an invalid matchType value', () => {
      const loaded = loadSettings(
        {
          schemaVersion: CURRENT_SCHEMA_VERSION,
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
          schemaVersion: CURRENT_SCHEMA_VERSION,
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

  describe('deep merge of ProjectSettings sections', () => {
    const loadWithSettings = (settings: unknown): ProjectSettings =>
      loadSettings(
        {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          projectRules: [{ id: '1', matchType: 'exact', pattern: 'a', settings }],
        },
        CURRENT_VERSION,
      ).projectRules[0].settings;

    describe('palette', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
      });

      it('defaults the whole section when it is not an object (junk value)', () => {
        expect(loadWithSettings({ palette: 'not-an-object' }).palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
      });

      it('defaults the whole section when it is an array', () => {
        expect(loadWithSettings({ palette: [] }).palette).toEqual(DEFAULT_PROJECT_SETTINGS.palette);
      });

      it('merges a partial section, keeping the default for fields not provided', () => {
        expect(loadWithSettings({ palette: { enabled: false } }).palette).toEqual({
          enabled: false,
          entries: DEFAULT_PROJECT_SETTINGS.palette.entries,
        });
      });

      it('keeps a valid entries array as-is', () => {
        const customEntries = [{ id: 'custom', name: 'Custom', color: '#123123' }];
        expect(loadWithSettings({ palette: { entries: customEntries } }).palette.entries).toEqual(customEntries);
      });

      it('falls back to the default entries when entries is present but not an array', () => {
        expect(loadWithSettings({ palette: { enabled: false, entries: 'not-an-array' } }).palette).toEqual({
          enabled: false,
          entries: DEFAULT_PROJECT_SETTINGS.palette.entries,
        });
      });
    });

    describe('topBar', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).topBar).toEqual(DEFAULT_PROJECT_SETTINGS.topBar);
      });

      it('defaults the whole section (including color) when it is not an object', () => {
        expect(loadWithSettings({ topBar: 'not-an-object' }).topBar).toEqual(DEFAULT_PROJECT_SETTINGS.topBar);
      });

      it('merges a partial section (non-color fields), keeping defaults for the rest', () => {
        expect(loadWithSettings({ topBar: { height: 20 } }).topBar).toEqual({
          ...DEFAULT_PROJECT_SETTINGS.topBar,
          height: 20,
        });
      });

      it('merges a partial color selection, keeping the default for the field not provided', () => {
        expect(loadWithSettings({ topBar: { color: { custom: '#123456' } } }).topBar.color).toEqual({
          paletteId: DEFAULT_PROJECT_SETTINGS.topBar.color.paletteId,
          custom: '#123456',
        });
      });

      it('preserves an explicit null paletteId in the color selection (distinct from "missing")', () => {
        expect(loadWithSettings({ topBar: { color: { paletteId: null } } }).topBar.color).toEqual({
          paletteId: null,
          custom: DEFAULT_PROJECT_SETTINGS.topBar.color.custom,
        });
      });

      it('defaults the color selection entirely when it is not an object', () => {
        expect(loadWithSettings({ topBar: { color: 'not-an-object', height: 20 } }).topBar).toEqual({
          ...DEFAULT_PROJECT_SETTINGS.topBar,
          height: 20,
        });
      });
    });

    describe('platformBar', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).platformBar).toEqual(DEFAULT_PROJECT_SETTINGS.platformBar);
      });

      it('defaults the whole section when it is not an object', () => {
        expect(loadWithSettings({ platformBar: 42 }).platformBar).toEqual(DEFAULT_PROJECT_SETTINGS.platformBar);
      });

      it('merges a partial section, keeping defaults for the rest', () => {
        expect(loadWithSettings({ platformBar: { stripes: true } }).platformBar).toEqual({
          ...DEFAULT_PROJECT_SETTINGS.platformBar,
          stripes: true,
        });
      });

      it('merges a partial color selection', () => {
        expect(loadWithSettings({ platformBar: { color: { paletteId: null } } }).platformBar.color).toEqual({
          paletteId: null,
          custom: DEFAULT_PROJECT_SETTINGS.platformBar.color.custom,
        });
      });
    });

    describe('platformBarText', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).platformBarText).toEqual(DEFAULT_PROJECT_SETTINGS.platformBarText);
      });

      it('defaults the whole section when it is not an object', () => {
        expect(loadWithSettings({ platformBarText: [] }).platformBarText).toEqual(
          DEFAULT_PROJECT_SETTINGS.platformBarText,
        );
      });

      it('merges a partial section, keeping defaults for the rest', () => {
        expect(loadWithSettings({ platformBarText: { auto: true } }).platformBarText).toEqual({
          ...DEFAULT_PROJECT_SETTINGS.platformBarText,
          auto: true,
        });
      });

      it('merges a partial color selection', () => {
        expect(loadWithSettings({ platformBarText: { color: { custom: '#abcdef' } } }).platformBarText.color).toEqual({
          paletteId: DEFAULT_PROJECT_SETTINGS.platformBarText.color.paletteId,
          custom: '#abcdef',
        });
      });
    });

    // mergeDefined() explicitly skips `undefined` values so a migration step that emits
    // undefined for a field the old shape lacked never clobbers that field's default.
    it('never lets an explicit undefined field clobber its default (mergeDefined contract)', () => {
      const settings = loadWithSettings({
        topBar: { enabled: undefined, height: 30, color: { paletteId: undefined, custom: '#fedcba' } },
      });

      expect(settings.topBar).toEqual({
        ...DEFAULT_PROJECT_SETTINGS.topBar,
        height: 30,
        color: { paletteId: DEFAULT_PROJECT_SETTINGS.topBar.color.paletteId, custom: '#fedcba' },
      });
    });
  });
});

describe('cloneProjectSettings', () => {
  it('deep-copies palette.entries so mutating the clone does not affect the original', () => {
    const original = cloneProjectSettings(DEFAULT_PROJECT_SETTINGS);
    const clone = cloneProjectSettings(original);

    clone.palette.entries.push({ id: 'extra', name: 'Extra', color: '#000000' });
    clone.palette.entries[0].color = '#ffffff';

    expect(original.palette.entries).toHaveLength(1);
    expect(original.palette.entries[0].color).toBe(DEFAULT_PROJECT_SETTINGS.palette.entries[0].color);
  });

  it("deep-copies each surface's color selection so mutating the clone does not affect the original", () => {
    const original = cloneProjectSettings(DEFAULT_PROJECT_SETTINGS);
    const clone = cloneProjectSettings(original);

    clone.topBar.color.custom = '#000000';
    clone.platformBar.color.paletteId = 'changed';
    clone.platformBarText.color.custom = '#000000';

    expect(original.topBar.color.custom).toBe(DEFAULT_PROJECT_SETTINGS.topBar.color.custom);
    expect(original.platformBar.color.paletteId).toBe(DEFAULT_PROJECT_SETTINGS.platformBar.color.paletteId);
    expect(original.platformBarText.color.custom).toBe(DEFAULT_PROJECT_SETTINGS.platformBarText.color.custom);
  });
});

describe('effectiveSchemaVersion', () => {
  it('floors a currentVersion below CURRENT_SCHEMA_VERSION up to CURRENT_SCHEMA_VERSION', () => {
    expect(effectiveSchemaVersion('0.1.5')).toBe(CURRENT_SCHEMA_VERSION);
    expect(effectiveSchemaVersion('0.0.1')).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns currentVersion unchanged when it equals CURRENT_SCHEMA_VERSION', () => {
    expect(effectiveSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns currentVersion unchanged when it is above CURRENT_SCHEMA_VERSION', () => {
    expect(effectiveSchemaVersion('0.3.1')).toBe('0.3.1');
    expect(effectiveSchemaVersion('9.9.9')).toBe('9.9.9');
  });
});

describe('resolveSelectedColor', () => {
  const palette: PaletteSettings = {
    enabled: true,
    entries: [{ id: 'p1', name: 'One', color: '#111111' }],
  };

  it('resolves to the palette entry color when enabled and paletteId references an existing entry', () => {
    expect(resolveSelectedColor(palette, { paletteId: 'p1', custom: '#999999' })).toBe('#111111');
  });

  it('falls back to custom when paletteId does not reference any entry (dangling reference)', () => {
    expect(resolveSelectedColor(palette, { paletteId: 'missing', custom: '#999999' })).toBe('#999999');
  });

  it('falls back to custom when paletteId is null', () => {
    expect(resolveSelectedColor(palette, { paletteId: null, custom: '#999999' })).toBe('#999999');
  });

  it('falls back to custom when the palette is disabled, even with a valid paletteId reference', () => {
    const disabled: PaletteSettings = { ...palette, enabled: false };
    expect(resolveSelectedColor(disabled, { paletteId: 'p1', custom: '#999999' })).toBe('#999999');
  });
});

describe('resolveProjectSettings', () => {
  // Explicit `ProjectRule`/`TintSettings` return types on these two builders are load-bearing:
  // without them, the `matchType` string literals below would widen to `string` and no longer
  // satisfy the `MatchType` union when passed into resolveProjectSettings(). `custom` is used as
  // the per-rule "marker" field (paletteId pinned to null so it always wins over the palette).
  const rule = (id: string, matchType: MatchType, pattern: string, custom: string): ProjectRule => ({
    id,
    matchType,
    pattern,
    settings: projectSettings({ topBar: { color: { paletteId: null, custom } } }),
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
    const settings = withRules(rule('first', 'exact', 'my-app', '#first'), rule('second', 'prefix', 'my', '#second'));

    expect(resolveProjectSettings(settings, 'my-app')?.topBar.color.custom).toBe('#first');
  });

  describe('matchType "prefix"', () => {
    it('matches when the projectId starts with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#p'));
      expect(resolveProjectSettings(settings, 'my-app-prod')?.topBar.color.custom).toBe('#p');
    });

    it('does not match when the projectId does not start with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#p'));
      expect(resolveProjectSettings(settings, 'other-my-app')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const openParen = withRules(rule('1', 'prefix', '(', '#p'));
      expect(resolveProjectSettings(openParen, '(abc')?.topBar.color.custom).toBe('#p');

      const dot = withRules(rule('1', 'prefix', 'a.c', '#p'));
      expect(resolveProjectSettings(dot, 'abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'prefix', '', '#p'));
      expect(resolveProjectSettings(settings, 'literally-anything')?.topBar.color.custom).toBe('#p');
    });
  });

  describe('matchType "suffix"', () => {
    it('matches when the projectId ends with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#s'));
      expect(resolveProjectSettings(settings, 'my-app-prod')?.topBar.color.custom).toBe('#s');
    });

    it('does not match when the projectId does not end with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#s'));
      expect(resolveProjectSettings(settings, 'my-app-prod-2')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const closeParen = withRules(rule('1', 'suffix', ')', '#s'));
      expect(resolveProjectSettings(closeParen, 'abc)')?.topBar.color.custom).toBe('#s');

      const dot = withRules(rule('1', 'suffix', 'a.c', '#s'));
      expect(resolveProjectSettings(dot, 'abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'suffix', '', '#s'));
      expect(resolveProjectSettings(settings, 'literally-anything')?.topBar.color.custom).toBe('#s');
    });
  });

  describe('matchType "exact"', () => {
    it('matches only when the projectId equals the pattern exactly', () => {
      const settings = withRules(rule('1', 'exact', 'my-app', '#e'));
      expect(resolveProjectSettings(settings, 'my-app')?.topBar.color.custom).toBe('#e');
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
      expect(resolveProjectSettings(settings, 'test-project-123')?.topBar.color.custom).toBe('#r');
    });

    it('continues to work for patterns already anchored with ^...$', () => {
      const settings = withRules(rule('1', 'regex', '^abc$', '#r'));
      expect(resolveProjectSettings(settings, 'abc')?.topBar.color.custom).toBe('#r');
      expect(resolveProjectSettings(settings, 'abcd')).toBeNull();
    });

    // The `^(?:...)$` wrapper wraps a non-capturing group around the whole pattern before
    // anchoring, so a top-level `|` stays scoped inside it instead of splitting the anchors
    // themselves (which would let e.g. "bbb" alone escape the leading `^`).
    it('keeps top-level alternation scoped inside the full-match wrapper', () => {
      const settings = withRules(rule('1', 'regex', 'aaa|bbb', '#r'));
      expect(resolveProjectSettings(settings, 'aaa')?.topBar.color.custom).toBe('#r');
      expect(resolveProjectSettings(settings, 'bbb')?.topBar.color.custom).toBe('#r');
      expect(resolveProjectSettings(settings, 'xaaa')).toBeNull();
    });

    it('skips a rule with an invalid regex pattern and evaluates the next rule', () => {
      const settings = withRules(rule('invalid', 'regex', '(', '#invalid'), rule('valid', 'regex', 'my-app', '#valid'));

      expect(resolveProjectSettings(settings, 'my-app')?.topBar.color.custom).toBe('#valid');
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
