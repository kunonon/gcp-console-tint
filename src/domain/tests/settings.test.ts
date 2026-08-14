import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { ColorSelection } from '../color-selection';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { Palette, PaletteEntry } from '../palette';
import { MATCH_TYPES, type MatchType, ProjectRule } from '../project-rule';
import {
  type PlatformBarSettings,
  type PlatformBarTextSettings,
  ProjectSettings,
  type TopBarSettings,
} from '../project-settings';
import { TintSettings } from '../tint-settings';

const CURRENT_VERSION = '0.1.0';

// The product defaults now live private to project-settings.ts; asserting the literals here is
// deliberate — these tests are what pins them down.
const DEFAULT_COLOR = '#ff6d00';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_TOP_BAR_HEIGHT = 4;

const DEFAULTS = ProjectSettings.DEFAULT;

// Every test color here is a real '#rrggbb' value: Color has no other way in.
const color = (value: string): Color => Color.parse(value)!;

// Section-by-section builder for expected ProjectSettings values; sections not overridden come
// from ProjectSettings.DEFAULT.
function projectSettings(
  overrides: {
    palette?: Palette;
    topBar?: TopBarSettings;
    platformBar?: PlatformBarSettings;
    platformBarText?: PlatformBarTextSettings;
  } = {},
): ProjectSettings {
  return new ProjectSettings(
    overrides.palette ?? DEFAULTS.palette,
    overrides.topBar ?? DEFAULTS.topBar,
    overrides.platformBar ?? DEFAULTS.platformBar,
    overrides.platformBarText ?? DEFAULTS.platformBarText,
  );
}

// Fresh defaults are exactly "no rules, stamped with the effective version" — asserted
// field by field now that there is no DEFAULT_SETTINGS object to spread.
function expectFreshDefaults(loaded: TintSettings, schemaVersion: string) {
  expect(loaded.schemaVersion).toBe(schemaVersion);
  expect(loaded.projectRules).toEqual([]);
}

