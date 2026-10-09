import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { z } from 'zod';
import { Color } from '../../../domain/color';
import * as projectRule from '../../../domain/project-rule';
import { TopBarHeight } from '../../../domain/top-bar-height';
import { SettingsImportError, type SettingsImportIssue } from '../../../port/settings-store';
import type { SchemaMigration } from '../migrations';
import { parseSettingsFile } from '../settings-file';

// Validation keeps at most 100 issues and stops at the 101st. These cases pin down WHICH 100 are
// kept, where it stops, and that nothing past the stop is read (structure) or judged (values).

// The order oracle: the whole-file schema the import used to run in one call, restated here on
// purpose rather than imported, so the element-by-element walk is checked against Zod's own issue
// order and wording. It is only ever run on plain arrays, never on the recording Proxies below
// (it would read every element and spoil their counts).
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

// biome-ignore lint/suspicious/noExplicitAny: the fixtures must be able to violate the shape
type RawRule = any;

// A rule exactly as the exporter writes ProjectSettings.DEFAULT, as a fresh object every call.
function validRule(id: string): RawRule {
  return {
    id,
    matchType: 'exact',
    pattern: 'my-app',
    settings: {
      palette: { enabled: true, entries: [{ id: 'default', name: 'Primary', color: '#ff6d00' }] },
      topBar: { enabled: true, color: { paletteId: 'default', custom: '#ff6d00' }, height: 4, stripes: false },
      platformBar: { enabled: true, color: { paletteId: 'default', custom: '#ff6d00' }, stripes: false },
      platformBarText: { enabled: true, color: { paletteId: null, custom: '#ffffff' }, auto: false },
    },
  };
}

// `count` rules whose only structural fault is a numeric id: one issue each.
function idInvalidRules(count: number): RawRule[] {
  return Array.from({ length: count }, () => ({ ...validRule('unused'), id: 1 }));
}

function validRules(count: number, from = 0): RawRule[] {
  return Array.from({ length: count }, (_, i) => validRule(`rule-${from + i}`));
}

// Hands `data` to validation exactly as a migration step would return it, so a fixture can carry
// Proxies. The file itself is stamped 0.1.0 and the build is at 0.1.1, so the step runs.
function parseMigrated(data: unknown) {
  const step: SchemaMigration = { to: '0.1.1', migrate: () => data as Record<string, unknown> };
  return parseSettingsFile(JSON.stringify({ schemaVersion: '0.1.0' }), '0.1.1', [step]);
}

function invalidFieldsOf(data: unknown) {
  let thrown: unknown;
  try {
    parseMigrated(data);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SettingsImportError);
  const error = thrown as SettingsImportError;
  if (error.failure.reason !== 'invalid-fields')
    throw new Error(`expected invalid-fields, got ${error.failure.reason}`);
  return { failure: error.failure, message: error.message };
}

// Wraps an array so every numeric index read is recorded (length and other keys are not).
function recordingArray<T>(items: T[]) {
  const reads: number[] = [];
  const proxy = new Proxy(items, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key));
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, reads, maxIndex: () => Math.max(-1, ...reads) };
}

describe('structure stage: the 100 issues kept and the 101st that stops validation follow the schema order', () => {
  it('keeps entries[1].id as the 100th issue and stops at the topBar.height that follows it (97 rules before)', () => {
    const last = validRule('last');
    last.settings.palette.enabled = 'yes';
    last.settings.palette.entries = [
      { id: 1, name: 'a', color: '#000000' },
      { id: 2, name: 'b', color: '#000000' },
    ];
    last.settings.topBar.height = '4';
    last.settings.topBar.stripes = 'no';
    const data = { theme: 'auto', projectRules: [...idInvalidRules(97), last] };
    const oracle = oracleIssues(data);

    const { failure, message } = invalidFieldsOf(data);

    expect(failure.issues).toEqual(oracle.slice(0, 100));
    expect(failure.issues[99]!.path).toBe('projectRules[97].settings.palette.entries[1].id');
    expect(oracle[100]!.path).toBe('projectRules[97].settings.topBar.height');
    expect(failure.validationStopped).toBe(true);
    expect(message).toBe('Missing or invalid fields (100+)');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])(
    'keeps a %s entries array as the 100th issue and stops at the topBar.height that follows it',
    (_label, entries) => {
      const last = validRule('last');
      last.settings.palette.enabled = 'yes';
      if (entries === undefined) delete last.settings.palette.entries;
      else last.settings.palette.entries = entries;
      last.settings.topBar.height = '4';
      const data = { theme: 'auto', projectRules: [...idInvalidRules(98), last] };
      const oracle = oracleIssues(data);

      const { failure } = invalidFieldsOf(data);

      expect(failure.issues).toEqual(oracle.slice(0, 100));
      expect(failure.issues[99]!.path).toBe('projectRules[98].settings.palette.entries');
      expect(oracle[100]!.path).toBe('projectRules[98].settings.topBar.height');
      expect(failure.validationStopped).toBe(true);
    },
  );

  it.each([
    [99, 99, undefined, 'Missing or invalid fields (99)'],
    [100, 100, undefined, 'Missing or invalid fields (100)'],
    [101, 100, true, 'Missing or invalid fields (100+)'],
  ])('with %i faulty rules keeps %i issues (validationStopped: %s)', (faulty, kept, stopped, expectedMessage) => {
    const data = { theme: 'auto', projectRules: idInvalidRules(faulty) };

    const { failure, message } = invalidFieldsOf(data);

    expect(failure.issues).toEqual(oracleIssues(data).slice(0, 100));
    expect(failure.issues).toHaveLength(kept);
    expect(failure.validationStopped).toBe(stopped);
    expect('validationStopped' in failure).toBe(stopped === true);
    expect(message).toBe(expectedMessage);
  });

  it('keeps reading valid rules after exactly 100 issues, and does not report a stop', () => {
    const data = { theme: 'auto', projectRules: [...idInvalidRules(100), ...validRules(400)] };

    const { failure, message } = invalidFieldsOf(data);

    expect(failure.issues).toEqual(oracleIssues(data));
    expect('validationStopped' in failure).toBe(false);
    expect(message).toBe('Missing or invalid fields (100)');
  });

  it('stops inside one rule with 150 faulty palette entries, keeping entries[0..99]', () => {
    const rule = validRule('only');
    rule.settings.palette.entries = Array.from({ length: 150 }, () => ({ id: 1, name: 'n', color: '#000000' }));
    const data = { theme: 'auto', projectRules: [rule] };

    const { failure } = invalidFieldsOf(data);

    expect(failure.issues).toEqual(oracleIssues(data).slice(0, 100));
    expect(failure.issues.map((issue) => issue.path)).toEqual(
      Array.from({ length: 100 }, (_, j) => `projectRules[0].settings.palette.entries[${j}].id`),
    );
    expect(failure.validationStopped).toBe(true);
  });
});

