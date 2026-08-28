import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { ColorSelection } from '../../../domain/color-selection';
import { type Palette, PaletteEntry, PaletteEntryId } from '../../../domain/palette';
import { MATCH_TYPES, ProjectRuleId } from '../../../domain/project-rule';
import {
  type PlatformBarSettings,
  type PlatformBarTextSettings,
  ProjectSettings,
  type TopBarSettings,
} from '../../../domain/project-settings';
import type { TintSettings } from '../../../domain/tint-settings';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { effectiveSchemaVersion, toDomain } from '../settings-repository';

// The product defaults live private to the domain's project-settings.ts; asserting the literals
// here is deliberate — these tests are what pins them down.
const DEFAULT_COLOR = '#ff6d00';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_TOP_BAR_HEIGHT = 4;

const DEFAULTS = ProjectSettings.DEFAULT;

// Every test color here is a real '#rrggbb' value: Color has no other way in.
const color = (value: string): Color => Color.fromHex(value)!;

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

// Fresh defaults are exactly "no rules": the schema version is persistence metadata and never
// reaches the domain object, so the read side has nothing else to assert.
function expectFreshDefaults(loaded: TintSettings) {
  expect(loaded.projectRules).toEqual([]);
}

describe('toDomain', () => {
  it('returns fresh defaults for null/undefined input', () => {
    expectFreshDefaults(toDomain(null));
    expectFreshDefaults(toDomain(undefined));
  });

  it('returns fresh defaults for non-object input', () => {
    expectFreshDefaults(toDomain('a string'));
    expectFreshDefaults(toDomain(42));
  });

  it('discards data with no schemaVersion (pre-release shape) and returns defaults', () => {
    const oldFlatShape = {
      topBarEnabled: true,
      topBarColor: '#111111',
      paletteEnabled: false,
    };

    expectFreshDefaults(toDomain(oldFlatShape));
  });

  it('discards data whose schemaVersion is below SCHEMA_MIN_VERSION', () => {
    const loaded = toDomain({
      schemaVersion: '0.0.9',
      projectRules: [{ id: '1', pattern: 'x', settings: { topBarColor: '#123456' } }],
    });

    expectFreshDefaults(loaded);
  });

  it('discards data whose schemaVersion is missing or not a string', () => {
    expectFreshDefaults(toDomain({ schemaVersion: 123, projectRules: [] }));
    expectFreshDefaults(toDomain({ projectRules: [] }));
  });

  // Pre-release policy: SCHEMA_MIGRATIONS (migrations.ts) is currently EMPTY. Schema changes
  // before the first release are destructive by design instead of being migrated -- old-shaped
  // fields are simply not recognized by this module's Zod schemas and every section falls back
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

      const loaded = toDomain({
        schemaVersion: '0.1.0',
        projectRules: [
          { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: flatSettings },
          // No matchType on this one: pre-matchType data still falls back to 'regex'.
          { id: 'r2', pattern: 'other-app', settings: flatSettings },
        ],
      });

      expect(loaded.projectRules).toEqual([
        { id: ProjectRuleId.recreate('r1'), matchType: 'exact', pattern: 'my-app', settings: DEFAULTS },
        { id: ProjectRuleId.recreate('r2'), matchType: 'regex', pattern: 'other-app', settings: DEFAULTS },
      ]);
    });

    it('merges nested-shaped settings directly (no migration step runs) at any valid schemaVersion, from the floor up through arbitrarily newer versions', () => {
      const atFloor = toDomain({
        schemaVersion: '0.1.0',
        projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: { platformBarText: { auto: true } } }],
      });
      expect(atFloor.projectRules[0]!.settings.platformBarText.auto).toBe(true);

      const wellAbove = toDomain({
        schemaVersion: '9.9.9',
        projectRules: [
          { id: '1', matchType: 'exact', pattern: 'x', settings: { topBar: { color: { custom: '#00ff00' } } } },
        ],
      });
      expect(wellAbove.projectRules[0]!.settings.topBar.color.custom.toHex()).toBe('#00ff00');
    });
  });

  // Schema change: `defaultProject` has been removed from TintSettings entirely — there is no
  // longer a fallback project when no rule matches. toDomain() never reads a `defaultProject`
  // key, so data still carrying one (even at a valid schemaVersion) simply has it ignored; only
  // `projectRules` is read. This is the intended breaking change.
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

    const loaded = toDomain(stored);

    expect(loaded).not.toHaveProperty('defaultProject');
    expect(loaded.projectRules).toEqual([
      {
        id: ProjectRuleId.recreate('1'),
        matchType: 'exact',
        pattern: 'x',
        settings: projectSettings({
          topBar: DEFAULTS.topBar.withColor(new ColorSelection(undefined, color('#00ff00'))),
        }),
      },
    ]);
  });

  // Schema change: a legacy top-level `paletteEnabled`/`palette` on TintSettings (pre-dating
  // even the per-rule flat shape) is not read anywhere in toDomain — only each rule's own
  // `settings.palette` matters. Junk top-level keys are ignored; the rule falls back to its own
  // default palette.
  it('ignores a legacy top-level palette/paletteEnabled; rules get the default palette', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      paletteEnabled: false,
      palette: [{ id: 'custom', name: 'Custom', color: '#abcdef' }],
      projectRules: [{ id: '1', matchType: 'exact', pattern: 'x', settings: {} }],
    };

    const loaded = toDomain(stored);

    expect(loaded.projectRules[0]!.settings.palette).toEqual(DEFAULTS.palette);
  });

  // Schema change: the old `projects: Record<projectId, ProjectSettings>` map has been replaced
  // by the ordered `projectRules` array. toDomain() only reads `projectRules`, so data still
  // carrying the legacy `projects` key (even at a valid schemaVersion) ends up with an empty
  // projectRules — this is the intended breaking change, not a migration.
  it('ignores a legacy `projects` map (pre-array schema), leaving projectRules empty', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projects: {
        'my-project': { topBarColor: '#00ff00' },
      },
    };

    const loaded = toDomain(stored);

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

    const loaded = toDomain(stored);

    expect(loaded.projectRules).toEqual([
      {
        id: ProjectRuleId.recreate('rule-1'),
        matchType: 'exact',
        pattern: 'my-app',
        settings: projectSettings({
          topBar: DEFAULTS.topBar.withColor(new ColorSelection(DEFAULTS.topBar.color.paletteId, color('#00ff00'))),
        }),
      },
      {
        id: ProjectRuleId.recreate('rule-2'),
        matchType: 'prefix',
        pattern: 'other-app',
        settings: projectSettings({ platformBar: DEFAULTS.platformBar.enableStripes() }),
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

    const loaded = toDomain(stored);

    expect(loaded.projectRules.map((rule) => rule.id.toString())).toEqual(['b', 'a']);
  });

  it('defaults to an empty projectRules array when absent from otherwise-valid data', () => {
    const loaded = toDomain({ schemaVersion: CURRENT_SCHEMA_VERSION });

    expect(loaded.projectRules).toEqual([]);
  });

  it('treats a non-array projectRules value as an empty array', () => {
    const loaded = toDomain({ schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: { notAnArray: true } });

    expect(loaded.projectRules).toEqual([]);
  });

  it('excludes non-object entries and entries whose pattern is not a string', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [
        null,
        'a string',
        42,
        { id: 'no-pattern', settings: {} },
        { id: 'non-string-pattern', pattern: 123, settings: {} },
        { id: 'valid', matchType: 'exact', pattern: 'ok', settings: {} },
      ],
    });

    expect(loaded.projectRules).toEqual([
      { id: ProjectRuleId.recreate('valid'), matchType: 'exact', pattern: 'ok', settings: DEFAULTS },
    ]);
  });

  it('generates a UUID for a rule id when missing from storage', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ pattern: 'no-id', settings: {} }],
    });

    expect(loaded.projectRules).toHaveLength(1);
    expect(typeof loaded.projectRules[0]!.id.toString()).toBe('string');
    expect(loaded.projectRules[0]!.id.toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // Distinct from "missing from storage" above: the id key is PRESENT but wrong-typed. Zod's
  // `.catch()` fires on any parse failure, not just a missing key, so this recovers the same way
  // (rather than e.g. coercing 42 to "42" or dropping the whole rule).
  it('generates a UUID for a rule id that is present but the wrong type (not just missing)', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ id: 42, pattern: 'junk-id', settings: {} }],
    });

    expect(loaded.projectRules).toHaveLength(1);
    expect(loaded.projectRules[0]!.pattern).toBe('junk-id');
    expect(loaded.projectRules[0]!.id.toString()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('falls back to the default ProjectSettings when rule.settings is a string', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ id: '1', pattern: 'a', settings: 'not-an-object' }],
    });

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  it('falls back to the default ProjectSettings when rule.settings is null', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ id: '1', pattern: 'a', settings: null }],
    });

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  // Arrays pass a bare `typeof value === 'object'` check, but Zod's z.object() distinguishes
  // arrays from plain records and rejects them outright, so projectSettingsSchema's outer
  // .catch() recovers to full defaults instead of spreading numeric indices onto the result.
  it('treats an empty array for rule.settings as invalid, falling back to defaults', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ id: '1', pattern: 'a', settings: [] }],
    });

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
  });

  it('treats a non-empty array for rule.settings as invalid, falling back to defaults without extraneous keys', () => {
    const loaded = toDomain({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [{ id: '1', pattern: 'a', settings: ['x', 'y'] }],
    });

    expect(loaded.projectRules[0]!.settings).toEqual(DEFAULTS);
    expect(loaded.projectRules[0]!.settings).not.toHaveProperty('0');
    expect(loaded.projectRules[0]!.settings).not.toHaveProperty('1');
  });

  describe('matchType', () => {
    it('defaults matchType to "regex" when missing from a stored rule (pre-matchType 0.1.0 data)', () => {
      const loaded = toDomain({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: [{ id: '1', pattern: 'x', settings: {} }],
      });

      expect(loaded.projectRules[0]!.matchType).toBe('regex');
    });

    it('defaults matchType to "regex" when a stored rule has an invalid matchType value', () => {
      const loaded = toDomain({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: [
          { id: 'a', pattern: 'x', matchType: 'contains', settings: {} },
          { id: 'b', pattern: 'y', matchType: 42, settings: {} },
        ],
      });

      expect(loaded.projectRules[0]!.matchType).toBe('regex');
      expect(loaded.projectRules[1]!.matchType).toBe('regex');
    });

    it('preserves each valid matchType value from storage', () => {
      const loaded = toDomain({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: MATCH_TYPES.map((matchType, index) => ({
          id: `${index}`,
          pattern: 'x',
          matchType,
          settings: {},
        })),
      });

      expect(loaded.projectRules.map((rule) => rule.matchType)).toEqual(MATCH_TYPES);
    });
  });

  describe('deep merge of ProjectSettings sections', () => {
    const loadWithSettings = (settings: unknown): ProjectSettings =>
      toDomain({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        projectRules: [{ id: '1', matchType: 'exact', pattern: 'a', settings }],
      }).projectRules[0]!.settings;

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
          PaletteEntry.recreate(PaletteEntryId.recreate('custom'), 'Custom', color('#123123')),
        ]);
      });

      it('falls back to the default entries when entries is present but not an array', () => {
        expect(loadWithSettings({ palette: { enabled: false, entries: 'not-an-array' } }).palette).toEqual({
          enabled: false,
          entries: DEFAULTS.palette.entries,
        });
      });

      // Per-element policy (parseEntries): a non-record element can't be coerced into a
      // PaletteEntry at all, so it's dropped -- one bad item never nukes its valid siblings'
      // positions in the array.
      it('drops non-record entries elements (null, string, number, array) while valid siblings survive', () => {
        const entries = loadWithSettings({
          palette: { entries: [null, 'x', 42, [], { id: 'valid', name: 'Valid', color: '#123456' }] },
        }).palette.entries;

        expect(entries).toEqual([PaletteEntry.recreate(PaletteEntryId.recreate('valid'), 'Valid', color('#123456'))]);
      });

      // Contrast with the above: once an element clears the "is it a record" bar, it is NEVER
      // dropped for having junk fields -- each field recovers independently via its own .catch
      // (id -> a generated uuid, name -> '', color -> DEFAULT_COLOR), same per-field policy as
      // every other schema in this module.
      it('always keeps a record entries element, recovering each junk field independently instead of dropping it', () => {
        const entries = loadWithSettings({
          palette: { entries: [{ id: 42, name: 99, color: true }] },
        }).palette.entries;

        expect(entries).toHaveLength(1);
        expect(entries[0]!.id.toString()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
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

      it('converts an explicit stored null paletteId to undefined in the color selection (distinct from "missing")', () => {
        expect(loadWithSettings({ topBar: { color: { paletteId: null } } }).topBar.color).toEqual(
          new ColorSelection(undefined, DEFAULTS.topBar.color.custom),
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
          new ColorSelection(undefined, DEFAULTS.platformBar.color.custom),
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

// ProjectSettings.DEFAULT is built from explicit literals in the domain; this repository sources
// every `.catch()` fallback from it, so these tests pin those values down independently of
// toDomain.
describe('ProjectSettings.DEFAULT (the values this repository recovers to)', () => {
  it('deep-equals the documented default shape (guards against default drift)', () => {
    expect(DEFAULTS).toEqual({
      palette: {
        enabled: true,
        entries: [{ id: PaletteEntryId.recreate('default'), name: 'Primary', color: color(DEFAULT_COLOR) }],
      },
      topBar: {
        enabled: true,
        color: { paletteId: PaletteEntryId.recreate('default'), custom: color(DEFAULT_COLOR) },
        height: DEFAULT_TOP_BAR_HEIGHT,
        stripes: false,
      },
      platformBar: {
        enabled: true,
        color: { paletteId: PaletteEntryId.recreate('default'), custom: color(DEFAULT_COLOR) },
        stripes: false,
      },
      platformBarText: {
        enabled: true,
        color: { paletteId: undefined, custom: color(DEFAULT_TEXT_COLOR) },
        auto: false,
      },
    });
  });

  // Zod 4 pitfall: a `.catch()` fallback given as a static value (object/array) is returned by
  // shared reference on every parse call; this module avoids that by using the function form
  // (`.catch(() => ...)`) everywhere a container is produced. Scoped to the toDomain recovery
  // path, where per-rule freshness still holds: ProjectSettings.DEFAULT itself is deliberately
  // shared (it is immutable), and so are Color values, which are values.
  it('does not share object references between two independently-defaulted ProjectSettings (the .catch function-form guarantee)', () => {
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      projectRules: [
        { id: '1', matchType: 'exact', pattern: 'a', settings: {} },
        { id: '2', matchType: 'exact', pattern: 'b', settings: {} },
      ],
    };

    const loaded = toDomain(stored);
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
    const recolored = first.withPalette(
      first.palette.changeEntryColor(PaletteEntryId.recreate('default'), Color.BLACK),
    );
    expect(recolored.palette.entries[0]!.color.toHex()).toBe('#000000');
    expect(first.palette.entries[0]!.color.toHex()).toBe(DEFAULT_COLOR);
    expect(second.palette.entries[0]!.color.toHex()).toBe(DEFAULT_COLOR);
  });
});

describe('effectiveSchemaVersion', () => {
  it('floors a currentVersion below CURRENT_SCHEMA_VERSION up to CURRENT_SCHEMA_VERSION', () => {
    expect(effectiveSchemaVersion('0.0.5')).toBe(CURRENT_SCHEMA_VERSION);
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