describe('TintSettings.fromStored', () => {
  it('returns fresh defaults stamped with the current version for null/undefined input', () => {
    expectFreshDefaults(TintSettings.fromStored(null, CURRENT_VERSION), CURRENT_VERSION);
    expectFreshDefaults(TintSettings.fromStored(undefined, CURRENT_VERSION), CURRENT_VERSION);
  });

  it('returns fresh defaults for non-object input', () => {
    expectFreshDefaults(TintSettings.fromStored('a string', CURRENT_VERSION), CURRENT_VERSION);
    expectFreshDefaults(TintSettings.fromStored(42, CURRENT_VERSION), CURRENT_VERSION);
  });

  it('discards data with no schemaVersion (pre-release shape) and returns defaults', () => {
    const oldFlatShape = {
      topBarEnabled: true,
      topBarColor: '#111111',
      paletteEnabled: false,
    };

    const loaded = TintSettings.fromStored(oldFlatShape, CURRENT_VERSION);

    expectFreshDefaults(loaded, CURRENT_VERSION);
  });

  it('discards data whose schemaVersion is below SCHEMA_MIN_VERSION', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: '0.0.9', projectRules: [{ id: '1', pattern: 'x', settings: { topBarColor: '#123456' } }] },
      CURRENT_VERSION,
    );

    expectFreshDefaults(loaded, CURRENT_VERSION);
  });

  it('discards data whose schemaVersion is missing or not a string', () => {
    expectFreshDefaults(
      TintSettings.fromStored({ schemaVersion: 123, projectRules: [] }, CURRENT_VERSION),
      CURRENT_VERSION,
    );
    expectFreshDefaults(TintSettings.fromStored({ projectRules: [] }, CURRENT_VERSION), CURRENT_VERSION);
  });

  // Regression: freshDefaults() used to stamp the raw currentVersion verbatim. If currentVersion
  // (the manifest version) ever lags behind CURRENT_SCHEMA_VERSION, that wrote a schemaVersion
  // BELOW the nested shape's own version, which the next load would treat as "still needs the
  // flat->nested migration" and silently reset every value to defaults. freshDefaults() now goes
  // through TintSettings.effectiveSchemaVersion() to floor at CURRENT_SCHEMA_VERSION.
  it('floors the stamped schemaVersion at CURRENT_SCHEMA_VERSION when currentVersion is below it (freshDefaults path)', () => {
    const laggingVersion = '0.0.5';

    expect(TintSettings.fromStored(null, laggingVersion).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(TintSettings.fromStored('not-an-object', laggingVersion).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(TintSettings.fromStored({ schemaVersion: '0.0.9', projectRules: [] }, laggingVersion).schemaVersion).toBe(
      CURRENT_SCHEMA_VERSION,
    );
  });

  // Pre-release policy: SCHEMA_MIGRATIONS (migrations.ts) is currently EMPTY. Schema changes
  // before the first release are destructive by design instead of being migrated -- old-shaped
  // fields are simply not recognized by the domain's Zod schemas and every section falls back
  // to its default. The migration service itself (runMigrations, the injectable `steps` param) is
  // still exercised directly in migrations.test.ts against a synthetic chain, proving it's ready
  // for the first real post-release step.
  describe('destructive pre-release read (SCHEMA_MIGRATIONS is currently empty)', () => {
    it('reads a legacy flat 0.1.0 fixture destructively: rule id/matchType/pattern survive, but every ProjectSettings section falls back to defaults', () => {
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

      const loaded = TintSettings.fromStored(
        {
          schemaVersion: '0.1.0',
          projectRules: [
            { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: flatSettings },
            // No matchType on this one: pre-matchType data still falls back to 'regex'.
            { id: 'r2', pattern: 'other-app', settings: flatSettings },
          ],
        },
        CURRENT_VERSION,
      );

      expect(loaded.schemaVersion).toBe('0.1.0');
      expect(loaded.projectRules).toEqual([
        { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: DEFAULTS },
        { id: 'r2', matchType: 'regex', pattern: 'other-app', settings: DEFAULTS },
      ]);
    });

    it('merges nested-shaped settings directly (no migration step runs) at any valid schemaVersion, from the floor up through arbitrarily newer versions', () => {
      const atFloor = TintSettings.fromStored(
        {
          schemaVersion: '0.1.0',
          projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: { platformBarText: { auto: true } } }],
        },
        CURRENT_VERSION,
      );
      expect(atFloor.schemaVersion).toBe('0.1.0');
      expect(atFloor.projectRules[0]!.settings.platformBarText.auto).toBe(true);

      const wellAbove = TintSettings.fromStored(
        {
          schemaVersion: '9.9.9',
          projectRules: [
            { id: '1', matchType: 'exact', pattern: 'x', settings: { topBar: { color: { custom: '#00ff00' } } } },
          ],
        },
        CURRENT_VERSION,
      );
      expect(wellAbove.schemaVersion).toBe('9.9.9');
      expect(wellAbove.projectRules[0]!.settings.topBar.color.custom.toHex()).toBe('#00ff00');
    });
  });

  // Schema change: `defaultProject` has been removed from TintSettings entirely — there is no
  // longer a fallback project when no rule matches. TintSettings.fromStored() never reads a
  // `defaultProject` key, so data still carrying one (even at a valid schemaVersion) simply has
  // it ignored; only `projectRules` is read. This is the intended breaking change.
  it('ignores a legacy `defaultProject` key; only projectRules is read', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      defaultProject: { topBar: { color: { paletteId: null, custom: '#654321' } } },
      projectRules: [
        {
          id: '1',
          matchType: 'exact',
          pattern: 'x',
          settings: { topBar: { color: { paletteId: null, custom: '#00ff00' } } },
        },
      ],
    };

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);

    expect(loaded).not.toHaveProperty('defaultProject');
    expect(loaded.projectRules).toEqual([
      {
        id: '1',
        matchType: 'exact',
        pattern: 'x',
        settings: projectSettings({ topBar: DEFAULTS.topBar.withColor(new ColorSelection(null, color('#00ff00'))) }),
      },
    ]);
  });

  // Schema change: a legacy top-level `paletteEnabled`/`palette` on TintSettings (pre-dating
  // even the per-rule flat shape) is not read anywhere in fromStored — only each rule's own
  // `settings.palette` matters. Junk top-level keys are ignored; the rule falls back to its own
  // default palette.
  it('ignores a legacy top-level palette/paletteEnabled; rules get the default palette', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      paletteEnabled: false,
      palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: {} }],
    };

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);

    expect(loaded.projectRules[0]!.settings.palette).toEqual(DEFAULTS.palette);
  });

  // Schema change: the old `projects: Record<projectId, ProjectSettings>` map has been replaced
  // by the ordered `projectRules` array. TintSettings.fromStored() only reads `projectRules`, so data still
  // carrying the legacy `projects` key (even at a valid schemaVersion) ends up with an empty
  // projectRules — this is the intended breaking change, not a migration.
  it('ignores a legacy `projects` map (pre-array schema), leaving projectRules empty', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projects: {
        'my-project': { topBarColor: '#00ff00' },
      },
    };

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);

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

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([
      {
        id: 'rule-1',
        matchType: 'exact',
        pattern: 'my-app',
        settings: projectSettings({
          topBar: DEFAULTS.topBar.withColor(new ColorSelection(DEFAULTS.topBar.color.paletteId, color('#00ff00'))),
        }),
      },
      {
        id: 'rule-2',
        matchType: 'prefix',
        pattern: 'other-app',
        settings: projectSettings({ platformBar: DEFAULTS.platformBar.withStripes(true) }),
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

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);

    expect(loaded.projectRules.map((rule) => rule.id)).toEqual(['b', 'a']);
  });

  it('defaults to an empty projectRules array when absent from otherwise-valid data', () => {
    const loaded = TintSettings.fromStored({ schemaVersion: CURRENT_SCHEMA_VERSION }, CURRENT_VERSION);

    expect(loaded.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as an empty array', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: { notAnArray: true } },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toEqual([]);
  });

  it('excludes non-object entries and entries whose pattern is not a string', () => {
    const loaded = TintSettings.fromStored(
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

    expect(loaded.projectRules).toEqual([{ id: 'valid', matchType: 'exact', pattern: 'ok', settings: DEFAULTS }]);
  });

  it('generates a UUID for a rule id when missing from storage', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ pattern: 'no-id', settings: {} }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toHaveLength(1);
    expect(typeof loaded.projectRules[0]!.id).toBe('string');
    expect(loaded.projectRules[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  // Distinct from "missing from storage" above: the id key is PRESENT but wrong-typed. Zod's
  // `.catch()` fires on any parse failure, not just a missing key, so this recovers the same way
  // (rather than e.g. coercing 42 to "42" or dropping the whole rule).
  it('generates a UUID for a rule id that is present but the wrong type (not just missing)', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: 42, pattern: 'junk-id', settings: {} }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules).toHaveLength(1);
    expect(loaded.projectRules[0]!.pattern).toBe('junk-id');
    expect(loaded.projectRules[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('falls back to the default ProjectSettings when rule.settings is a string', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: 'not-an-object' }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  it('falls back to the default ProjectSettings when rule.settings is null', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: null }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  // Arrays pass a bare `typeof value === 'object'` check, but Zod's z.object() distinguishes
  // arrays from plain records and rejects them outright, so ProjectSettingsSchema's outer
  // .catch() recovers to full defaults instead of spreading numeric indices onto the result.
  it('treats an empty array for rule.settings as invalid, falling back to defaults', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: [] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  it('treats a non-empty array for rule.settings as invalid, falling back to defaults without extraneous keys', () => {
    const loaded = TintSettings.fromStored(
      { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'a', settings: ['x', 'y'] }] },
      CURRENT_VERSION,
    );

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
    expect(loaded.projectRules[0]!.settings).not.toHaveProperty('0');
    expect(loaded.projectRules[0]!.settings).not.toHaveProperty('1');
  });

  describe('matchType', () => {
    it('defaults matchType to "regex" when missing from a stored rule (pre-matchType 0.1.0 data)', () => {
      const loaded = TintSettings.fromStored(
        { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [{ id: '1', pattern: 'x', settings: {} }] },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules[0]!.matchType).toBe('regex');
    });

    it('defaults matchType to "regex" when a stored rule has an invalid matchType value', () => {
      const loaded = TintSettings.fromStored(
        {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          projectRules: [
            { id: 'a', pattern: 'x', matchType: 'contains', settings: {} },
            { id: 'b', pattern: 'y', matchType: 42, settings: {} },
          ],
        },
        CURRENT_VERSION,
      );

      expect(loaded.projectRules[0]!.matchType).toBe('regex');
      expect(loaded.projectRules[1]!.matchType).toBe('regex');
    });

    it('preserves each valid matchType value from storage', () => {
      const loaded = TintSettings.fromStored(
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
      TintSettings.fromStored(
        {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          projectRules: [{ id: '1', matchType: 'exact', pattern: 'a', settings }],
        },
        CURRENT_VERSION,
      ).projectRules[0]!.settings;

    describe('palette', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).palette).toEqual(DEFAULTS.palette);
      });

      it('defaults the whole section when it is not an object (junk value)', () => {
        expect(loadWithSettings({ palette: 'not-an-object' }).palette).toEqual(DEFAULTS.palette);
      });

      it('defaults the whole section when it is an array', () => {
        expect(loadWithSettings({ palette: [] }).palette).toEqual(DEFAULTS.palette);
      });

      it('merges a partial section, keeping the default for fields not provided', () => {
        expect(loadWithSettings({ palette: { enabled: false } }).palette).toEqual({
          enabled: false,
          entries: DEFAULTS.palette.entries,
        });
      });

      it('keeps a valid entries array as-is', () => {
        const customEntries = [{ id: 'custom', name: 'Custom', color: '#123123' }];
        expect(loadWithSettings({ palette: { entries: customEntries } }).palette.entries).toEqual([
          new PaletteEntry('custom', 'Custom', color('#123123')),
        ]);
      });

      it('falls back to the default entries when entries is present but not an array', () => {
        expect(loadWithSettings({ palette: { enabled: false, entries: 'not-an-array' } }).palette).toEqual({
          enabled: false,
          entries: DEFAULTS.palette.entries,
        });
      });

      // Per-element policy (palette.ts's parseEntries): a non-record element can't be
      // coerced into a PaletteEntry at all, so it's dropped -- one bad item never nukes its
      // valid siblings' positions in the array.
      it('drops non-record entries elements (null, string, number, array) while valid siblings survive', () => {
        const entries = loadWithSettings({
          palette: { entries: [null, 'x', 42, [], { id: 'valid', name: 'Valid', color: '#123456' }] },
        }).palette.entries;

        expect(entries).toEqual([new PaletteEntry('valid', 'Valid', color('#123456'))]);
      });

      // Contrast with the above: once an element clears the "is it a record" bar, it is NEVER
      // dropped for having junk fields -- each field recovers independently via its own .catch
      // (id -> a generated uuid, name -> '', color -> DEFAULT_COLOR), same per-field policy as
      // every other schema in the domain.
      it('always keeps a record entries element, recovering each junk field independently instead of dropping it', () => {
        const entries = loadWithSettings({
          palette: { entries: [{ id: 42, name: 99, color: true }] },
        }).palette.entries;

        expect(entries).toHaveLength(1);
        expect(entries[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(entries[0]!.name).toBe('');
        expect(entries[0]!.color.toHex()).toBe(DEFAULT_COLOR);
      });
    });

    describe('topBar', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).topBar).toEqual(DEFAULTS.topBar);
      });

      it('defaults the whole section (including color) when it is not an object', () => {
        expect(loadWithSettings({ topBar: 'not-an-object' }).topBar).toEqual(DEFAULTS.topBar);
      });

      it('merges a partial section (non-color fields), keeping defaults for the rest', () => {
        expect(loadWithSettings({ topBar: { height: 20 } }).topBar).toEqual({
          ...DEFAULTS.topBar,
          height: 20,
        });
      });

      it('merges a partial color selection, keeping the default for the field not provided', () => {
        expect(loadWithSettings({ topBar: { color: { custom: '#123456' } } }).topBar.color).toEqual(
          new ColorSelection(DEFAULTS.topBar.color.paletteId, color('#123456')),
        );
      });

      it('preserves an explicit null paletteId in the color selection (distinct from "missing")', () => {
        expect(loadWithSettings({ topBar: { color: { paletteId: null } } }).topBar.color).toEqual(
          new ColorSelection(null, DEFAULTS.topBar.color.custom),
        );
      });

      it('defaults the color selection entirely when it is not an object', () => {
        expect(loadWithSettings({ topBar: { color: 'not-an-object', height: 20 } }).topBar).toEqual({
          ...DEFAULTS.topBar,
          height: 20,
        });
      });
    });

    describe('platformBar', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).platformBar).toEqual(DEFAULTS.platformBar);
      });

      it('defaults the whole section when it is not an object', () => {
        expect(loadWithSettings({ platformBar: 42 }).platformBar).toEqual(DEFAULTS.platformBar);
      });

      it('merges a partial section, keeping defaults for the rest', () => {
        expect(loadWithSettings({ platformBar: { stripes: true } }).platformBar).toEqual({
          ...DEFAULTS.platformBar,
          stripes: true,
        });
      });

      it('merges a partial color selection', () => {
        expect(loadWithSettings({ platformBar: { color: { paletteId: null } } }).platformBar.color).toEqual(
          new ColorSelection(null, DEFAULTS.platformBar.color.custom),
        );
      });
    });

    describe('platformBarText', () => {
      it('defaults the whole section when missing', () => {
        expect(loadWithSettings({}).platformBarText).toEqual(DEFAULTS.platformBarText);
      });

      it('defaults the whole section when it is not an object', () => {
        expect(loadWithSettings({ platformBarText: [] }).platformBarText).toEqual(DEFAULTS.platformBarText);
      });

      it('merges a partial section, keeping defaults for the rest', () => {
        expect(loadWithSettings({ platformBarText: { auto: true } }).platformBarText).toEqual({
          ...DEFAULTS.platformBarText,
          auto: true,
        });
      });

      it('merges a partial color selection', () => {
        expect(loadWithSettings({ platformBarText: { color: { custom: '#abcdef' } } }).platformBarText.color).toEqual(
          new ColorSelection(DEFAULTS.platformBarText.color.paletteId, color('#abcdef')),
        );
      });
    });

    // Zod's `.catch()` fires on ANY parse failure, and `undefined` fails every field schema here
    // (none is `.optional()`) exactly like a missing key does -- so an explicit `undefined`
    // recovers to the default too, the same guarantee a migration step emitting `undefined` for
    // a field the old shape lacked relies on (see migrations.test.ts's synthetic-chain tests).
    it('never lets an explicit undefined field clobber its default (Zod .catch treats it like a missing key)', () => {
      const settings = loadWithSettings({
        topBar: { enabled: undefined, height: 30, color: { paletteId: undefined, custom: '#fedcba' } },
      });

      expect(settings.topBar).toEqual({
        ...DEFAULTS.topBar,
        height: 30,
        color: new ColorSelection(DEFAULTS.topBar.color.paletteId, color('#fedcba')),
      });
    });

    // Stricter than the pre-Zod implementation: the old hand-rolled merge only ever checked
    // `!== undefined` and passed everything else through verbatim, so a wrong-typed field (e.g.
    // height: 'abc') would have landed in the final ProjectSettings unchanged -- a runtime type
    // violation. Each field's `.catch()` now re-validates the type and recovers to its own
    // default instead, independently of its siblings.
    describe('field-level wrong-type recovery (Zod .catch, stricter than the old pass-through)', () => {
      it('recovers a boolean field to its default when the stored value is the wrong type', () => {
        expect(loadWithSettings({ topBar: { enabled: 'yes' } }).topBar.enabled).toBe(true);
        expect(loadWithSettings({ topBar: { stripes: 1 } }).topBar.stripes).toBe(false);
        expect(loadWithSettings({ palette: { enabled: 'nope' } }).palette.enabled).toBe(true);
      });

      it('recovers a number field to its default when the stored value is the wrong type', () => {
        expect(loadWithSettings({ topBar: { height: 'abc' } }).topBar.height).toBe(DEFAULTS.topBar.height);
      });

      it('recovers a string field to its default when the stored value is the wrong type', () => {
        expect(loadWithSettings({ topBar: { color: { custom: 42 } } }).topBar.color.custom.toHex()).toBe(
          DEFAULTS.topBar.color.custom.toHex(),
        );
      });

      // Color parsing tightening: a color STRING that is not '#rrggbb' used to pass through
      // verbatim (CSS would silently ignore it); it now recovers to the default like any other
      // invalid value, and valid uppercase hex is normalized to lowercase.
      it('recovers an invalid (non-#rrggbb) color string to its default and normalizes uppercase hex', () => {
        expect(loadWithSettings({ topBar: { color: { custom: 'banana' } } }).topBar.color.custom.toHex()).toBe(
          DEFAULTS.topBar.color.custom.toHex(),
        );
        expect(
          loadWithSettings({
            palette: { entries: [{ id: 'e1', name: 'X', color: 'banana' }] },
          }).palette.entries[0]!.color.toHex(),
        ).toBe(DEFAULT_COLOR);
        expect(loadWithSettings({ topBar: { color: { custom: '#ABCDEF' } } }).topBar.color.custom.toHex()).toBe(
          '#abcdef',
        );
      });

      it('recovers a nested color.paletteId to its default when the stored value is the wrong type', () => {
        expect(loadWithSettings({ topBar: { color: { paletteId: 42 } } }).topBar.color.paletteId).toBe(
          DEFAULTS.topBar.color.paletteId,
        );
      });

      it('recovers every wrong-typed field independently in one section while a valid sibling field survives untouched', () => {
        const settings = loadWithSettings({
          topBar: {
            enabled: 'yes', // wrong type (string) -> default true
            height: 'abc', // wrong type (string) -> default 4
            stripes: 1, // wrong type (number) -> default false
            color: {
              paletteId: 42, // wrong type (number) -> default 'default'
              custom: '#123456', // valid -> survives
            },
          },
        });

        expect(settings.topBar).toEqual({
          ...DEFAULTS.topBar,
          color: new ColorSelection(DEFAULTS.topBar.color.paletteId, color('#123456')),
        });
      });
    });
  });
});

