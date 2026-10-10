import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Color } from '../../../domain/color';
import { ColorSelection } from '../../../domain/color-selection';
import { ProjectRule, ProjectRuleId } from '../../../domain/project-rule';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsImportError, type SettingsImportIssue } from '../../../port/settings-store';
import { CURRENT_SCHEMA_VERSION, type SchemaMigration } from '../migrations';
import { parseSettingsFile } from '../settings-file';
import { toStored } from '../settings-repository';

// Runs `fn`, returning whatever it throws. Fails the test (via a plain thrown Error) if `fn`
// does not throw, so a broken assertion below never gets skipped silently.
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected function to throw, but it did not');
}

function failureOf(error: unknown) {
  expect(error).toBeInstanceOf(SettingsImportError);
  return (error as SettingsImportError).failure;
}

// Every case here starts from a file the exporter itself could have written, so a test only ever
// differs from a valid file in the one field it is about.
function validFile(): Record<string, unknown> {
  const settings = new TintSettings(
    [ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', ProjectSettings.DEFAULT)],
    'auto',
  );
  return toStored(settings, CURRENT_SCHEMA_VERSION);
}

// A rule as raw JSON, deliberately untyped: every fixture below exists to feed the parser
// something TypeScript would never let through, which is exactly what the parser must catch.
// biome-ignore lint/suspicious/noExplicitAny: the fixtures must be able to violate the shape
type RawRule = any;

// Applies `mutate` to the first rule's raw JSON and serializes the result.
function fileWithRule(mutate: (rule: RawRule) => void): string {
  const file = validFile();
  const rule = (file.projectRules as RawRule[])[0];
  mutate(rule);
  return JSON.stringify(file);
}

// The stamp this build would put on its own export; every case below imports "into" this build.
const parse = (text: string) => parseSettingsFile(text, CURRENT_SCHEMA_VERSION);

function issuesOf(error: unknown): readonly SettingsImportIssue[] {
  const failure = failureOf(error);
  expect(failure.reason).toBe('invalid-fields');
  return failure.reason === 'invalid-fields' ? failure.issues : [];
}

function paths(error: unknown): string[] {
  return issuesOf(error).map((issue) => issue.path);
}

describe('parseSettingsFile: the file as a whole', () => {
  it('throws invalid-json, with the SyntaxError as cause, for text that is not JSON at all', () => {
    const error = thrownBy(() => parse('not json{'));

    expect(failureOf(error)).toEqual({ reason: 'invalid-json' });
    expect((error as SettingsImportError).cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ['a JSON array', '[]'],
    ['a JSON number', '42'],
    ['an object without schemaVersion', JSON.stringify({ projectRules: [] })],
    ['an object with a non-string schemaVersion', JSON.stringify({ schemaVersion: 123, projectRules: [] })],
  ])('throws not-settings for %s', (_label, text) => {
    expect(failureOf(thrownBy(() => parse(text)))).toEqual({ reason: 'not-settings' });
  });

  it('throws unsupported-version, with the version, for a schemaVersion below SCHEMA_MIN_VERSION', () => {
    const text = JSON.stringify({ schemaVersion: '0.0.9', projectRules: [{ id: '1', pattern: 'x', settings: {} }] });

    expect(failureOf(thrownBy(() => parse(text)))).toEqual({
      reason: 'unsupported-version',
      version: '0.0.9',
    });
  });

  it('throws no-rules for a valid file with an empty projectRules array', () => {
    const text = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: [] });

    expect(failureOf(thrownBy(() => parse(text)))).toEqual({ reason: 'no-rules' });
  });

  it('ignores unknown keys at every level within the supported schema-version range', () => {
    const file = validFile();
    file.somethingNew = true;
    const text = fileWithRule((rule) => {
      rule.somethingNew = true;
      rule.settings.somethingNew = true;
      rule.settings.topBar.somethingNew = true;
    });

    expect(parse(text).projectRules).toHaveLength(1);
    expect(parse(JSON.stringify(file)).projectRules).toHaveLength(1);
  });

  it('round-trips a valid file: toStored -> JSON.stringify -> parseSettingsFile equals the original settings', () => {
    const original = new TintSettings(
      [
        ProjectRule.recreate(
          ProjectRuleId.recreate('rule-1'),
          'exact',
          'my-app',
          ProjectSettings.DEFAULT.changeTopBar(
            ProjectSettings.DEFAULT.topBar.changeColor(new ColorSelection(undefined, Color.fromHex('#00ff00')!)),
          ),
        ),
      ],
      'auto',
    );
    const text = JSON.stringify(toStored(original, CURRENT_SCHEMA_VERSION));

    const parsed = parse(text);

    expect(parsed.equals(original)).toBe(true);
    expect(parsed.projectRules[0]!.settings).toEqual(original.projectRules[0]!.settings);
  });

  it.each(['auto', 'light', 'dark'])("carries the file's theme (%s) on the returned settings", (theme) => {
    expect(parse(JSON.stringify({ ...validFile(), theme })).theme).toBe(theme);
  });
});

