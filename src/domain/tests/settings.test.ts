import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { ColorSelection } from '../color-selection';
import { Palette, PaletteEntry, PaletteEntryId } from '../palette';
import type { MatchType } from '../project-rule';
import { isMatchType, MATCH_TYPES, ProjectRule, ProjectRuleId } from '../project-rule';
import {
  type PlatformBarSettings,
  type PlatformBarTextSettings,
  ProjectSettings,
  type TopBarSettings,
} from '../project-settings';
import { isTheme, THEMES, TintSettings } from '../tint-settings';
import { TopBarHeight } from '../top-bar-height';

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

describe('Palette.resolve', () => {
  const entryId = PaletteEntryId.recreate('p1');
  const palette = new Palette(true, [PaletteEntry.recreate(entryId, 'One', color('#111111'))]);
  const custom = color('#999999');

  it('resolves to the palette entry color when enabled and paletteId references an existing entry', () => {
    expect(palette.resolve(new ColorSelection(entryId, custom)).toHex()).toBe('#111111');
  });

  it('falls back to custom when paletteId does not reference any entry (dangling reference)', () => {
    expect(palette.resolve(new ColorSelection(PaletteEntryId.recreate('missing'), custom)).toHex()).toBe('#999999');
  });

  it('falls back to custom when paletteId is undefined', () => {
    expect(palette.resolve(new ColorSelection(undefined, custom)).toHex()).toBe('#999999');
  });

  it('falls back to custom when the palette is disabled, even with a valid paletteId reference', () => {
    expect(palette.disable().resolve(new ColorSelection(entryId, custom)).toHex()).toBe('#999999');
  });
});

describe('isMatchType', () => {
  it.each(MATCH_TYPES)('accepts the match type %s', (value) => {
    expect(isMatchType(value)).toBe(true);
  });

  it.each(['glob', 'Prefix', '', 'toString'])('rejects %o', (value) => {
    expect(isMatchType(value)).toBe(false);
  });
});

describe('isTheme', () => {
  it.each(THEMES)('accepts %s', (value) => {
    expect(isTheme(value)).toBe(true);
  });

  it.each(['', 'Dark', 'system', 'sepia'])('refuses %j', (value) => {
    expect(isTheme(value)).toBe(false);
  });
});

describe('TintSettings theme', () => {
  const rule = (id: string, pattern: string): ProjectRule =>
    ProjectRule.recreate(ProjectRuleId.recreate(id), 'exact', pattern, DEFAULTS);

  it("defaults to 'auto'", () => {
    expect(TintSettings.DEFAULT_THEME).toBe('auto');
  });

  it('changeTheme returns new settings with the theme and the same rules, leaving the receiver alone', () => {
    const rules = [rule('1', 'my-app')];
    const original = new TintSettings(rules, 'auto');

    const changed = original.changeTheme('dark');

    expect(changed.theme).toBe('dark');
    expect(changed.projectRules).toBe(rules);
    expect(original.theme).toBe('auto');
  });

  it.each<[string, (settings: TintSettings) => TintSettings]>([
    ['addRule', (settings) => settings.addRule(rule('3', 'added'))],
    ['removeRule', (settings) => settings.removeRule(ProjectRuleId.recreate('1'))],
    ['duplicateRule', (settings) => settings.duplicateRule(ProjectRuleId.recreate('1'))],
    ['moveRule', (settings) => settings.moveRule(0, 1)],
    ['updateRule', (settings) => settings.updateRule(ProjectRuleId.recreate('1'), (r) => r.changePattern('x'))],
    ['mergeRules', (settings) => settings.mergeRules([rule('3', 'merged')])],
  ])('%s keeps the theme', (_label, change) => {
    const original = new TintSettings([rule('1', 'one'), rule('2', 'two')], 'dark');

    const changed = change(original);

    expect(changed).not.toBe(original);
    expect(changed.theme).toBe('dark');
  });
});

