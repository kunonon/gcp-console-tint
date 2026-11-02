import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { ColorSelection } from '../../../domain/color-selection';
import { type Fill, Gradient } from '../../../domain/gradient';
import { Palette, PaletteEntry, PaletteEntryId } from '../../../domain/palette';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import {
  type PlatformBarSettings,
  type PlatformBarTextSettings,
  ProjectSettings,
  type TopBarSettings,
} from '../../../domain/project-settings';
import { THEMES, TintSettings } from '../../../domain/tint-settings';
import { TopBarHeight } from '../../../domain/top-bar-height';
import { SettingsImportError, StoredSettingsError, type StoredSettingsFailure } from '../../../port/settings-store';
import { CURRENT_SCHEMA_VERSION } from '../migrations';
import { effectiveSchemaVersion, toDomain, toStored } from '../settings-repository';

// The product defaults live private to the domain's project-settings.ts; asserting the literals
// here is deliberate — these tests are what pins them down.
const DEFAULT_COLOR = '#ff6d00';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_TOP_BAR_HEIGHT = 4;

// Every test height here is a real in-range whole number of pixels: TopBarHeight has no other
// way in.
const height = (pixels: number): TopBarHeight => TopBarHeight.fromPixels(pixels)!;

const DEFAULTS = ProjectSettings.DEFAULT;

// Every test color here is a real '#rrggbb' value: Color has no other way in.
const color = (value: string): Color => Color.fromHex(value)!;
// Stops at the given positions, or spread evenly over the bar when the colors come alone.
const at = (...stops: [string, number][]): Gradient =>
  Gradient.fromStops(stops.map(([hex, position]) => ({ color: color(hex), position })))!;
const gradient = (...values: string[]): Gradient =>
  at(...values.map((hex, i): [string, number] => [hex, Math.round((i * 100) / (values.length - 1))]));
// Fills in their stored shape.
const storedSolid = (color: unknown) => ({ type: 'solid', color });
const storedStops = (...stops: [unknown, unknown][]) => ({
  type: 'gradient',
  stops: stops.map(([color, position]) => ({ color, position })),
});
// A solid fill's hex; a gradient (or nothing) reads as undefined, so a solid assertion fails on it.
const hexOf = (fill: Fill | undefined): string | undefined => (fill instanceof Color ? fill.toHex() : undefined);

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

// Reads a value as a build at CURRENT_SCHEMA_VERSION does.
const read = (stored: unknown) => toDomain(stored, CURRENT_SCHEMA_VERSION);