// Stage 1: required keys and JSON types. These never reach the domain — the Zod schema refuses
// the file first — so the message is Zod's own.
describe('parseSettingsFile: structural issues (missing keys and wrong JSON types)', () => {
  it.each([
    ['theme is missing', (file: Record<string, unknown>) => delete file.theme, 'theme'],
    ['theme is not a string', (file: Record<string, unknown>) => (file.theme = 1), 'theme'],
    ['projectRules is missing', (file: Record<string, unknown>) => delete file.projectRules, 'projectRules'],
    ['projectRules is not an array', (file: Record<string, unknown>) => (file.projectRules = {}), 'projectRules'],
  ])('reports %s at the root', (_label, mutate, path) => {
    const file = validFile();
    mutate(file);

    const issues = issuesOf(thrownBy(() => parse(JSON.stringify(file))));

    expect(issues.map((issue) => issue.path)).toEqual([path]);
    expect(issues).toEqual(oracleIssues(file));
  });

  it.each([
    ['a rule without settings', (rule: RawRule) => delete rule.settings, 'projectRules[0].settings'],
    [
      'a numeric height',
      (rule: RawRule) => (rule.settings.topBar.height = '4'),
      'projectRules[0].settings.topBar.height',
    ],
    [
      'a boolean stripes',
      (rule: RawRule) => (rule.settings.topBar.stripes = 'yes'),
      'projectRules[0].settings.topBar.stripes',
    ],
    ['a string pattern', (rule: RawRule) => (rule.pattern = 5), 'projectRules[0].pattern'],
    [
      'a palette entry without a color',
      (rule: RawRule) => delete rule.settings.palette.entries[0].color,
      'projectRules[0].settings.palette.entries[0].color',
    ],
    [
      'a string-or-null paletteId',
      (rule: RawRule) => (rule.settings.topBar.color.paletteId = 7),
      'projectRules[0].settings.topBar.color.paletteId',
    ],
  ])('refuses the file when a field is not %s', (_label, mutate: (rule: RawRule) => void, path) => {
    const error = thrownBy(() => parse(fileWithRule(mutate)));

    expect(failureOf(error).reason).toBe('invalid-fields');
    expect(paths(error)).toEqual([path]);
  });

  it('names the offending rule by index', () => {
    const file = validFile();
    const rules = file.projectRules as RawRule[];
    rules.push(JSON.parse(JSON.stringify(rules[0])));
    rules[1].id = 'rule-2';
    rules[1].settings.topBar.height = '4';

    expect(paths(thrownBy(() => parse(JSON.stringify(file))))).toEqual(['projectRules[1].settings.topBar.height']);
  });
});