describe('TopBarSettings.changeHeight', () => {
  it('replaces the height and leaves the other fields alone', () => {
    const changed = DEFAULTS.topBar.changeHeight(TopBarHeight.fromPixels(12)!);

    expect(changed.height.toPixels()).toBe(12);
    expect(changed.enabled).toBe(DEFAULTS.topBar.enabled);
    expect(changed.stripes).toBe(DEFAULTS.topBar.stripes);
    expect(changed.color.equals(DEFAULTS.topBar.color)).toBe(true);
    // Immutable: the original is untouched.
    expect(DEFAULTS.topBar.height.toPixels()).toBe(4);
  });
});

describe('ProjectRule.matches', () => {
  it('throws on a matchType outside MATCH_TYPES (exhaustiveness guard)', () => {
    const rule = ProjectRule.recreate(ProjectRuleId.recreate('1'), 'glob' as MatchType, '*', DEFAULTS);
    expect(() => rule.matches('my-app')).toThrow(/glob/);
  });
});

describe('ProjectRule.isDuplicateOf', () => {
  const rule = (matchType: MatchType, pattern: string): ProjectRule =>
    ProjectRule.recreate(ProjectRuleId.create(), matchType, pattern, DEFAULTS);

  it('is true for the same matchType and pattern', () => {
    expect(rule('exact', 'my-app').isDuplicateOf(rule('exact', 'my-app'))).toBe(true);
  });

  it('is false when matchType differs, even with the same pattern', () => {
    expect(rule('exact', 'my-app').isDuplicateOf(rule('prefix', 'my-app'))).toBe(false);
  });

  it('is false when pattern differs, even with the same matchType', () => {
    expect(rule('exact', 'my-app').isDuplicateOf(rule('exact', 'other-app'))).toBe(false);
  });

  it('ignores id and settings: only matchType and pattern decide duplication', () => {
    const a = ProjectRule.recreate(ProjectRuleId.recreate('a'), 'exact', 'my-app', DEFAULTS);
    const b = ProjectRule.recreate(
      ProjectRuleId.recreate('b'),
      'exact',
      'my-app',
      DEFAULTS.changeTopBar(DEFAULTS.topBar.disable()),
    );
    expect(a.isDuplicateOf(b)).toBe(true);
  });
});