// ProjectSettings.DEFAULT is built from the section schemas' own defaults, not from a
// hand-written literal -- these tests guard those derived defaults directly, independent of
// fromStored.
describe('ProjectSettings.DEFAULT derivation (Zod schema defaults)', () => {
  it('parse({}) deep-equals the documented default shape (guards against schema-default drift)', () => {
    expect(DEFAULTS).toEqual({
      palette: {
        enabled: true,
        entries: [{ id: 'default', name: 'Primary', color: color(DEFAULT_COLOR) }],
      },
      topBar: {
        enabled: true,
        color: { paletteId: 'default', custom: color(DEFAULT_COLOR) },
        height: DEFAULT_TOP_BAR_HEIGHT,
        stripes: false,
      },
      platformBar: {
        enabled: true,
        color: { paletteId: 'default', custom: color(DEFAULT_COLOR) },
        stripes: false,
      },
      platformBarText: {
        enabled: true,
        color: { paletteId: null, custom: color(DEFAULT_TEXT_COLOR) },
        auto: false,
      },
    });
  });

  // Zod 4 pitfall: a `.catch()` fallback given as a static value (object/array) is returned by
  // shared reference on every parse call; the domain schemas avoid this by using the function
  // form (`.catch(() => ...)`) everywhere a container is produced. Scoped to the fromStored
  // recovery path, where per-rule freshness still holds: ProjectSettings.DEFAULT itself is
  // deliberately shared (it is immutable), and so are Color values, which are values.
  it('does not share object references between two independently-defaulted ProjectSettings (the .catch function-form guarantee)', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [
        { id: '1', matchType: 'exact', pattern: 'a', settings: {} },
        { id: '2', matchType: 'exact', pattern: 'b', settings: {} },
      ],
    };

    const loaded = TintSettings.fromStored(stored, CURRENT_VERSION);
    const settingsByRule = loaded.projectRules.map((rule) => rule.settings);
    const first = settingsByRule[0]!;
    const second = settingsByRule[1]!;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.palette.entries).not.toBe(second.palette.entries);
    expect(first.palette.entries[0]).not.toBe(second.palette.entries[0]);
    expect(first.topBar.color).not.toBe(second.topBar.color);
    expect(first.platformBar.color).not.toBe(second.platformBar.color);
    expect(first.platformBarText.color).not.toBe(second.platformBarText.color);

    // Immutability replaces the old "mutate one and watch the other change" probe: an update
    // returns a new instance and leaves every other holder of the old value untouched.
    const recolored = first.withPalette(first.palette.recolorEntry('default', Color.BLACK));
    expect(recolored.palette.entries[0]!.color.toHex()).toBe('#000000');
    expect(first.palette.entries[0]!.color.toHex()).toBe(DEFAULT_COLOR);
    expect(second.palette.entries[0]!.color.toHex()).toBe(DEFAULT_COLOR);
  });
});