// Stage 2: the values themselves, judged by the domain's own factories (isTheme, Color.fromHex,
// TopBarHeight.fromPixels, isMatchType) rather than by anything restated in the adapter.
describe('parseSettingsFile: value issues (structurally fine, but the domain refuses the value)', () => {
  it.each(['sepia', 'Dark', ''])('refuses an unknown theme (%j)', (theme) => {
    expect(issuesOf(thrownBy(() => parse(JSON.stringify({ ...validFile(), theme }))))).toEqual([
      { path: 'theme', message: 'expected one of auto, light, dark' },
    ]);
  });

  it.each([
    [
      'an unknown match type',
      (rule: RawRule) => (rule.matchType = 'glob'),
      'projectRules[0].matchType',
      'expected one of prefix, suffix, exact, regex',
    ],
    [
      'a color name instead of a hex value',
      (rule: RawRule) => (rule.settings.topBar.color.custom = 'red'),
      'projectRules[0].settings.topBar.color.custom',
      'expected a color like #rrggbb',
    ],
    [
      'a truncated hex color on a palette entry',
      (rule: RawRule) => (rule.settings.palette.entries[0].color = '#12345'),
      'projectRules[0].settings.palette.entries[0].color',
      'expected a color like #rrggbb',
    ],
    [
      'a height below the minimum',
      (rule: RawRule) => (rule.settings.topBar.height = 0),
      'projectRules[0].settings.topBar.height',
      'expected an integer from 1 to 40',
    ],
    [
      'a height above the maximum',
      (rule: RawRule) => (rule.settings.topBar.height = 41),
      'projectRules[0].settings.topBar.height',
      'expected an integer from 1 to 40',
    ],
    [
      'a fractional height',
      (rule: RawRule) => (rule.settings.topBar.height = 2.5),
      'projectRules[0].settings.topBar.height',
      'expected an integer from 1 to 40',
    ],
  ])('refuses %s', (_label, mutate: (rule: RawRule) => void, path, message) => {
    expect(issuesOf(thrownBy(() => parse(fileWithRule(mutate))))).toEqual([{ path, message }]);
  });

  it('reports every bad value in the file in one pass, not just the first', () => {
    const text = fileWithRule((rule) => {
      rule.matchType = 'glob';
      rule.settings.topBar.height = 99;
      rule.settings.topBar.color.custom = 'red';
      rule.settings.palette.entries[0].color = 'nope';
      rule.settings.platformBarText.color.custom = '#12345';
    });

    expect(paths(thrownBy(() => parse(text))).sort()).toEqual([
      'projectRules[0].matchType',
      'projectRules[0].settings.palette.entries[0].color',
      'projectRules[0].settings.platformBarText.color.custom',
      'projectRules[0].settings.topBar.color.custom',
      'projectRules[0].settings.topBar.height',
    ]);
  });

  // The domain treats a reference to a missing entry as legal and falls back to the custom color
  // (Palette.resolve), so the import must not invent a stricter rule than the model has.
  it('accepts empty ids: ids are opaque strings to the domain, so there is no value rule to apply', () => {
    const settings = parse(
      fileWithRule((rule) => {
        rule.id = '';
        rule.settings.palette.entries[0].id = '';
      }),
    );
    expect(settings.projectRules[0]!.id.toString()).toBe('');
    expect(settings.projectRules[0]!.settings.palette.entries[0]!.id.toString()).toBe('');
  });

  it('refuses repeated palette entry ids and reports every later id path', () => {
    const error = thrownBy(() =>
      parse(
        fileWithRule((rule) => {
          rule.settings.palette.entries.push(
            { ...rule.settings.palette.entries[0] },
            { ...rule.settings.palette.entries[0] },
          );
        }),
      ),
    );

    expect(paths(error)).toEqual([
      'projectRules[0].settings.palette.entries[1].id',
      'projectRules[0].settings.palette.entries[2].id',
    ]);
    expect(issuesOf(error).map((issue) => issue.message)).toEqual([
      'duplicate palette entry id',
      'duplicate palette entry id',
    ]);
  });

  it('allows the same default palette entry id in separate rule palettes', () => {
    const file = validFile();
    const rules = file.projectRules as RawRule[];
    const second = JSON.parse(JSON.stringify(rules[0])) as RawRule;
    second.id = 'rule-2';
    rules.push(second);

    expect(parse(JSON.stringify(file)).projectRules).toHaveLength(2);
  });

  it('accepts a paletteId that references no entry of the rule (a dangling reference is legal)', () => {
    const text = fileWithRule((rule) => {
      rule.settings.topBar.color.paletteId = 'gone';
    });

    const parsed = parse(text);

    const topBar = parsed.projectRules[0]!.settings.topBar;
    expect(topBar.color.paletteId?.toString()).toBe('gone');
    expect(parsed.projectRules[0]!.settings.palette.resolve(topBar.color).equals(topBar.color.custom)).toBe(true);
  });

  it('accepts a null paletteId as "no palette reference"', () => {
    const text = fileWithRule((rule) => {
      rule.settings.topBar.color.paletteId = null;
    });

    expect(parse(text).projectRules[0]!.settings.topBar.color.paletteId).toBeUndefined();
  });

  it.each([1, 40])('accepts a height at the boundary (%i)', (pixels) => {
    const text = fileWithRule((rule) => {
      rule.settings.topBar.height = pixels;
    });

    expect(parse(text).projectRules[0]!.settings.topBar.height.toPixels()).toBe(pixels);
  });
});