describe('TintSettings.mergeRules', () => {
  const rule = (id: string, matchType: MatchType, pattern: string, settings: ProjectSettings = DEFAULTS): ProjectRule =>
    ProjectRule.recreate(ProjectRuleId.recreate(id), matchType, pattern, settings);
  const withColor = (hex: string): ProjectSettings =>
    DEFAULTS.changeTopBar(DEFAULTS.topBar.changeColor(new ColorSelection(undefined, color(hex))));

  it('returns an equal but distinct list when incoming is empty', () => {
    const original = new TintSettings([rule('1', 'exact', 'my-app')], 'auto');

    const merged = original.mergeRules([]);

    expect(merged.equals(original)).toBe(true);
    expect(merged).not.toBe(original);
  });

  it('does not mutate the receiver', () => {
    const original = new TintSettings([rule('1', 'exact', 'my-app')], 'auto');

    original.mergeRules([rule('2', 'prefix', 'other-app')]);

    expect(original.projectRules).toHaveLength(1);
    expect(original.projectRules[0]!.id.equals(ProjectRuleId.recreate('1'))).toBe(true);
  });

  it('appends a non-duplicate rule after existing rules, under a fresh id', () => {
    const existing = rule('1', 'exact', 'my-app');
    const original = new TintSettings([existing], 'auto');
    const incomingRule = rule('imported-id', 'prefix', 'other-app');

    const merged = original.mergeRules([incomingRule]);

    expect(merged.projectRules).toHaveLength(2);
    expect(merged.projectRules[0]).toBe(existing);
    const appended = merged.projectRules[1]!;
    expect(appended.matchType).toBe('prefix');
    expect(appended.pattern).toBe('other-app');
    // Fresh id: distinct from both the incoming rule's id and every existing rule's id.
    expect(appended.id.equals(incomingRule.id)).toBe(false);
    expect(appended.id.equals(existing.id)).toBe(false);
  });

  it('replaces a duplicate rule in place, keeping its id and position but taking the incoming settings', () => {
    const other = rule('other', 'prefix', 'other-app');
    const existing = rule('1', 'exact', 'my-app', DEFAULTS);
    const original = new TintSettings([other, existing], 'auto');
    const newSettings = DEFAULTS.changeTopBar(DEFAULTS.topBar.disable());
    const incomingRule = rule('imported-id', 'exact', 'my-app', newSettings);

    const merged = original.mergeRules([incomingRule]);

    expect(merged.projectRules).toHaveLength(2);
    expect(merged.projectRules[0]).toBe(other);
    const replaced = merged.projectRules[1]!;
    expect(replaced.id.equals(existing.id)).toBe(true);
    expect(replaced.settings).toEqual(newSettings);
  });

  it('preserves duplicate existing rules in order when a full backup contains both settings', () => {
    const red = withColor('#ff0000');
    const blue = withColor('#0000ff');
    const original = new TintSettings(
      [rule('red', 'exact', 'same-state', red), rule('blue', 'exact', 'same-state', blue)],
      'auto',
    );
    const incoming = [rule('import-red', 'exact', 'same-state', red), rule('import-blue', 'exact', 'same-state', blue)];

    expect(original.replacementTargets(incoming)).toEqual([0, 1]);
    const merged = original.mergeRules(incoming);

    expect(merged.projectRules).toHaveLength(2);
    expect(merged.projectRules.map((r) => r.settings.topBar.color.custom.toHex())).toEqual(['#ff0000', '#0000ff']);
    expect(merged.projectRules[0]!.id.equals(original.projectRules[0]!.id)).toBe(true);
    expect(merged.projectRules[1]!.id.equals(original.projectRules[1]!.id)).toBe(true);
  });

  it('appends both duplicate incoming rules when no original rule matches', () => {
    const original = new TintSettings([], 'auto');
    const incoming = [
      rule('import-red', 'exact', 'same-state', withColor('#ff0000')),
      rule('import-blue', 'exact', 'same-state', withColor('#0000ff')),
    ];

    expect(original.replacementTargets(incoming)).toEqual([undefined, undefined]);
    const merged = original.mergeRules(incoming);

    expect(merged.projectRules).toHaveLength(2);
    expect(merged.projectRules[0]!.id.equals(incoming[0]!.id)).toBe(false);
    expect(merged.projectRules[1]!.id.equals(incoming[1]!.id)).toBe(false);
    expect(merged.projectRules[0]!.id.equals(merged.projectRules[1]!.id)).toBe(false);
  });

  it('replaces one of two matching incoming rules and appends the other', () => {
    const originalRule = rule('existing', 'exact', 'same-state');
    const original = new TintSettings([originalRule], 'auto');
    const incoming = [
      rule('import-red', 'exact', 'same-state', withColor('#ff0000')),
      rule('import-blue', 'exact', 'same-state', withColor('#0000ff')),
    ];

    expect(original.replacementTargets(incoming)).toEqual([0, undefined]);
    const merged = original.mergeRules(incoming);

    expect(merged.projectRules).toHaveLength(2);
    expect(merged.projectRules[0]!.id.equals(originalRule.id)).toBe(true);
    expect(merged.projectRules[0]!.settings.topBar.color.custom.toHex()).toBe('#ff0000');
    expect(merged.projectRules[1]!.settings.topBar.color.custom.toHex()).toBe('#0000ff');
    expect(merged.projectRules[1]!.id.equals(incoming[1]!.id)).toBe(false);
  });

  it('replaces two original matching rules and appends the third incoming rule', () => {
    const originals = [rule('one', 'exact', 'same-state'), rule('two', 'exact', 'same-state')];
    const original = new TintSettings(originals, 'auto');
    const incoming = [
      rule('import-red', 'exact', 'same-state', withColor('#ff0000')),
      rule('import-blue', 'exact', 'same-state', withColor('#0000ff')),
      rule('import-green', 'exact', 'same-state', withColor('#00ff00')),
    ];

    expect(original.replacementTargets(incoming)).toEqual([0, 1, undefined]);
    const merged = original.mergeRules(incoming);

    expect(merged.projectRules).toHaveLength(3);
    expect(merged.projectRules[0]!.id.equals(originals[0]!.id)).toBe(true);
    expect(merged.projectRules[1]!.id.equals(originals[1]!.id)).toBe(true);
    expect(merged.projectRules[2]!.settings.topBar.color.custom.toHex()).toBe('#00ff00');
    expect(merged.projectRules[2]!.id.equals(incoming[2]!.id)).toBe(false);
  });

  it('maps selected rows in their selected order and matches interleaved types to distinct originals', () => {
    const originals = [
      rule('exact-first', 'exact', 'same-state'),
      rule('prefix', 'prefix', 'same-state'),
      rule('exact-second', 'exact', 'same-state'),
    ];
    const original = new TintSettings(originals, 'auto');
    const incoming = [
      rule('import-prefix', 'prefix', 'same-state', withColor('#ff0000')),
      rule('import-exact-one', 'exact', 'same-state', withColor('#0000ff')),
      rule('import-exact-two', 'exact', 'same-state', withColor('#00ff00')),
      rule('import-suffix', 'suffix', 'same-state'),
      rule('import-prefix-extra', 'prefix', 'same-state'),
    ];

    expect(original.replacementTargets(incoming)).toEqual([1, 0, 2, undefined, undefined]);

    const selectedSecondOnly = new TintSettings(originals, 'auto').replacementTargets([incoming[1]!]);
    expect(selectedSecondOnly).toEqual([0]);
    const selectedMerge = original.mergeRules([incoming[1]!]);
    expect(selectedMerge.projectRules[0]!.settings.topBar.color.custom.toHex()).toBe('#0000ff');
    expect(selectedMerge.projectRules[0]!.id.equals(originals[0]!.id)).toBe(true);
    expect(selectedMerge.projectRules[1]!.id.equals(originals[1]!.id)).toBe(true);
  });

  it('does not grow when the same selected subset or an empty selection is imported again', () => {
    const original = new TintSettings([rule('existing', 'exact', 'existing')], 'auto');
    const selected = [rule('imported', 'exact', 'new-rule')];

    const once = original.mergeRules(selected);
    const twice = once.mergeRules(selected);

    expect(once.projectRules).toHaveLength(2);
    expect(twice.projectRules).toHaveLength(2);
    expect(twice.projectRules[1]!.id.equals(once.projectRules[1]!.id)).toBe(true);
    expect(twice.mergeRules([]).projectRules).toHaveLength(2);
  });
});

