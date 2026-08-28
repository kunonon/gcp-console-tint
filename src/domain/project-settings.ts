import { ValueObject } from './base/value-object';
import { Color } from './color';
import { ColorSelection } from './color-selection';
import { Palette, PaletteEntry, PaletteEntryId } from './palette';

// Product policy, not color theory: the canonical default colors for the tint surfaces. The
// `?? Color.BLACK` branch is unreachable ('#ff6d00' is a valid '#rrggbb' literal) and only
// exists to keep the type as `Color` rather than `Color | undefined`; the settings tests
// assert the real value.
const DEFAULT_COLOR = Color.fromHex('#ff6d00') ?? Color.BLACK;
const DEFAULT_TEXT_COLOR = Color.WHITE;
const DEFAULT_TOP_BAR_HEIGHT = 4;
// The default palette entry's identity, shared by the entry itself and the surfaces that
// reference it (see ProjectSettings.DEFAULT).
const DEFAULT_ENTRY_ID = PaletteEntryId.recreate('default');

export class TopBarSettings extends ValueObject<TopBarSettings> {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    readonly height: number,
    readonly stripes: boolean,
  ) {
    super();
  }

  equals(other: TopBarSettings): boolean {
    return (
      this.enabled === other.enabled &&
      this.color.equals(other.color) &&
      this.height === other.height &&
      this.stripes === other.stripes
    );
  }

  enable(): TopBarSettings {
    return new TopBarSettings(true, this.color, this.height, this.stripes);
  }

  disable(): TopBarSettings {
    return new TopBarSettings(false, this.color, this.height, this.stripes);
  }

  withColor(color: ColorSelection): TopBarSettings {
    return new TopBarSettings(this.enabled, color, this.height, this.stripes);
  }

  withHeight(height: number): TopBarSettings {
    return new TopBarSettings(this.enabled, this.color, height, this.stripes);
  }

  enableStripes(): TopBarSettings {
    return new TopBarSettings(this.enabled, this.color, this.height, true);
  }

  disableStripes(): TopBarSettings {
    return new TopBarSettings(this.enabled, this.color, this.height, false);
  }
}

export class PlatformBarSettings extends ValueObject<PlatformBarSettings> {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    readonly stripes: boolean,
  ) {
    super();
  }

  equals(other: PlatformBarSettings): boolean {
    return this.enabled === other.enabled && this.color.equals(other.color) && this.stripes === other.stripes;
  }

  enable(): PlatformBarSettings {
    return new PlatformBarSettings(true, this.color, this.stripes);
  }

  disable(): PlatformBarSettings {
    return new PlatformBarSettings(false, this.color, this.stripes);
  }

  withColor(color: ColorSelection): PlatformBarSettings {
    return new PlatformBarSettings(this.enabled, color, this.stripes);
  }

  enableStripes(): PlatformBarSettings {
    return new PlatformBarSettings(this.enabled, this.color, true);
  }

  disableStripes(): PlatformBarSettings {
    return new PlatformBarSettings(this.enabled, this.color, false);
  }
}

export class PlatformBarTextSettings extends ValueObject<PlatformBarTextSettings> {
  constructor(
    readonly enabled: boolean,
    readonly color: ColorSelection,
    // Pick black/white automatically by WCAG contrast against the platform bar color.
    readonly auto: boolean,
  ) {
    super();
  }

  equals(other: PlatformBarTextSettings): boolean {
    return this.enabled === other.enabled && this.color.equals(other.color) && this.auto === other.auto;
  }

  enable(): PlatformBarTextSettings {
    return new PlatformBarTextSettings(true, this.color, this.auto);
  }

  disable(): PlatformBarTextSettings {
    return new PlatformBarTextSettings(false, this.color, this.auto);
  }

  withColor(color: ColorSelection): PlatformBarTextSettings {
    return new PlatformBarTextSettings(this.enabled, color, this.auto);
  }

  enableAuto(): PlatformBarTextSettings {
    return new PlatformBarTextSettings(this.enabled, this.color, true);
  }

  disableAuto(): PlatformBarTextSettings {
    return new PlatformBarTextSettings(this.enabled, this.color, false);
  }
}

// One object per tinted surface, mirroring the settings UI's cards.
export class ProjectSettings extends ValueObject<ProjectSettings> {
  // The domain owns the default VALUES; recovering junk storage back to them is the settings
  // repository's job (adapter/out), which sources its `.catch()` fallbacks from here.
  static readonly DEFAULT: ProjectSettings = new ProjectSettings(
    // The palette's own default entries (a single "Primary" swatch). Its id is the stable
    // literal 'default' — not a generated one — because topBar/platformBar's default color
    // selection below references it by that id; Palette.resolve() would fail to resolve it
    // otherwise.
    new Palette(true, [PaletteEntry.recreate(DEFAULT_ENTRY_ID, 'Primary', DEFAULT_COLOR)]),
    new TopBarSettings(true, new ColorSelection(DEFAULT_ENTRY_ID, DEFAULT_COLOR), DEFAULT_TOP_BAR_HEIGHT, false),
    new PlatformBarSettings(true, new ColorSelection(DEFAULT_ENTRY_ID, DEFAULT_COLOR), false),
    new PlatformBarTextSettings(true, new ColorSelection(undefined, DEFAULT_TEXT_COLOR), false),
  );

  constructor(
    readonly palette: Palette,
    readonly topBar: TopBarSettings,
    readonly platformBar: PlatformBarSettings,
    readonly platformBarText: PlatformBarTextSettings,
  ) {
    super();
  }

  equals(other: ProjectSettings): boolean {
    return (
      this.palette.equals(other.palette) &&
      this.topBar.equals(other.topBar) &&
      this.platformBar.equals(other.platformBar) &&
      this.platformBarText.equals(other.platformBarText)
    );
  }

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
  withPaletteEntryRemoved(id: PaletteEntryId): ProjectSettings {
    const withoutRef = (selection: ColorSelection) =>
      selection.paletteId?.equals(id) ? selection.clearPalette() : selection;
    return new ProjectSettings(
      this.palette.removeEntry(id),
      this.topBar.withColor(withoutRef(this.topBar.color)),
      this.platformBar.withColor(withoutRef(this.platformBar.color)),
      this.platformBarText.withColor(withoutRef(this.platformBarText.color)),
    );
  }
}