describe('parseSettingsFile: versions and migrations', () => {
  const stamped = (schemaVersion: string): string => JSON.stringify({ ...validFile(), schemaVersion });

  it.each([
    ['an empty first component', '.1.0'],
    ['an empty middle component', '0..0'],
    ['an empty last component', '0.1.'],
    ['a trailing newline', '0.1.0\n'],
    ['a non-ASCII digit', '0.1.٠'],
  ])('refuses a version with %s as not-settings', (_label, version) => {
    expect(failureOf(thrownBy(() => parseSettingsFile(stamped(version), CURRENT_SCHEMA_VERSION)))).toEqual({
      reason: 'not-settings',
    });
  });

  it.each(['0.1', '0.1.0.0'])('keeps accepting numeric version stamps with this component count (%s)', (version) => {
    expect(parseSettingsFile(stamped(version), CURRENT_SCHEMA_VERSION).projectRules).toHaveLength(1);
  });

  it('refuses a file stamped newer than what this build can have written (newer-version)', () => {
    expect(failureOf(thrownBy(() => parseSettingsFile(stamped('0.4.0'), '0.3.5')))).toEqual({
      reason: 'newer-version',
      version: '0.4.0',
    });
  });

  // The real registry's 0.3.0 step adds theme 'auto' to files written before the theme existed.
  it('imports a 0.2.1 file without theme, which the 0.3.0 migration step completes with auto', () => {
    const { theme: _theme, ...file } = validFile();

    expect(parseSettingsFile(JSON.stringify({ ...file, schemaVersion: '0.2.1' }), CURRENT_SCHEMA_VERSION).theme).toBe(
      'auto',
    );
  });

  it('accepts a stamp equal to the current version, and one between the schema version and it', () => {
    expect(parseSettingsFile(stamped('0.3.5'), '0.3.5').projectRules).toHaveLength(1);
    expect(parseSettingsFile(stamped('0.3.2'), '0.3.5').projectRules).toHaveLength(1);
  });

  // A fake shape change: 0.2.0 renames topBar.heightPx to topBar.height. Files written before it
  // carry heightPx, so the step must run for them and must not run for files already at 0.2.0.
  const renameHeight: SchemaMigration = {
    to: '0.2.0',
    migrate: (data) => ({
      ...data,
      projectRules: (data.projectRules as RawRule[]).map((rule) => {
        const { heightPx, ...topBar } = rule.settings.topBar;
        return { ...rule, settings: { ...rule.settings, topBar: { ...topBar, height: heightPx } } };
      }),
    }),
  };

  function oldShapeFile(schemaVersion: string): string {
    const file = validFile();
    const topBar = (file.projectRules as RawRule[])[0].settings.topBar;
    topBar.heightPx = 12;
    delete topBar.height;
    return JSON.stringify({ ...file, schemaVersion });
  }

  it('folds an older file forward through the migration steps before validating it', () => {
    const settings = parseSettingsFile(oldShapeFile('0.1.0'), '0.2.0', [renameHeight]);
    expect(settings.projectRules[0]!.settings.topBar.height.toPixels()).toBe(12);
  });

  it("does not run a step at or below the file's own stamp (the file is already in that shape)", () => {
    const breakHeight: SchemaMigration = {
      to: '0.2.0',
      migrate: (data) => ({
        ...data,
        projectRules: (data.projectRules as RawRule[]).map((rule) => {
          const { height: _dropped, ...topBar } = rule.settings.topBar;
          return { ...rule, settings: { ...rule.settings, topBar } };
        }),
      }),
    };
    expect(parseSettingsFile(stamped('0.2.0'), '0.2.0', [breakHeight]).projectRules).toHaveLength(1);
  });

  it('refuses, as invalid-fields, an older file whose migration leaves the shape incomplete', () => {
    const incomplete: SchemaMigration = { to: '0.2.0', migrate: (data) => data };
    expect(paths(thrownBy(() => parseSettingsFile(oldShapeFile('0.1.0'), '0.2.0', [incomplete])))).toEqual([
      'projectRules[0].settings.topBar.height',
    ]);
  });
});