describe('structure stage: elements are read once each, and none after the 101st issue', () => {
  it('reads rules[0..100] once each when every rule is faulty (150 rules)', () => {
    const items = idInvalidRules(150);
    const rules = recordingArray(items);

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: rules.proxy });

    expect(rules.maxIndex()).toBe(100);
    expect(rules.reads).toHaveLength(101);
    expect(failure.issues).toEqual(oracleIssues({ theme: 'auto', projectRules: items }).slice(0, 100));
  });

  it('reads entries[0..100] once each when every entry of one rule is faulty (150 entries)', () => {
    const entryItems = Array.from({ length: 150 }, () => ({ id: 1, name: 'n', color: '#000000' }));
    const entries = recordingArray(entryItems);
    const rule = validRule('only');
    rule.settings.palette.entries = entries.proxy;
    const rules = recordingArray([rule]);

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: rules.proxy });

    expect(rules.maxIndex()).toBe(0);
    expect(rules.reads).toHaveLength(1);
    expect(entries.maxIndex()).toBe(100);
    expect(entries.reads).toHaveLength(101);
    const plainRule = validRule('only');
    plainRule.settings.palette.entries = entryItems;
    expect(failure.issues).toEqual(oracleIssues({ theme: 'auto', projectRules: [plainRule] }).slice(0, 100));
  });

  it('reads each of 150 valid rules exactly once', () => {
    const rules = recordingArray(validRules(150));

    expect(parseMigrated({ theme: 'auto', projectRules: rules.proxy }).projectRules).toHaveLength(150);

    expect(rules.maxIndex()).toBe(149);
    expect(rules.reads).toHaveLength(150);
  });

  it('reads each of 150 valid palette entries exactly once', () => {
    const entries = recordingArray(
      Array.from({ length: 150 }, (_, j) => ({ id: `entry-${j}`, name: 'n', color: '#000000' })),
    );
    const rule = validRule('only');
    rule.settings.palette.entries = entries.proxy;

    expect(
      parseMigrated({ theme: 'auto', projectRules: [rule] }).projectRules[0]!.settings.palette.entries,
    ).toHaveLength(150);

    expect(entries.maxIndex()).toBe(149);
    expect(entries.reads).toHaveLength(150);
  });

  it("does not read a rule's entries when an earlier field of that rule yields the 101st issue", () => {
    const entries = recordingArray([{ id: 'e', name: 'n', color: '#000000' }]);
    const last = { ...validRule('unused'), id: 1 };
    last.settings.palette.entries = entries.proxy;

    const { message } = invalidFieldsOf({ theme: 'auto', projectRules: [...idInvalidRules(100), last] });

    expect(message).toBe('Missing or invalid fields (100+)');
    expect(entries.reads).toEqual([]);
  });

  it('reads 100 faulty rules and the valid tail after them exactly once each', () => {
    const tail = 50;
    const rules = recordingArray([...idInvalidRules(100), ...validRules(tail)]);

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: rules.proxy });

    expect(failure.issues).toHaveLength(100);
    expect(rules.reads).toHaveLength(100 + tail);
    expect(rules.maxIndex()).toBe(100 + tail - 1);
  });
});

