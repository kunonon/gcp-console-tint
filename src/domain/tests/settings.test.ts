import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { ColorSelection } from '../color-selection';
import { Palette, PaletteEntry } from '../palette';
import type { MatchType } from '../project-rule';
import { ProjectRule } from '../project-rule';
import {
  type PlatformBarSettings,
  type PlatformBarTextSettings,
  ProjectSettings,
  type TopBarSettings,
} from '../project-settings';
import { TintSettings } from '../tint-settings';

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

  const noRules = (): TintSettings => new TintSettings([]);

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
