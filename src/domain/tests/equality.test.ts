import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { ColorSelection } from '../color-selection';
import { Palette, PaletteEntry } from '../palette';
import { ProjectRule } from '../project-rule';
import { ProjectSettings } from '../project-settings';
import { TintSettings } from '../tint-settings';

const color = (value: string): Color => Color.fromHex(value)!;

describe('PaletteEntry.equals', () => {
  it('is true for the same id with different attributes', () => {
    const a = new PaletteEntry('p1', 'One', color('#111111'));
    const b = new PaletteEntry('p1', 'Two', color('#222222'));
    expect(a.equals(b)).toBe(true);
  });

  it('is false for a different id with identical attributes', () => {
    const a = new PaletteEntry('p1', 'One', color('#111111'));
    const b = new PaletteEntry('p2', 'One', color('#111111'));
    expect(a.equals(b)).toBe(false);
  });
});

describe('ProjectRule.equals', () => {
  it('is true for the same id with different attributes', () => {
    const a = new ProjectRule('r1', 'prefix', 'foo', ProjectSettings.DEFAULT);
    const b = new ProjectRule(
      'r1',
      'exact',
      'bar',
      ProjectSettings.DEFAULT.withTopBar(ProjectSettings.DEFAULT.topBar.withEnabled(false)),
    );
    expect(a.equals(b)).toBe(true);
  });

  it('is false for a different id with identical attributes', () => {
    const a = new ProjectRule('r1', 'prefix', 'foo', ProjectSettings.DEFAULT);
    const b = new ProjectRule('r2', 'prefix', 'foo', ProjectSettings.DEFAULT);
    expect(a.equals(b)).toBe(false);
  });
});

describe('ColorSelection.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = new ColorSelection('p1', color('#111111'));
    const b = new ColorSelection('p1', color('#111111'));
    expect(a.equals(b)).toBe(true);
  });

  it('is false when custom differs', () => {
    const a = new ColorSelection('p1', color('#111111'));
    const b = new ColorSelection('p1', color('#222222'));
    expect(a.equals(b)).toBe(false);
  });
});

describe('TopBarSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.topBar;
    const b = ProjectSettings.DEFAULT.topBar.withHeight(a.height);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when height differs', () => {
    const a = ProjectSettings.DEFAULT.topBar;
    const b = a.withHeight(a.height + 1);
    expect(a.equals(b)).toBe(false);
  });
});

describe('PlatformBarSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.platformBar;
    const b = ProjectSettings.DEFAULT.platformBar.withStripes(a.stripes);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when stripes differs', () => {
    const a = ProjectSettings.DEFAULT.platformBar;
    const b = a.withStripes(!a.stripes);
    expect(a.equals(b)).toBe(false);
  });
});

describe('PlatformBarTextSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.platformBarText;
    const b = ProjectSettings.DEFAULT.platformBarText.withAuto(a.auto);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when auto differs', () => {
    const a = ProjectSettings.DEFAULT.platformBarText;
    const b = a.withAuto(!a.auto);
    expect(a.equals(b)).toBe(false);
  });
});

describe('ProjectSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT;
    const b = ProjectSettings.DEFAULT.withTopBar(ProjectSettings.DEFAULT.topBar);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when a nested section differs', () => {
    const a = ProjectSettings.DEFAULT;
    const b = a.withTopBar(a.topBar.withEnabled(!a.topBar.enabled));
    expect(a.equals(b)).toBe(false);
  });
});

describe('Palette.equals', () => {
  const entryA = PaletteEntry.create('One', color('#111111'));
  const entryB = PaletteEntry.create('Two', color('#222222'));

  it('is true for the same entry ids in the same order, even with different names', () => {
    const a = new Palette(true, [entryA, entryB]);
    const b = new Palette(true, [entryA.withName('Renamed'), entryB.withColor(color('#333333'))]);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when the order differs', () => {
    const a = new Palette(true, [entryA, entryB]);
    const b = new Palette(true, [entryB, entryA]);
    expect(a.equals(b)).toBe(false);
  });

  it('is false when the length differs', () => {
    const a = new Palette(true, [entryA, entryB]);
    const b = new Palette(true, [entryA]);
    expect(a.equals(b)).toBe(false);
  });

  it('is false when enabled differs', () => {
    const a = new Palette(true, [entryA]);
    const b = new Palette(false, [entryA]);
    expect(a.equals(b)).toBe(false);
  });
});

describe('TintSettings.equals', () => {
  const ruleA = ProjectRule.create('prefix', 'foo');
  const ruleB = ProjectRule.create('exact', 'bar');

  it('is true for the same rule ids in the same order', () => {
    const a = new TintSettings([ruleA, ruleB]);
    const b = new TintSettings([ruleA.withPattern('changed'), ruleB]);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when the order differs', () => {
    const a = new TintSettings([ruleA, ruleB]);
    const b = new TintSettings([ruleB, ruleA]);
    expect(a.equals(b)).toBe(false);
  });

  it('is false when a rule id differs', () => {
    const a = new TintSettings([ruleA]);
    const b = new TintSettings([ruleB]);
    expect(a.equals(b)).toBe(false);
  });
});