// The StoredSettingsError reading `stored` throws. Fails the test if it reads.
function refusalOf(stored: unknown, currentVersion = CURRENT_SCHEMA_VERSION): StoredSettingsError {
  let thrown: unknown;
  try {
    toDomain(stored, currentVersion);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(StoredSettingsError);
  return thrown as StoredSettingsError;
}

const failureOf = (stored: unknown): StoredSettingsFailure => refusalOf(stored).failure;

// The paths of an invalid-fields refusal, after checking the reason. The messages' wording is the
// import's and is pinned in settings-file.test.ts.
function refusedPaths(stored: unknown): string[] {
  const failure = failureOf(stored);
  expect(failure.reason).toBe('invalid-fields');
  return failure.reason === 'invalid-fields' ? failure.issues.map((issue) => issue.path) : [];
}

// A rule as raw JSON, deliberately untyped: the fixtures below must be able to violate the shape.
// biome-ignore lint/suspicious/noExplicitAny: the fixtures must be able to violate the shape
type RawRule = any;

// What this build itself stores for one default rule; each case differs from it in one place.
function validStored(): { schemaVersion: string; theme: string; projectRules: RawRule[] } {
  const rule = ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', DEFAULTS);
  return toStored(new TintSettings([rule], 'auto'), CURRENT_SCHEMA_VERSION);
}

function storedWithRule(mutate: (rule: RawRule) => void) {
  const stored = validStored();
  mutate(stored.projectRules[0]);
  return stored;
}

describe('toDomain: what storage may hold', () => {
  // An absent key is the only empty state: an unconfigured install.
  it('reads an absent value as no rules under the default theme', () => {
    const loaded = read(undefined);

    expect(loaded.projectRules).toEqual([]);
    expect(loaded.theme).toBe('auto');
  });

  it('reads zero rules as stored, theme included', () => {
    expect(read({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'dark', projectRules: [] })).toEqual(
      new TintSettings([], 'dark'),
    );
  });

  it('reads a value this build stored as the settings it stored', () => {
    const rule = ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', DEFAULTS);

    expect(read(validStored())).toEqual(new TintSettings([rule], 'auto'));
  });

  // No writer stores any of these; null included (only an absent key is unconfigured).
  it.each([
    ['null', null],
    ['a string', 'not-a-settings-record'],
    ['an empty string', ''],
    ['a number', 42],
    ['a boolean', false],
    ['an array', [{ schemaVersion: CURRENT_SCHEMA_VERSION }]],
    ['a record without schemaVersion', { theme: 'auto', projectRules: [] }],
    ['a pre-release flat record', { topBarEnabled: true, topBarColor: '#111111' }],
    ['a non-string schemaVersion', { schemaVersion: 123, projectRules: [] }],
    ['a hex schemaVersion', { schemaVersion: '0x10', projectRules: [] }],
    ['an empty version component', { schemaVersion: '0..5', projectRules: [] }],
  ])('refuses %s as not-settings', (_label, stored) => {
    expect(failureOf(stored)).toEqual({ reason: 'not-settings' });
  });

  it('refuses a stamp below SCHEMA_MIN_VERSION as unsupported-version', () => {
    expect(failureOf({ schemaVersion: '0.0.9', theme: 'auto', projectRules: [] })).toEqual({
      reason: 'unsupported-version',
      version: '0.0.9',
    });
  });

  // A newer build's data would lose its unknown fields on the next save, so it is not read at all.
  it('refuses a stamp above the effective version as newer-version', () => {
    const error = refusalOf({ schemaVersion: '99.0.0', theme: 'auto', projectRules: [] });

    expect(error.failure).toEqual({ reason: 'newer-version', version: '99.0.0' });
    expect(error.message).toBe('Saved settings version 99.0.0 is newer than this extension');
  });

  it('reads a stamp up to the effective version it is given', () => {
    const stored = { ...validStored(), schemaVersion: '0.5.7' };

    expect(toDomain(stored, '0.5.7').projectRules).toHaveLength(1);
    expect(refusalOf(stored, '0.5.6').failure).toEqual({ reason: 'newer-version', version: '0.5.7' });
  });

  it('carries the stored value as is and the import refusal as the cause', () => {
    const stored = storedWithRule((rule) => {
      rule.pattern = 42;
    });

    const error = refusalOf(stored);

    expect(error.name).toBe('StoredSettingsError');
    expect(error.raw).toBe(stored);
    expect(error.cause).toBeInstanceOf(SettingsImportError);
    expect((error.cause as SettingsImportError).failure).toBe(error.failure);
    expect(error.message).toBe('Saved settings have missing or invalid fields (1)');
  });

  it('never repairs the stored value it refuses', () => {
    const stored = storedWithRule((rule) => {
      rule.settings.topBar.height = 0;
    });
    const before = structuredClone(stored);

    refusalOf(stored);

    expect(stored).toEqual(before);
  });
});

describe('toDomain: fields are read strictly', () => {
  it.each<[string, (rule: RawRule) => void, string[]]>([
    ['a missing pattern', (rule) => delete rule.pattern, ['projectRules[0].pattern']],
    ['a non-string pattern', (rule) => (rule.pattern = 123), ['projectRules[0].pattern']],
    ['a missing id', (rule) => delete rule.id, ['projectRules[0].id']],
    ['a non-string id', (rule) => (rule.id = 42), ['projectRules[0].id']],
    ['a missing matchType', (rule) => delete rule.matchType, ['projectRules[0].matchType']],
    ['an unknown matchType', (rule) => (rule.matchType = 'contains'), ['projectRules[0].matchType']],
    ['settings that is a string', (rule) => (rule.settings = 'x'), ['projectRules[0].settings']],
    ['null settings', (rule) => (rule.settings = null), ['projectRules[0].settings']],
    ['settings that is an array', (rule) => (rule.settings = ['x']), ['projectRules[0].settings']],
    ['a missing section', (rule) => delete rule.settings.platformBarText, ['projectRules[0].settings.platformBarText']],
    ['a section that is not an object', (rule) => (rule.settings.topBar = 42), ['projectRules[0].settings.topBar']],
    [
      'a wrong-typed boolean',
      (rule) => (rule.settings.topBar.enabled = 'yes'),
      ['projectRules[0].settings.topBar.enabled'],
    ],
    ['a missing boolean', (rule) => delete rule.settings.palette.enabled, ['projectRules[0].settings.palette.enabled']],
    ['a fractional height', (rule) => (rule.settings.topBar.height = 2.5), ['projectRules[0].settings.topBar.height']],
    [
      'a height below the minimum',
      (rule) => (rule.settings.topBar.height = 0),
      ['projectRules[0].settings.topBar.height'],
    ],
    [
      'a height above the maximum',
      (rule) => (rule.settings.topBar.height = 41),
      ['projectRules[0].settings.topBar.height'],
    ],
    ['a string height', (rule) => (rule.settings.topBar.height = 'abc'), ['projectRules[0].settings.topBar.height']],
    ['a missing height', (rule) => delete rule.settings.topBar.height, ['projectRules[0].settings.topBar.height']],
    [
      'a wrong-typed paletteId',
      (rule) => (rule.settings.topBar.color.paletteId = 42),
      ['projectRules[0].settings.topBar.color.paletteId'],
    ],
    [
      'a color selection that is not an object',
      (rule) => (rule.settings.platformBar.color = 'x'),
      ['projectRules[0].settings.platformBar.color'],
    ],
    [
      'a numeric fill',
      (rule) => (rule.settings.topBar.color.custom = 42),
      ['projectRules[0].settings.topBar.color.custom'],
    ],
    // 0.4.x's bare strings reach the reader only under a stamp the 0.5.0 step skipped (unreleased
    // development builds), and so does the untagged { stops } object.
    [
      'an untagged color string',
      (rule) => (rule.settings.topBar.color.custom = '#123456'),
      ['projectRules[0].settings.topBar.color.custom'],
    ],
    [
      'an untagged { stops } object',
      (rule) => (rule.settings.platformBar.color.custom = { stops: [{ color: '#123456', position: 0 }] }),
      ['projectRules[0].settings.platformBar.color.custom.type'],
    ],
    [
      'a solid with a bad color',
      (rule) => (rule.settings.topBar.color.custom = storedSolid('banana')),
      ['projectRules[0].settings.topBar.color.custom.color'],
    ],
    [
      'a single-stop gradient',
      (rule) => (rule.settings.palette.entries[0].color = storedStops(['#123456', 0])),
      ['projectRules[0].settings.palette.entries[0].color.stops'],
    ],
    [
      'a gradient with a bad stop color',
      (rule) => (rule.settings.palette.entries[0].color = storedStops(['#123456', 0], ['banana', 100])),
      ['projectRules[0].settings.palette.entries[0].color.stops[1].color'],
    ],
    [
      'a gradient in the text color',
      (rule) => (rule.settings.platformBarText.color.custom = storedStops(['#000000', 0], ['#111111', 100])),
      ['projectRules[0].settings.platformBarText.color.custom'],
    ],
    [
      'entries that is not an array',
      (rule) => (rule.settings.palette.entries = 'x'),
      ['projectRules[0].settings.palette.entries'],
    ],
    [
      'an entry that is not an object',
      (rule) => (rule.settings.palette.entries = [null]),
      ['projectRules[0].settings.palette.entries[0]'],
    ],
    [
      'an entry without a name',
      (rule) => delete rule.settings.palette.entries[0].name,
      ['projectRules[0].settings.palette.entries[0].name'],
    ],
    [
      'a duplicate palette entry id',
      (rule) => rule.settings.palette.entries.push({ ...rule.settings.palette.entries[0] }),
      ['projectRules[0].settings.palette.entries[1].id'],
    ],
  ])('refuses %s at its path', (_label, mutate, expected) => {
    expect(refusedPaths(storedWithRule(mutate))).toEqual(expected);
  });

  it.each([
    ['a missing theme', { schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [] }, ['theme']],
    ['an unknown theme', { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'sepia', projectRules: [] }, ['theme']],
    [
      'a differently cased theme',
      { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'Dark', projectRules: [] },
      ['theme'],
    ],
    ['a null theme', { schemaVersion: CURRENT_SCHEMA_VERSION, theme: null, projectRules: [] }, ['theme']],
    ['a missing projectRules', { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto' }, ['projectRules']],
    // The pre-array schema's `projects` map is not projectRules.
    [
      'a legacy projects map in place of projectRules',
      { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projects: { 'my-project': {} } },
      ['projectRules'],
    ],
    [
      'a non-array projectRules',
      { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: {} },
      ['projectRules'],
    ],
    [
      'rules that are not objects',
      { schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: [null, 'x', 42] },
      ['projectRules[0]', 'projectRules[1]', 'projectRules[2]'],
    ],
  ])('refuses %s at its path', (_label, stored, expected) => {
    expect(refusedPaths(stored)).toEqual(expected);
  });

  it('reports every invalid field of every rule in one refusal', () => {
    const stored = validStored();
    stored.projectRules.push(structuredClone(stored.projectRules[0]));
    stored.projectRules[0].matchType = 'glob';
    stored.projectRules[1].settings.topBar.height = 99;

    expect(refusedPaths(stored)).toEqual(['projectRules[0].matchType', 'projectRules[1].settings.topBar.height']);
  });

  // Released values the side panel itself could save stay readable: a rule's text and references
  // are the user's, and the domain accepts every one of them.
  it.each<[string, (rule: RawRule) => void]>([
    ['an empty pattern', (rule) => (rule.pattern = '')],
    [
      'a pattern that is not a valid regex',
      (rule) => {
        rule.matchType = 'regex';
        rule.pattern = '(';
      },
    ],
    ['an empty rule id', (rule) => (rule.id = '')],
    ['an empty entry name', (rule) => (rule.settings.palette.entries[0].name = '')],
    ['no palette entries', (rule) => (rule.settings.palette.entries = [])],
    ['a reference to no entry', (rule) => (rule.settings.topBar.color.paletteId = 'nowhere')],
    [
      'a text reference to a gradient entry',
      (rule) => {
        rule.settings.palette.entries[0].color = storedStops(['#000000', 0], ['#ffffff', 100]);
        rule.settings.platformBarText.color.paletteId = rule.settings.palette.entries[0].id;
      },
    ],
    ['an unknown key', (rule) => (rule.settings.topBar.legacyColor = '#123456')],
  ])('reads %s', (_label, mutate) => {
    const stored = storedWithRule(mutate);

    expect(toStored(read(stored), CURRENT_SCHEMA_VERSION)).toEqual({
      ...stored,
      projectRules: stored.projectRules.map((rule) => {
        const { legacyColor: _dropped, ...topBar } = rule.settings.topBar;
        return { ...rule, settings: { ...rule.settings, topBar } };
      }),
    });
  });

  it('reads two rules sharing an id, in the stored order (order encodes priority)', () => {
    const stored = validStored();
    stored.projectRules.push({ ...structuredClone(stored.projectRules[0]), pattern: 'second' });

    expect(read(stored).projectRules.map((rule) => [rule.id.toString(), rule.pattern])).toEqual([
      ['rule-1', 'my-app'],
      ['rule-1', 'second'],
    ]);
  });

  it('ignores unknown root keys such as the removed defaultProject', () => {
    const stored = { ...validStored(), defaultProject: { topBar: {} }, paletteEnabled: false };

    expect(read(stored)).toEqual(read(validStored()));
    expect(read(stored)).not.toHaveProperty('defaultProject');
  });
});

describe('toDomain: data stamped by past releases', () => {
  // The rule as 0.1.x-0.4.x stored it: '#rrggbb' strings in every fill slot.
  const legacyRule = (topBarHeight: unknown = 4) => ({
    id: '1',
    matchType: 'exact',
    pattern: 'a',
    settings: {
      palette: { enabled: true, entries: [{ id: 'e1', name: 'Teal', color: '#009688' }] },
      topBar: { enabled: true, color: { paletteId: null, custom: '#e91e63' }, height: topBarHeight, stripes: false },
      platformBar: { enabled: true, color: { paletteId: 'e1', custom: '#3f51b5' }, stripes: false },
      platformBarText: { enabled: true, color: { paletteId: null, custom: '#123456' }, auto: false },
    },
  });

  // The 0.5.0 migration step wraps v0.4.1's '#rrggbb' strings, so they read as the solid colors they
  // were, while the same strings under a 0.5.0 stamp are refused (see above).
  it("reads v0.4.1's bare color strings as solid fills", () => {
    const loaded = read({ schemaVersion: '0.4.1', theme: 'dark', projectRules: [legacyRule()] });

    const entryId = PaletteEntryId.recreate('e1');
    expect(loaded.theme).toBe('dark');
    expect(loaded.projectRules[0]!.settings).toEqual(
      projectSettings({
        palette: new Palette(true, [PaletteEntry.recreate(entryId, 'Teal', color('#009688'))]),
        topBar: DEFAULTS.topBar.changeColor(new ColorSelection(undefined, color('#e91e63'))),
        platformBar: DEFAULTS.platformBar.changeColor(new ColorSelection(entryId, color('#3f51b5'))),
        platformBarText: DEFAULTS.platformBarText.changeColor(new ColorSelection(undefined, color('#123456'))),
      }),
    );
  });

  it('refuses a v0.4.1 fill that is not a string at its path, as the 0.5.0 step reports it', () => {
    const rule = legacyRule();
    rule.settings.topBar.color.custom = 42 as unknown as string;

    expect(failureOf({ schemaVersion: '0.4.1', theme: 'dark', projectRules: [rule] })).toEqual({
      reason: 'invalid-fields',
      issues: [{ path: 'projectRules[0].settings.topBar.color.custom', message: 'expected a color like #rrggbb' }],
    });
  });

  // 0.1.x saved any finite height and painted it rounded, with its default 4 outside 1..40; the
  // 0.2.0 step reads it the same way. From 0.2.0 on, only whole heights from 1 to 40 were saved.
  it.each([
    [2.5, 3],
    [40.4, 40],
    [0, DEFAULT_TOP_BAR_HEIGHT],
    [-3, DEFAULT_TOP_BAR_HEIGHT],
  ])('reads a v0.1.3 height of %s as %s', (stored, expected) => {
    const loaded = read({ schemaVersion: '0.1.3', projectRules: [legacyRule(stored)] });

    expect(loaded.projectRules[0]!.settings.topBar.height).toEqual(height(expected));
  });

  it('refuses a fractional height under a 0.2.0 stamp, which no 0.2.x build saved', () => {
    expect(refusedPaths({ schemaVersion: '0.2.0', projectRules: [legacyRule(2.5)] })).toEqual([
      'projectRules[0].settings.topBar.height',
    ]);
  });

  // No step reshapes the pre-release flat rule settings, so the 0.2.0 step finds no topBar.
  it('refuses the pre-release flat rule settings under a 0.1.0 stamp, as the 0.2.0 step reports it', () => {
    const stored = {
      schemaVersion: '0.1.0',
      projectRules: [
        { id: 'r1', matchType: 'exact', pattern: 'my-app', settings: { topBarColor: '#111111', topBarHeight: 22 } },
      ],
    };

    expect(failureOf(stored)).toEqual({
      reason: 'invalid-fields',
      issues: [{ path: 'projectRules[0].settings.topBar', message: 'expected an object' }],
    });
  });

  // Data written before 0.3.0 has no theme; the 0.3.0 step adds 'auto' (a stray pre-0.3.0 theme
  // key is overwritten by the step, as the shape never had one).
  it.each(['0.1.0', '0.2.1'])('reads %s data through the 0.3.0 step as theme auto', (schemaVersion) => {
    expect(read({ schemaVersion, theme: 'dark', projectRules: [] }).theme).toBe('auto');
  });
});

describe('gradient fills', () => {
  it('round-trips gradients in a palette entry and both bars', () => {
    const sunsetId = PaletteEntryId.recreate('sunset');
    const sunset = at(['#ff6d00', 0], ['#e91e63', 30], ['#3f51b5', 100]);
    const settings = projectSettings({
      palette: DEFAULTS.palette.addEntry(PaletteEntry.recreate(sunsetId, 'Sunset', sunset)),
      topBar: DEFAULTS.topBar.changeColor(new ColorSelection(undefined, gradient('#ff6d00', '#1a73e8'))),
      platformBar: DEFAULTS.platformBar.changeColor(new ColorSelection(sunsetId, gradient('#000000', '#ffffff'))),
    });
    const tint = new TintSettings([ProjectRule.recreate(ProjectRuleId.recreate('1'), 'exact', 'a', settings)], 'auto');

    const stored = toStored(tint, CURRENT_SCHEMA_VERSION);
    const storedSettings = (stored.projectRules as { settings: Record<string, Record<string, unknown>> }[])[0]!
      .settings;

    expect(storedSettings.palette!.entries).toEqual([
      { id: 'default', name: 'Primary', color: storedSolid(DEFAULT_COLOR) },
      { id: 'sunset', name: 'Sunset', color: storedStops(['#ff6d00', 0], ['#e91e63', 30], ['#3f51b5', 100]) },
    ]);
    expect(storedSettings.topBar!.color).toEqual({
      paletteId: null,
      custom: storedStops(['#ff6d00', 0], ['#1a73e8', 100]),
    });
    expect(storedSettings.platformBar!.color).toEqual({
      paletteId: 'sunset',
      custom: storedStops(['#000000', 0], ['#ffffff', 100]),
    });
    expect(storedSettings.platformBarText!.color).toEqual({ paletteId: null, custom: DEFAULT_TEXT_COLOR });
    expect(toStored(read(stored), CURRENT_SCHEMA_VERSION)).toEqual(stored);
  });

  it('normalizes uppercase stops to lowercase', () => {
    const stored = storedWithRule((rule) => {
      rule.settings.topBar.color.custom = storedStops(['#ABCDEF', 0], ['#123456', 100]);
    });

    expect(read(stored).projectRules[0]!.settings.topBar.color.custom).toEqual(gradient('#abcdef', '#123456'));
  });

  // Each kind of fill in every slot that takes one: a kind toStored writes but the reader refuses
  // would fail here.
  it.each([
    ['solid', color('#009688'), color('#e91e63'), color('#3f51b5')],
    [
      'gradient',
      gradient('#009688', '#123456'),
      at(['#e91e63', 0], ['#00ff00', 40], ['#3f51b5', 100]),
      gradient('#000000', '#ffffff'),
    ],
  ])('reads back a %s fill in every fill slot as itself', (_kind, entryFill, topBarFill, platformBarFill) => {
    const entryId = PaletteEntryId.recreate('e1');
    const settings = projectSettings({
      palette: DEFAULTS.palette.addEntry(PaletteEntry.recreate(entryId, 'Fill', entryFill)),
      topBar: DEFAULTS.topBar.changeColor(new ColorSelection(undefined, topBarFill)),
      platformBar: DEFAULTS.platformBar.changeColor(new ColorSelection(entryId, platformBarFill)),
    });
    const tint = new TintSettings([ProjectRule.recreate(ProjectRuleId.recreate('1'), 'exact', 'a', settings)], 'dark');

    expect(read(toStored(tint, CURRENT_SCHEMA_VERSION))).toEqual(tint);
  });

  it('keeps a text reference to a gradient entry, resolving the text to its own custom color', () => {
    const stored = storedWithRule((rule) => {
      rule.settings.palette.entries = [
        { id: 'sunset', name: 'Sunset', color: storedStops(['#000000', 0], ['#ffffff', 100]) },
      ];
      rule.settings.platformBarText.color = { paletteId: 'sunset', custom: '#123456' };
    });

    const settings = read(stored).projectRules[0]!.settings;

    expect(settings.platformBarText.color.paletteId?.toString()).toBe('sunset');
    expect(settings.palette.resolveSolid(settings.platformBarText.color).toHex()).toBe('#123456');
    expect(hexOf(settings.palette.entries[0]!.color)).toBeUndefined();
  });
});

// ProjectSettings.DEFAULT is built from explicit literals in the domain; a new rule and so its
// stored shape start from it.
describe('ProjectSettings.DEFAULT', () => {
  it('deep-equals the documented default shape (guards against default drift)', () => {
    expect(DEFAULTS).toEqual({
      palette: {
        enabled: true,
        entries: [{ id: PaletteEntryId.recreate('default'), name: 'Primary', color: color(DEFAULT_COLOR) }],
      },
      topBar: {
        enabled: true,
        color: { paletteId: PaletteEntryId.recreate('default'), custom: color(DEFAULT_COLOR) },
        height: height(DEFAULT_TOP_BAR_HEIGHT),
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
});

describe('toDomain: theme', () => {
  it.each(THEMES)('keeps a stored theme of %s', (theme) => {
    expect(read({ schemaVersion: CURRENT_SCHEMA_VERSION, theme, projectRules: [] }).theme).toBe(theme);
  });
});

describe('toStored', () => {
  it('writes the theme right after schemaVersion, and toDomain reads it back', () => {
    const stored = toStored(new TintSettings([], 'dark'), CURRENT_SCHEMA_VERSION);

    expect(Object.keys(stored)).toEqual(['schemaVersion', 'theme', 'projectRules']);
    expect(stored.theme).toBe('dark');
    expect(read(stored).theme).toBe('dark');
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
    expect(effectiveSchemaVersion('0.5.1')).toBe('0.5.1');
    expect(effectiveSchemaVersion('9.9.9')).toBe('9.9.9');
  });
});