describe('value stage: stops right at the judgment that yields the 101st issue', () => {
  let isMatchType: MockInstance;
  let fromHex: MockInstance;
  let fromPixels: MockInstance;

  beforeEach(() => {
    isMatchType = vi.spyOn(projectRule, 'isMatchType');
    fromHex = vi.spyOn(Color, 'fromHex');
    fromPixels = vi.spyOn(TopBarHeight, 'fromPixels');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Counts only the calls made by the import itself, not by building the fixture.
  function clearSpies() {
    isMatchType.mockClear();
    fromHex.mockClear();
    fromPixels.mockClear();
  }

  const calls = () => [isMatchType.mock.calls.length, fromHex.mock.calls.length, fromPixels.mock.calls.length];

  it('B: 150 rules with an unknown match type stop at rule 100, judging nothing else in it', () => {
    const rules = validRules(150).map((rule) => ({
      ...rule,
      matchType: 'glob',
      settings: { ...rule.settings, palette: { enabled: true, entries: [] } },
    }));
    clearSpies();

    const { failure, message } = invalidFieldsOf({ theme: 'auto', projectRules: rules });

    expect(calls()).toEqual([101, 300, 100]);
    expect(failure.issues).toEqual(
      Array.from({ length: 100 }, (_, i) => ({
        path: `projectRules[${i}].matchType`,
        message: 'expected one of prefix, suffix, exact, regex',
      })),
    );
    expect(failure.validationStopped).toBe(true);
    expect(message).toBe('Missing or invalid fields (100+)');
  });

  it('judges every later value after exactly 100 issues, and does not report a stop', () => {
    const faulty = validRules(100).map((rule) => ({
      ...rule,
      matchType: 'glob',
      settings: { ...rule.settings, palette: { enabled: true, entries: [] } },
    }));
    const data = { theme: 'auto', projectRules: [...faulty, ...validRules(50, 100)] };
    clearSpies();

    const { failure, message } = invalidFieldsOf(data);

    // 100 faulty rules judge 3 bar colors each; the 50 valid ones also judge their one entry color.
    expect(calls()).toEqual([150, 100 * 3 + 50 * 4, 150]);
    expect(failure.issues).toHaveLength(100);
    expect(failure.issues[99]!.path).toBe('projectRules[99].matchType');
    expect('validationStopped' in failure).toBe(false);
    expect(message).toBe('Missing or invalid fields (100)');
  });

  it("D: 102 entries sharing one id stop at entries[101].id, without judging that entry's color", () => {
    const rule = validRule('only');
    rule.settings.palette.entries = Array.from({ length: 102 }, () => ({ id: 'same', name: 'n', color: '#000000' }));
    clearSpies();

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: [rule] });

    expect(calls()).toEqual([1, 101, 0]);
    expect(failure.issues).toEqual(
      Array.from({ length: 100 }, (_, j) => ({
        path: `projectRules[0].settings.palette.entries[${j + 1}].id`,
        message: 'duplicate palette entry id',
      })),
    );
    expect(failure.validationStopped).toBe(true);
  });

  it('A: 150 entries with bad colors stop at entries[100].color', () => {
    const rule = validRule('only');
    rule.settings.palette.entries = Array.from({ length: 150 }, (_, j) => ({ id: `e${j}`, name: 'n', color: 'bad' }));
    clearSpies();

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: [rule] });

    expect(calls()).toEqual([1, 101, 0]);
    expect(failure.issues).toEqual(
      Array.from({ length: 100 }, (_, j) => ({
        path: `projectRules[0].settings.palette.entries[${j}].color`,
        message: 'expected a color like #rrggbb',
      })),
    );
    expect(failure.validationStopped).toBe(true);
  });

  it('T: 100 bad entry colors then a bad height stop at the height, before the platform bar colors', () => {
    const rule = validRule('only');
    rule.settings.palette.entries = Array.from({ length: 100 }, (_, j) => ({ id: `e${j}`, name: 'n', color: 'bad' }));
    rule.settings.topBar.color.custom = '#00aa00';
    rule.settings.topBar.height = 99;
    rule.settings.platformBar.color.custom = '#0000aa';
    rule.settings.platformBarText.color.custom = '#0000bb';
    clearSpies();

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: [rule] });

    expect(calls()).toEqual([1, 101, 1]);
    expect(fromHex.mock.calls.map(([hex]) => hex)).not.toContain('#0000aa');
    expect(fromHex.mock.calls.map(([hex]) => hex)).not.toContain('#0000bb');
    expect(failure.issues).toEqual(
      Array.from({ length: 100 }, (_, j) => ({
        path: `projectRules[0].settings.palette.entries[${j}].color`,
        message: 'expected a color like #rrggbb',
      })),
    );
    expect(failure.validationStopped).toBe(true);
  });

  it('never reaches the value stage when any rule has a structural fault (150 rules)', () => {
    const rules = validRules(150);
    rules[0].matchType = 'glob';
    rules[149].settings.topBar.height = '4';
    clearSpies();

    const { failure } = invalidFieldsOf({ theme: 'auto', projectRules: rules });

    expect(failure.issues).toEqual([
      { path: 'projectRules[149].settings.topBar.height', message: 'Invalid input: expected number, received string' },
    ]);
    expect(calls()).toEqual([0, 0, 0]);
  });
});
