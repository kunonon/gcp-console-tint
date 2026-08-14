import { Color } from './color';
import { ColorSelection } from './color-selection';
import { Palette, PaletteEntry } from './palette';

// Product policy, not color theory: the canonical default colors for the tint surfaces. The
// `?? Color.BLACK` branch is unreachable ('#ff6d00' is a valid '#rrggbb' literal) and only
// exists to keep the type non-null; the settings tests assert the real value.
const DEFAULT_COLOR = Color.parse('#ff6d00') ?? Color.BLACK;
const DEFAULT_TEXT_COLOR = Color.WHITE;
const DEFAULT_TOP_BAR_HEIGHT = 4;

export class TopBarSettings {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    readonly height: number,
    readonly stripes: boolean,
  ) {}

  withEnabled(enabled: boolean): TopBarSettings {
    return new TopBarSettings(enabled, this.color, this.height, this.stripes);
  }

  withColor(color: ColorSelection): TopBarSettings {
    return new TopBarSettings(this.enabled, color, this.height, this.stripes);
  }

  withHeight(height: number): TopBarSettings {
    return new TopBarSettings(this.enabled, this.color, height, this.stripes);
  }

  withStripes(stripes: boolean): TopBarSettings {
    return new TopBarSettings(this.enabled, this.color, this.height, stripes);
  }
}

export class PlatformBarSettings {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    readonly stripes: boolean,
  ) {}

  withEnabled(enabled: boolean): PlatformBarSettings {
    return new PlatformBarSettings(enabled, this.color, this.stripes);
  }

  withColor(color: ColorSelection): PlatformBarSettings {
    return new PlatformBarSettings(this.enabled, color, this.stripes);
  }

  withStripes(stripes: boolean): PlatformBarSettings {
    return new PlatformBarSettings(this.enabled, this.color, stripes);
  }
}

export class PlatformBarTextSettings {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    // Pick black/white automatically by WCAG contrast against the platform bar color.
    readonly auto: boolean,
  ) {}

  withEnabled(enabled: boolean): PlatformBarTextSettings {
    return new PlatformBarTextSettings(enabled, this.color, this.auto);
  }

  withColor(color: ColorSelection): PlatformBarTextSettings {
    return new PlatformBarTextSettings(this.enabled, color, this.auto);
  }

  withAuto(auto: boolean): PlatformBarTextSettings {
    return new PlatformBarTextSettings(this.enabled, this.color, auto);
  }
}

// One object per tinted surface, mirroring the settings UI's cards.
export class ProjectSettings {
  // The domain owns the default VALUES; recovering junk storage back to them is the settings
  // repository's job (adapter/out), which sources its `.catch()` fallbacks from here.
  static readonly DEFAULT: ProjectSettings = new ProjectSettings(
    // The palette's own default entries (a single "Primary" swatch). Its id is the stable
    // literal 'default' — not a generated one — because topBar/platformBar's default color
    // selection below references it by that id; Palette.resolve() would fail to resolve it
    // otherwise.
    new Palette(true, [new PaletteEntry('default', 'Primary', DEFAULT_COLOR)]),
    new TopBarSettings(true, new ColorSelection('default', DEFAULT_COLOR), DEFAULT_TOP_BAR_HEIGHT, false),
    new PlatformBarSettings(true, new ColorSelection('default', DEFAULT_COLOR), false),
    new PlatformBarTextSettings(true, new ColorSelection(null, DEFAULT_TEXT_COLOR), false),
  );

  constructor(
    readonly palette: Palette,
    readonly topBar: TopBarSettings,
    readonly platformBar: PlatformBarSettings,
    readonly platformBarText: PlatformBarTextSettings,
  ) {}

  withPalette(palette: Palette): ProjectSettings {
    return new ProjectSettings(palette, this.topBar, this.platformBar, this.platformBarText);
  }

  withTopBar(topBar: TopBarSettings): ProjectSettings {
    return new ProjectSettings(this.palette, topBar, this.platformBar, this.platformBarText);
  }

  withPlatformBar(platformBar: PlatformBarSettings): ProjectSettings {
    return new ProjectSettings(this.palette, this.topBar, platformBar, this.platformBarText);
  }

  withPlatformBarText(platformBarText: PlatformBarTextSettings): ProjectSettings {
    return new ProjectSettings(this.palette, this.topBar, this.platformBar, platformBarText);
  }

  // Palette entries and their references are scoped to one rule's settings; removing an entry
  // here does not touch any other rule's palette/references. All three surfaces' color
  // references are cleared atomically alongside the entry removal, so storage never sees an
  // intermediate state with a dangling paletteId.
  withPaletteEntryRemoved(id: string): ProjectSettings {
    return new ProjectSettings(
      this.palette.removeEntry(id),
      this.topBar.withColor(this.topBar.color.clearPaletteIf(id)),
      this.platformBar.withColor(this.platformBar.color.clearPaletteIf(id)),
      this.platformBarText.withColor(this.platformBarText.color.clearPaletteIf(id)),
    );
  }
}
