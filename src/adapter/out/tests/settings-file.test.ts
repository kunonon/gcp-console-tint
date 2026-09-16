import { describe, expect, it } from 'vitest';
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
  const settings = new TintSettings([
    ProjectRule.recreate(ProjectRuleId.recreate('rule-1'), 'exact', 'my-app', ProjectSettings.DEFAULT),
  ]);
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
    const text = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, projectRules: [] });

    expect(failureOf(thrownBy(() => parse(text)))).toEqual({ reason: 'no-rules' });
  });

  it('ignores keys it does not know, at every level (a file from a newer release still imports)', () => {
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
    const original = new TintSettings([
      ProjectRule.recreate(
        ProjectRuleId.recreate('rule-1'),
        'exact',
        'my-app',
        ProjectSettings.DEFAULT.changeTopBar(
          ProjectSettings.DEFAULT.topBar.changeColor(new ColorSelection(undefined, Color.fromHex('#00ff00')!)),
        ),
      ),
    ]);
    const text = JSON.stringify(toStored(original, CURRENT_SCHEMA_VERSION));

    const parsed = parse(text);

    expect(parsed.equals(original)).toBe(true);
    expect(parsed.projectRules[0]!.settings).toEqual(original.projectRules[0]!.settings);
  });
});

// Stage 1: required keys and JSON types. These never reach the domain — the Zod schema refuses
// the file first — so the message is Zod's own.
describe('parseSettingsFile: structural issues (missing keys and wrong JSON types)', () => {
  it.each([
    ['projectRules is missing', (file: Record<string, unknown>) => delete file.projectRules, 'projectRules'],
    ['projectRules is not an array', (file: Record<string, unknown>) => (file.projectRules = {}), 'projectRules'],
  ])('reports %s at the root', (_label, mutate, path) => {
    const file = validFile();
    mutate(file);

    expect(paths(thrownBy(() => parse(JSON.stringify(file))))).toEqual([path]);
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

// Stage 2: the values themselves, judged by the domain's own factories (Color.fromHex,
// TopBarHeight.fromPixels, isMatchType) rather than by anything restated in the adapter.
describe('parseSettingsFile: value issues (structurally fine, but the domain refuses the value)', () => {
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

  it('refuses a file stamped newer than what this build can have written (newer-version)', () => {
    expect(failureOf(thrownBy(() => parseSettingsFile(stamped('0.2.0'), '0.1.5')))).toEqual({
      reason: 'newer-version',
      version: '0.2.0',
    });
  });

  it('accepts a stamp equal to the current version, and one between the schema version and it', () => {
    expect(parseSettingsFile(stamped('0.1.5'), '0.1.5').projectRules).toHaveLength(1);
    expect(parseSettingsFile(stamped('0.1.2'), '0.1.5').projectRules).toHaveLength(1);
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