describe('effectiveSchemaVersion', () => {
  it('floors a currentVersion below CURRENT_SCHEMA_VERSION up to CURRENT_SCHEMA_VERSION', () => {
    expect(TintSettings.effectiveSchemaVersion('0.0.5')).toBe(CURRENT_SCHEMA_VERSION);
    expect(TintSettings.effectiveSchemaVersion('0.0.1')).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns currentVersion unchanged when it equals CURRENT_SCHEMA_VERSION', () => {
    expect(TintSettings.effectiveSchemaVersion(CURRENT_SCHEMA_VERSION)).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns currentVersion unchanged when it is above CURRENT_SCHEMA_VERSION', () => {
    expect(TintSettings.effectiveSchemaVersion('0.3.1')).toBe('0.3.1');
    expect(TintSettings.effectiveSchemaVersion('9.9.9')).toBe('9.9.9');
  });
});

describe('Palette.resolve', () => {
  const palette = new Palette(true, [new PaletteEntry('p1', 'One', color('#111111'))]);
  const custom = color('#999999');

  it('resolves to the palette entry color when enabled and paletteId references an existing entry', () => {
    expect(palette.resolve(new ColorSelection('p1', custom)).toHex()).toBe('#111111');
  });

  it('falls back to custom when paletteId does not reference any entry (dangling reference)', () => {
    expect(palette.resolve(new ColorSelection('missing', custom)).toHex()).toBe('#999999');
  });

  it('falls back to custom when paletteId is null', () => {
    expect(palette.resolve(new ColorSelection(null, custom)).toHex()).toBe('#999999');
  });

  it('falls back to custom when the palette is disabled, even with a valid paletteId reference', () => {
    expect(palette.withEnabled(false).resolve(new ColorSelection('p1', custom)).toHex()).toBe('#999999');
  });
});