describe('TintSettings.resolveProjectSettings', () => {
  // `custom` is the per-rule "marker" field (paletteId pinned to undefined so it always wins
  // over the palette): each rule below gets a distinct — and, since Color validates, real —
  // hex value, so an assertion names which rule won.
  const rule = (id: string, matchType: MatchType, pattern: string, custom: string): ProjectRule =>
    ProjectRule.recreate(
      ProjectRuleId.recreate(id),
      matchType,
      pattern,
      projectSettings({ topBar: DEFAULTS.topBar.changeColor(new ColorSelection(undefined, color(custom))) }),
    );

  const noRules = (): TintSettings => new TintSettings([], 'auto');

  const withRules = (...rules: ProjectRule[]): TintSettings =>
    rules.reduce((settings, r) => settings.addRule(r), noRules());

  it('returns undefined when projectId is undefined', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#c0ffee'));
    expect(settings.resolveProjectSettings(undefined)).toBeUndefined();
  });

  it('returns undefined when projectId does not match any rule', () => {
    const settings = withRules(rule('1', 'exact', 'my-app', '#c0ffee'));
    expect(settings.resolveProjectSettings('unrelated-project')).toBeUndefined();
  });

  it('returns undefined when there are no rules at all', () => {
    expect(noRules().resolveProjectSettings('anything')).toBeUndefined();
  });

  it('returns undefined for an empty-string projectId (falsy, treated the same as no project id)', () => {
    const settings = withRules(rule('catch-all', 'prefix', '', '#aaaaaa'));
    expect(settings.resolveProjectSettings('')).toBeUndefined();
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
      expect(settings.resolveProjectSettings('other-my-app')).toBeUndefined();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const openParen = withRules(rule('1', 'prefix', '(', '#b0b0b0'));
      expect(openParen.resolveProjectSettings('(abc')?.topBar.color.custom.toHex()).toBe('#b0b0b0');

      const dot = withRules(rule('1', 'prefix', 'a.c', '#b0b0b0'));
      expect(dot.resolveProjectSettings('abc')).toBeUndefined();
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
      expect(settings.resolveProjectSettings('my-app-prod-2')).toBeUndefined();
    });

    it('treats a pattern containing regex metacharacters as a literal string', () => {
      const closeParen = withRules(rule('1', 'suffix', ')', '#5a5a5a'));
      expect(closeParen.resolveProjectSettings('abc)')?.topBar.color.custom.toHex()).toBe('#5a5a5a');

      const dot = withRules(rule('1', 'suffix', 'a.c', '#5a5a5a'));
      expect(dot.resolveProjectSettings('abc')).toBeUndefined();
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
      expect(settings.resolveProjectSettings('my-app-prod')).toBeUndefined();
      expect(settings.resolveProjectSettings('not-my-app')).toBeUndefined();
    });

    it('an empty pattern matches nothing, since no real projectId is an empty string', () => {
      const settings = withRules(rule('1', 'exact', '', '#e0e0e0'));
      expect(settings.resolveProjectSettings('my-app')).toBeUndefined();
    });
  });

  describe('matchType "regex"', () => {
    it('requires a full match: an unanchored pattern no longer matches as a substring', () => {
      const settings = withRules(rule('1', 'regex', 'test', '#0e0e0e'));
      expect(settings.resolveProjectSettings('test-project')).toBeUndefined();
    });

    it('matches when the pattern itself covers the entire projectId (e.g. via a trailing .*)', () => {
      const settings = withRules(rule('1', 'regex', '^test-project.*', '#0e0e0e'));
      expect(settings.resolveProjectSettings('test-project-123')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
    });

    it('continues to work for patterns already anchored with ^...$', () => {
      const settings = withRules(rule('1', 'regex', '^abc$', '#0e0e0e'));
      expect(settings.resolveProjectSettings('abc')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('abcd')).toBeUndefined();
    });

    // The `^(?:...)$` wrapper wraps a non-capturing group around the whole pattern before
    // anchoring, so a top-level `|` stays scoped inside it instead of splitting the anchors
    // themselves (which would let e.g. "bbb" alone escape the leading `^`).
    it('keeps top-level alternation scoped inside the full-match wrapper', () => {
      const settings = withRules(rule('1', 'regex', 'aaa|bbb', '#0e0e0e'));
      expect(settings.resolveProjectSettings('aaa')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('bbb')?.topBar.color.custom.toHex()).toBe('#0e0e0e');
      expect(settings.resolveProjectSettings('xaaa')).toBeUndefined();
    });

    it('skips a rule with an invalid regex pattern and evaluates the next rule', () => {
      const settings = withRules(rule('invalid', 'regex', '(', '#111111'), rule('valid', 'regex', 'my-app', '#222222'));

      expect(settings.resolveProjectSettings('my-app')?.topBar.color.custom.toHex()).toBe('#222222');
    });

    it('returns undefined when every rule has an invalid regex pattern (no fallback project)', () => {
      const settings = withRules(
        rule('invalid-1', 'regex', '(', '#111111'),
        rule('invalid-2', 'regex', '[', '#222222'),
      );

      expect(settings.resolveProjectSettings('my-app')).toBeUndefined();
    });

    it('an empty pattern only matches an empty projectId, so it never matches a real projectId', () => {
      const settings = withRules(rule('1', 'regex', '', '#0e0e0e'));
      expect(settings.resolveProjectSettings('literally-anything')).toBeUndefined();
      expect(settings.resolveProjectSettings('my-app')).toBeUndefined();
    });
  });
});
