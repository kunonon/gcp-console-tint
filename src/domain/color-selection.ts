import { ValueObject } from './base/value-object';
import type { Color } from './color';

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value.
export class ColorSelection extends ValueObject<ColorSelection> {
  constructor(
    readonly paletteId: string | undefined,
    readonly custom: Color,
  ) {
    super();
  }

  equals(other: ColorSelection): boolean {
    return this.paletteId === other.paletteId && this.custom.equals(other.custom);
  }

  // Points at a palette entry; the last hand-picked custom color is kept for the way back.
  setPalette(id: string): ColorSelection {
    return new ColorSelection(id, this.custom);
  }

  // Picking a custom color also drops the palette reference — the two are mutually exclusive.
  setCustomColor(color: Color): ColorSelection {
    return new ColorSelection(undefined, color);
  }

  // Drops the palette reference, falling back to the kept custom color. Deciding WHICH
  // selections to clear (e.g. on palette-entry removal) is the caller's policy.
  clearPalette(): ColorSelection {
    return new ColorSelection(undefined, this.custom);
  }
}