// The order oracle for the structure stage: the whole-file schema the import used to run in one
// call, restated here on purpose rather than imported, so the element-by-element walk is checked
// against Zod's own issue order and wording, not against itself.
const oracleSelection = z.object({ paletteId: z.string().nullable(), custom: z.string() });
const oracleSchema = z.object({
  theme: z.string(),
  projectRules: z.array(
    z.object({
      id: z.string(),
      matchType: z.string(),
      pattern: z.string(),
      settings: z.object({
        palette: z.object({
          enabled: z.boolean(),
          entries: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
        }),
        topBar: z.object({ enabled: z.boolean(), color: oracleSelection, height: z.number(), stripes: z.boolean() }),
        platformBar: z.object({ enabled: z.boolean(), color: oracleSelection, stripes: z.boolean() }),
        platformBarText: z.object({ enabled: z.boolean(), color: oracleSelection, auto: z.boolean() }),
      }),
    }),
  ),
});

function oracleIssues(data: unknown): SettingsImportIssue[] {
  const result = oracleSchema.safeParse(data);
  const pathText = (path: readonly PropertyKey[]) =>
    path.map((key, i) => (typeof key === 'number' ? `[${key}]` : i === 0 ? String(key) : `.${String(key)}`)).join('');
  return (result.error?.issues ?? []).map((issue) => ({ path: pathText(issue.path), message: issue.message }));
}

// Hands `data` to validation exactly as a migration step would return it. JSON cannot carry what
// some cases need (undefined, a non-object root, getters).
function parseMigrated(data: unknown) {
  const step: SchemaMigration = { to: '0.1.1', migrate: () => data as Record<string, unknown> };
  return parseSettingsFile(JSON.stringify({ schemaVersion: '0.1.0' }), '0.1.1', [step]);
}

// Reverses the key order of every object, so a test can show the issue order does not follow it.
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reverseKeys(child)]),
  );
}