describe('TintSettings.resolveProjectSettings', () => {
  // `custom` is the per-rule "marker" field (paletteId pinned to null so it always wins over
  // the palette): each rule below gets a distinct — and, since Color validates, real — hex
  // value, so an assertion names which rule won.
  const rule = (id: string, matchType: MatchType, pattern: string, custom: string): ProjectRule =>
    new ProjectRule(
      id,
      matchType,
      pattern,
      projectSettings({ topBar: DEFAULTS.topBar.withColor(new ColorSelection(null, color(custom))) }),
    );

  const noRules = (): TintSettings => TintSettings.fromStored(null, CURRENT_VERSION);

  const withRules = (...rules: ProjectRule[]): TintSettings =>
    rules.reduce((settings, r) => settings.withRuleAdded(r), noRules());

  it('returns null when projectId is null', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#c0ffee'));
    expect(settings.resolveProjectSettings(null)).toBeNull();
  });

  it('returns null when projectId does not match any rule', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#c0ffee'));
    expect(settings.resolveProjectSettings('unrelated-project')).toBeNull();
  });

  it('returns null when there are no rules at all', () => {
    expect(noRules().resolveProjectSettings('anything')).toBeNull();
  });

  it('returns null for an empty-string projectId (falsy, treated the same as no project id)', () => {
    const settings = withRules(rule('catch-all', 'prefix', '', '#aaaaaa'));
    expect(settings.resolveProjectSettings('')).toBeNull();
  });

  it('gives priority to the earlier rule when multiple rules of different matchTypes match the same projectId', () => {
    const settings = withRules(rule('first', 'exact', 'my-app', '#f11111'), rule('second', 'prefix', 'my', '#522222'));

    expect(settings.resolveProjectSettings('my-app')?.topBar.color.custom.toHex()).toBe('#f11111');
  });

  describe('matchType "prefix"', () => {
    it('matches when the projectId starts with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#b0b0b0'));
      expect(settings.resolveProjectSettings('my-app-prod')?.topBar.color.custom.toHex()).toBe('#b0b0b0');
    });

    it('does not match when the projectId does not start with the pattern', () => {
      const settings = withRules(rule('1', 'prefix', 'my-app', '#b0b0b0'));
      expect(settings.resolveProjectSettings('other-my-app')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const openParen = withRules(rule('1', 'prefix', '(', '#b0b0b0'));
      expect(openParen.resolveProjectSettings('(abc')?.topBar.color.custom.toHex()).toBe('#b0b0b0');

      const dot = withRules(rule('1', 'prefix', 'a.c', '#b0b0b0'));
      expect(dot.resolveProjectSettings('abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'prefix', '', '#b0b0b0'));
      expect(settings.resolveProjectSettings('literally-anything')?.topBar.color.custom.toHex()).toBe('#b0b0b0');
    });
  });

  describe('matchType "suffix"', () => {
    it('matches when the projectId ends with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#5a5a5a'));
      expect(settings.resolveProjectSettings('my-app-prod')?.topBar.color.custom.toHex()).toBe('#5a5a5a');
    });

    it('does not match when the projectId does not end with the pattern', () => {
      const settings = withRules(rule('1', 'suffix', '-prod', '#5a5a5a'));
      expect(settings.resolveProjectSettings('my-app-prod-2')).toBeNull();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const closeParen = withRules(rule('1', 'suffix', ')', '#5a5a5a'));
      expect(closeParen.resolveProjectSettings('abc)')?.topBar.color.custom.toHex()).toBe('#5a5a5a');

      const dot = withRules(rule('1', 'suffix', 'a.c', '#5a5a5a'));
      expect(dot.resolveProjectSettings('abc')).toBeNull();
    });

    it('treats an empty pattern as matching any projectId', () => {
      const settings = withRules(rule('1', 'suffix', '', '#5a5a5a'));
      expect(settings.resolveProjectSettings('literally-anything')?.topBar.color.custom.toHex()).toBe('#5a5a5a');
    });
  });

  describe('matchType "exact"', () => {
    it('matches only when the projectId equals the pattern exactly', () => {
      const settings = withRules(rule('1', 'exact', 'my-app', '#e0e0e0'));
      expect(settings.resolveProjectSettings('my-app')?.topBar.color.custom.toHex()).toBe('#e0e0e0');
    });

    it('does not match a projectId that merely contains the pattern as a substring', () => {
      const settings = withRules(rule('1', 'exact', 'my-app', '#e0e0e0'));
      expect(settings.resolveProjectSettings('my-app-prod')).toBeNull();
      expect(settings.resolveProjectSettings('not-my-app')).toBeNull();
    });

    it('an empty pattern matches nothing, since no real projectId is an empty string', () => {
      const settings = withRules(rule('1', 'exact', '', '#e0e0e0'));
      expect(settings.resolveProjectSettings('my-app')).toBeNull();
    });
  });

  describe('matchType "regex"', () => {
    it('requires a full match: an unanchored pattern no longer matches as a substring', () => {
      const settings = withRules(rule('1', 'regex', 'test', '#0e0e0e'));
      expect(settings.resolveProjectSettings('test-project')).toBeNull();
    });

    it('matches when the pattern itself covers the entire projectId (e.g. via a trailing .*)', () => {
      const settings = withRules(rule('1', 'regex', '^test-project.*', '#0e0e0e'));
      expect(settings.resolveProjectSettings('test-project-123')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
    });

    it('continues to work for patterns already anchored with ^...$', () => {
      const settings = withRules(rule('1', 'regex', '^abc$', '#0e0e0e'));
      expect(settings.resolveProjectSettings('abc')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('abcd')).toBeNull();
    });

    // The `^(?:...)$` wrapper wraps a non-capturing group around the whole pattern before
    // anchoring, so a top-level `|` stays scoped inside it instead of splitting the anchors
    // themselves (which would let e.g. "bbb" alone escape the leading `^`).
    it('keeps top-level alternation scoped inside the full-match wrapper', () => {
      const settings = withRules(rule('1', 'regex', 'aaa|bbb', '#0e0e0e'));
      expect(settings.resolveProjectSettings('aaa')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('bbb')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('xaaa')).toBeNull();
    });

    it('skips a rule with an invalid regex pattern and evaluates the next rule', () => {
      const settings = withRules(rule('invalid', 'regex', '(', '#111111'), rule('valid', 'regex', 'my-app', '#222222'));

      expect(settings.resolveProjectSettings('my-app')?.topBar.color.custom.toHex()).toBe('#222222');
    });

    it('returns null when every rule has an invalid regex pattern (no fallback project)', () => {
      const settings = withRules(
        rule('invalid-1', 'regex', '(', '#111111'),
        rule('invalid-2', 'regex', '[', '#222222'),
      );

      expect(settings.resolveProjectSettings('my-app')).toBeNull();
    });

    it('an empty pattern only matches an empty projectId, so it never matches a real projectId', () => {
      const settings = withRules(rule('1', 'regex', '', '#0e0e0e'));
      expect(settings.resolveProjectSettings('literally-anything')).toBeNull();
      expect(settings.resolveProjectSettings('my-app')).toBeNull();
    });
  });
});
