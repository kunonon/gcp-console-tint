import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { ColorSelection } from '../color-selection';
import { Palette, PaletteEntry, PaletteEntryId } from '../palette';
import { ProjectRule, ProjectRuleId } from '../project-rule';
import { ProjectSettings } from '../project-settings';
import { TintSettings } from '../tint-settings';
import { TopBarHeight } from '../top-bar-height';

const color = (value: string): Color => Color.fromHex(value)!;

describe('PaletteEntry.equals', () => {
  it('is true for the same id with different attributes', () => {
    const a = PaletteEntry.recreate(PaletteEntryId.recreate('p1'), 'One', color('#111111'));
    const b = PaletteEntry.recreate(PaletteEntryId.recreate('p1'), 'Two', color('#222222'));
    expect(a.equals(b)).toBe(true);
  });

  it('is false for a different id with identical attributes', () => {
    const a = PaletteEntry.recreate(PaletteEntryId.recreate('p1'), 'One', color('#111111'));
    const b = PaletteEntry.recreate(PaletteEntryId.recreate('p2'), 'One', color('#111111'));
    expect(a.equals(b)).toBe(false);
  });

  it('keeps PaletteEntryId and ProjectRuleId nominally distinct', () => {
    // @ts-expect-error a PaletteEntryId is not a ProjectRuleId
    const wrong: ProjectRuleId = PaletteEntryId.create();
    expect(wrong).toBeDefined();
  });
});

describe('ProjectRule.equals', () => {
  it('is true for the same id with different attributes', () => {
    const a = ProjectRule.recreate(ProjectRuleId.recreate('r1'), 'prefix', 'foo', ProjectSettings.DEFAULT);
    const b = ProjectRule.recreate(
      ProjectRuleId.recreate('r1'),
      'exact',
      'bar',
      ProjectSettings.DEFAULT.changeTopBar(ProjectSettings.DEFAULT.topBar.disable()),
    );
    expect(a.equals(b)).toBe(true);
  });

  it('is false for a different id with identical attributes', () => {
    const a = ProjectRule.recreate(ProjectRuleId.recreate('r1'), 'prefix', 'foo', ProjectSettings.DEFAULT);
    const b = ProjectRule.recreate(ProjectRuleId.recreate('r2'), 'prefix', 'foo', ProjectSettings.DEFAULT);
    expect(a.equals(b)).toBe(false);
  });
});

describe('ColorSelection.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = new ColorSelection(PaletteEntryId.recreate('p1'), color('#111111'));
    const b = new ColorSelection(PaletteEntryId.recreate('p1'), color('#111111'));
    expect(a.equals(b)).toBe(true);
  });

  it('is false when custom differs', () => {
    const a = new ColorSelection(PaletteEntryId.recreate('p1'), color('#111111'));
    const b = new ColorSelection(PaletteEntryId.recreate('p1'), color('#222222'));
    expect(a.equals(b)).toBe(false);
  });

  it('is false when only one side has a palette reference', () => {
    const a = new ColorSelection(PaletteEntryId.recreate('p1'), color('#111111'));
    const b = new ColorSelection(undefined, color('#111111'));
    expect(a.equals(b)).toBe(false);
    expect(b.equals(a)).toBe(false);
  });
});

describe('TopBarSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.topBar;
    const b = ProjectSettings.DEFAULT.topBar.changeHeight(a.height);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when height differs', () => {
    const a = ProjectSettings.DEFAULT.topBar;
    const b = a.changeHeight(TopBarHeight.fromPixels(a.height.toPixels() + 1)!);
    expect(a.equals(b)).toBe(false);
  });

  it('compares height by value: changeHeight to an equal-but-separate instance stays equal', () => {
    const a = ProjectSettings.DEFAULT.topBar;
    const b = a.changeHeight(TopBarHeight.fromPixels(a.height.toPixels())!);
    expect(b.height).not.toBe(a.height);
    expect(a.equals(b)).toBe(true);
  });
});

describe('PlatformBarSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.platformBar;
    const b = a.stripes
      ? ProjectSettings.DEFAULT.platformBar.enableStripes()
      : ProjectSettings.DEFAULT.platformBar.disableStripes();
    expect(a.equals(b)).toBe(true);
  });

  it('is false when stripes differs', () => {
    const a = ProjectSettings.DEFAULT.platformBar;
    const b = a.stripes ? a.disableStripes() : a.enableStripes();
    expect(a.equals(b)).toBe(false);
  });
});

describe('PlatformBarTextSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT.platformBarText;
    const b = a.auto
      ? ProjectSettings.DEFAULT.platformBarText.enableAuto()
      : ProjectSettings.DEFAULT.platformBarText.disableAuto();
    expect(a.equals(b)).toBe(true);
  });

  it('is false when auto differs', () => {
    const a = ProjectSettings.DEFAULT.platformBarText;
    const b = a.auto ? a.disableAuto() : a.enableAuto();
    expect(a.equals(b)).toBe(false);
  });
});

describe('ProjectSettings.equals', () => {
  it('is true for separately constructed, equal instances', () => {
    const a = ProjectSettings.DEFAULT;
    const b = ProjectSettings.DEFAULT.changeTopBar(ProjectSettings.DEFAULT.topBar);
    expect(a.equals(b)).toBe(true);
  });

  it('is false when a nested section differs', () => {
    const a = ProjectSettings.DEFAULT;
    const b = a.changeTopBar(a.topBar.enabled ? a.topBar.disable() : a.topBar.enable());
    expect(a.equals(b)).toBe(false);
  });
});

describe('Palette.equals', () => {
  const entryA = PaletteEntry.create('One', color('#111111'));
  const entryB = PaletteEntry.create('Two', color('#222222'));

  it('is true for the same entry ids in the same order, even with different names', () => {
    const a = new Palette(true, [entryA, entryB]);
    const b = new Palette(true, [entryA.rename('Renamed'), entryB.changeColor(color('#333333'))]);
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
    const b = new TintSettings([ruleA.changePattern('changed'), ruleB]);
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