describe('parseSettingsFile: a missing or non-object parent is one issue, with no issues for its children', () => {
  const fileWith = (mutate: (rule: RawRule) => void) => {
    const file = validFile();
    mutate((file.projectRules as RawRule[])[0]);
    return file;
  };

  it.each([
    ['projectRules is missing', () => ({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto' }), 'projectRules'],
    [
      'projectRules is null',
      () => ({ schemaVersion: CURRENT_SCHEMA_VERSION, theme: 'auto', projectRules: null }),
      'projectRules',
    ],
    ['settings is a number', () => fileWith((rule) => (rule.settings = 1)), 'projectRules[0].settings'],
    ['settings is an array', () => fileWith((rule) => (rule.settings = [])), 'projectRules[0].settings'],
    ['palette is an array', () => fileWith((rule) => (rule.settings.palette = [])), 'projectRules[0].settings.palette'],
    [
      'palette.entries is missing',
      () => fileWith((rule) => delete rule.settings.palette.entries),
      'projectRules[0].settings.palette.entries',
    ],
    [
      'palette.entries is undefined',
      () => fileWith((rule) => (rule.settings.palette.entries = undefined)),
      'projectRules[0].settings.palette.entries',
    ],
    [
      'palette.entries is null',
      () => fileWith((rule) => (rule.settings.palette.entries = null)),
      'projectRules[0].settings.palette.entries',
    ],
    [
      'palette.entries is an object',
      () => fileWith((rule) => (rule.settings.palette.entries = { 0: { id: 'x' } })),
      'projectRules[0].settings.palette.entries',
    ],
  ])('%s', (_label, data, path) => {
    const fixture = data();

    const issues = issuesOf(thrownBy(() => parseMigrated(fixture)));

    expect(issues.map((issue) => issue.path)).toEqual([path]);
    expect(issues).toEqual(oracleIssues(fixture));
  });

  it('reports a rule that is not an object at the rule itself', () => {
    const fixture = { theme: 'auto', projectRules: ['not a rule'] };

    const issues = issuesOf(thrownBy(() => parseMigrated(fixture)));

    expect(issues.map((issue) => issue.path)).toEqual(['projectRules[0]']);
    expect(issues).toEqual(oracleIssues(fixture));
  });

  // Production steps always return an object, so only an injected step can hand validation a
  // non-object; its issue sits at the file itself, whose path is the empty string.
  it.each([
    ['a string', 'text'],
    ['an array', []],
    ['null', null],
  ])('reports a migrated root that is %s at path "" in Zod wording', (_label, root) => {
    const issues = issuesOf(thrownBy(() => parseMigrated(root)));

    expect(issues.map((issue) => issue.path)).toEqual(['']);
    expect(issues).toEqual(oracleIssues(root));
  });
});

describe('parseSettingsFile: issue order across rules, independent of key order', () => {
  it('lists a root theme issue before a root projectRules issue, whatever the key order', () => {
    const fixture = { projectRules: null, theme: 3 };

    const issues = issuesOf(thrownBy(() => parseMigrated(fixture)));

    expect(issues.map((issue) => issue.path)).toEqual(['theme', 'projectRules']);
    expect(issues).toEqual(oracleIssues(fixture));
  });

  it('judges the theme value before any rule value', () => {
    const file = validFile();
    (file.projectRules as RawRule[])[0].matchType = 'glob';
    file.theme = 'sepia';

    expect(paths(thrownBy(() => parseMigrated(reverseKeys(file))))).toEqual(['theme', 'projectRules[0].matchType']);
  });

  // Two rules with every object's keys reversed, unknown keys at several levels, and structural
  // issues placed before, inside and after palette.entries.
  function brokenStructure() {
    const file = validFile();
    const first = (file.projectRules as RawRule[])[0];
    const second = JSON.parse(JSON.stringify(first)) as RawRule;
    first.settings.topBar.height = '4';
    first.id = 1;
    first.settings.palette.entries[0].color = 5;
    first.settings.palette.enabled = 'x';
    first.settings.platformBarText.auto = 'no';
    first.somethingNew = true;
    first.settings.palette.somethingNew = 1;
    second.id = 'rule-2';
    delete second.pattern;
    second.settings.palette.entries = 'x';
    second.settings.topBar.color.paletteId = 3;
    second.settings.topBar.color.somethingNew = 1;
    (file.projectRules as RawRule[]).push(second);
    return reverseKeys(file);
  }

  it('lists structural issues in schema order per rule: fields before the entries, the entries, then the rest', () => {
    const fixture = brokenStructure();

    const issues = issuesOf(thrownBy(() => parseMigrated(fixture)));

    expect(issues.map((issue) => issue.path)).toEqual([
      'projectRules[0].id',
      'projectRules[0].settings.palette.enabled',
      'projectRules[0].settings.palette.entries[0].color',
      'projectRules[0].settings.topBar.height',
      'projectRules[0].settings.platformBarText.auto',
      'projectRules[1].pattern',
      'projectRules[1].settings.palette.entries',
      'projectRules[1].settings.topBar.color.paletteId',
    ]);
    expect(issues).toEqual(oracleIssues(fixture));
  });

  it('lists value issues in judgment order per rule, whatever the key order', () => {
    const file = validFile();
    const first = (file.projectRules as RawRule[])[0];
    const second = JSON.parse(JSON.stringify(first)) as RawRule;
    first.settings.topBar.height = 0;
    first.settings.topBar.color.custom = 'red';
    first.settings.palette.entries.push({ ...first.settings.palette.entries[0] });
    first.settings.palette.entries[0].color = 'nope';
    first.matchType = 'glob';
    first.somethingNew = true;
    second.id = 'rule-2';
    second.settings.platformBarText.color.custom = '#12345';
    second.settings.platformBar.color.custom = 'blue';
    second.settings.topBar.somethingNew = true;
    (file.projectRules as RawRule[]).push(second);

    expect(issuesOf(thrownBy(() => parseMigrated(reverseKeys(file))))).toEqual([
      { path: 'projectRules[0].matchType', message: 'expected one of prefix, suffix, exact, regex' },
      { path: 'projectRules[0].settings.palette.entries[0].color', message: 'expected a color like #rrggbb' },
      { path: 'projectRules[0].settings.palette.entries[1].id', message: 'duplicate palette entry id' },
      { path: 'projectRules[0].settings.topBar.color.custom', message: 'expected a color like #rrggbb' },
      { path: 'projectRules[0].settings.topBar.height', message: 'expected an integer from 1 to 40' },
      { path: 'projectRules[1].settings.platformBar.color.custom', message: 'expected a color like #rrggbb' },
      { path: 'projectRules[1].settings.platformBarText.color.custom', message: 'expected a color like #rrggbb' },
    ]);
  });

  // Unknown keys are dropped by Zod without being read: an unknown key whose getter throws must
  // not break the import. Known keys are read once, by Zod: the value stage builds from Zod's
  // parsed copy, so handing it the raw input instead would read them a second time.
  it('passes on only the parsed data, never reading unknown keys', () => {
    const file = validFile();
    const rule = (file.projectRules as RawRule[])[0];
    const explode = { enumerable: true, get: () => expect.unreachable('an unknown key was read') };
    Object.defineProperty(rule, 'somethingNew', explode);
    Object.defineProperty(rule.settings, 'somethingNew', explode);
    Object.defineProperty(rule.settings.palette, 'somethingNew', explode);
    Object.defineProperty(rule.settings.palette.entries[0], 'somethingNew', explode);
    const reads = { pattern: 0, color: 0 };
    const counted = (target: Record<string, unknown>, key: keyof typeof reads) => {
      const value = target[key];
      Object.defineProperty(target, key, {
        enumerable: true,
        get: () => {
          reads[key]++;
          return value;
        },
      });
    };
    counted(rule, 'pattern');
    counted(rule.settings.palette.entries[0], 'color');

    const settings = parseMigrated(file);

    expect(settings.projectRules).toHaveLength(1);
    expect(settings.projectRules[0]!.settings).toEqual(ProjectSettings.DEFAULT);
    expect(reads).toEqual({ pattern: 1, color: 1 });
  });
});

describe('parseSettingsFile: migration failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const identity: SchemaMigration = { to: '0.1.1', migrate: (data) => data };
  const throwingStep = (error: unknown): SchemaMigration => ({
    to: '0.1.2',
    migrate: () => {
      throw error;
    },
  });
  const stampedFile = (schemaVersion: string) => JSON.stringify({ ...validFile(), schemaVersion });

  it("reports a throwing second step as migration-failed against the file's own stamp, with the error as cause", () => {
    const stepError = new TypeError('step 0.1.2 broke');

    const error = thrownBy(() => parseSettingsFile(stampedFile('0.1.0'), '0.1.2', [identity, throwingStep(stepError)]));

    expect(failureOf(error)).toEqual({ reason: 'migration-failed', version: '0.1.0' });
    expect((error as SettingsImportError).cause).toBe(stepError);
    expect((error as SettingsImportError).message).toBe('Settings file version 0.1.0 could not be migrated');
  });

  it('keeps the whole original stamp, however long, as the failure version', () => {
    const stamp = `0.1.0${'.0'.repeat(130)}`;
    expect(stamp).toHaveLength(265);

    const error = thrownBy(() =>
      parseSettingsFile(stampedFile(stamp), '0.1.2', [identity, throwingStep(new Error('x'))]),
    );

    expect(failureOf(error)).toEqual({ reason: 'migration-failed', version: stamp });
  });

  // Only the migration call is guarded: an unexpected error raised after it is the same object,
  // not a SettingsImportError, so a broad catch around validation would be caught here.
  it('lets an error thrown while reading the migrated data propagate as the same object', () => {
    const readError = new RangeError('getter broke');
    const migrated = {};
    Object.defineProperty(migrated, 'projectRules', {
      enumerable: true,
      get: () => {
        throw readError;
      },
    });

    expect(thrownBy(() => parseMigrated(migrated))).toBe(readError);
  });

  it('lets an error thrown by a domain factory during the value stage propagate as the same object', () => {
    const factoryError = new RangeError('fromHex broke');
    vi.spyOn(Color, 'fromHex').mockImplementation(() => {
      throw factoryError;
    });

    expect(thrownBy(() => parseMigrated(validFile()))).toBe(factoryError);
  });

  // Every gate before the migration runs first (a throwing step never runs), and every check after
  // it keeps its own reason.
  it.each([
    ['invalid-json', () => 'not json{', { reason: 'invalid-json' }],
    ['not-settings', () => JSON.stringify({ projectRules: [] }), { reason: 'not-settings' }],
    ['unsupported-version', () => stampedFile('0.0.9'), { reason: 'unsupported-version', version: '0.0.9' }],
    ['newer-version', () => stampedFile('0.2.0'), { reason: 'newer-version', version: '0.2.0' }],
  ])('does not run the migration for %s', (_label, text, failure) => {
    expect(failureOf(thrownBy(() => parseSettingsFile(text(), '0.1.2', [throwingStep(new Error('ran'))])))).toEqual(
      failure,
    );
  });

  it.each([
    [
      'invalid-fields',
      () =>
        JSON.stringify({ ...JSON.parse(fileWithRule((rule) => (rule.matchType = 'glob'))), schemaVersion: '0.1.0' }),
      {
        reason: 'invalid-fields',
        issues: [{ path: 'projectRules[0].matchType', message: 'expected one of prefix, suffix, exact, regex' }],
      },
    ],
    [
      'no-rules',
      () => JSON.stringify({ schemaVersion: '0.1.0', theme: 'auto', projectRules: [] }),
      { reason: 'no-rules' },
    ],
  ])('keeps %s after a successful migration', (_label, text, failure) => {
    // Restamped at 0.1.0 so the injected identity step (to 0.1.1) runs under a 0.1.1 ceiling.
    expect(failureOf(thrownBy(() => parseSettingsFile(text(), '0.1.1', [identity])))).toEqual(failure);
  });
});
