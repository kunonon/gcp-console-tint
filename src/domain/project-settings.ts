import { z } from 'zod';
import { Color } from './color';
import { type ColorSelection, colorSelectionSchema } from './color-selection';
import { type Palette, PaletteEntry, paletteSchema } from './palette';

// Product policy, not color theory: the canonical default colors for the tint surfaces. The
// `?? Color.BLACK` branch is unreachable ('#ff6d00' is a valid '#rrggbb' literal) and only
// exists to keep the type non-null; the settings tests assert the real value.
const DEFAULT_COLOR = Color.parse('#ff6d00') ?? Color.BLACK;
const DEFAULT_TEXT_COLOR = Color.WHITE;
const DEFAULT_TOP_BAR_HEIGHT = 4;

// The palette's own default entries (a single "Primary" swatch). Its id is the stable literal
// 'default' — not a generated one — because topBar/platformBar's default color selection
// (below) references it by that id; Palette.resolve() would fail to resolve it otherwise.
// Returns a fresh array on every call so callers never share mutable state.
function defaultPaletteEntries(): PaletteEntry[] {
  return [new PaletteEntry('default', 'Primary', DEFAULT_COLOR)];
}

const PaletteSchema = paletteSchema({ entries: defaultPaletteEntries, entryColor: DEFAULT_COLOR });

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

const TopBarObjectSchema = z
  .object({
    enabled: z.boolean().catch(true),
    color: colorSelectionSchema({ paletteId: 'default', custom: DEFAULT_COLOR }),
    height: z.number().catch(DEFAULT_TOP_BAR_HEIGHT),
    stripes: z.boolean().catch(false),
  })
  .transform((value) => new TopBarSettings(value.enabled, value.color, value.height, value.stripes));
const TopBarSchema = TopBarObjectSchema.catch(() => TopBarObjectSchema.parse({}));

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

const PlatformBarObjectSchema = z
  .object({
    enabled: z.boolean().catch(true),
    color: colorSelectionSchema({ paletteId: 'default', custom: DEFAULT_COLOR }),
    stripes: z.boolean().catch(false),
  })
  .transform((value) => new PlatformBarSettings(value.enabled, value.color, value.stripes));
const PlatformBarSchema = PlatformBarObjectSchema.catch(() => PlatformBarObjectSchema.parse({}));

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

const PlatformBarTextObjectSchema = z
  .object({
    enabled: z.boolean().catch(true),
    color: colorSelectionSchema({ paletteId: null, custom: DEFAULT_TEXT_COLOR }),
    auto: z.boolean().catch(false),
  })
  .transform((value) => new PlatformBarTextSettings(value.enabled, value.color, value.auto));
const PlatformBarTextSchema = PlatformBarTextObjectSchema.catch(() => PlatformBarTextObjectSchema.parse({}));

// One object per tinted surface, mirroring the settings UI's cards.
export class ProjectSettings {
  // The schemas stay the single source of defaults: every section's own `.catch()` produces
  // its default, exactly as it does when reading partial data from storage.
  static readonly DEFAULT: ProjectSettings = new ProjectSettings(
    PaletteSchema.parse({}),
    TopBarSchema.parse({}),
    PlatformBarSchema.parse({}),
    PlatformBarTextSchema.parse({}),
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
      this.topBar.withColor(this.topBar.color.withClearedRefIf(id)),
      this.platformBar.withColor(this.platformBar.color.withClearedRefIf(id)),
      this.platformBarText.withColor(this.platformBarText.color.withClearedRefIf(id)),
    );
  }
}

/** @internal — domain modules only */
export const ProjectSettingsSchema = z
  .object({
    palette: PaletteSchema,
    topBar: TopBarSchema,
    platformBar: PlatformBarSchema,
    platformBarText: PlatformBarTextSchema,
  })
  .transform((value) => new ProjectSettings(value.palette, value.topBar, value.platformBar, value.platformBarText))
  // Sharing the immutable DEFAULT instance is safe: nothing in the model mutates in place.
  .catch(() => ProjectSettings.DEFAULT);
