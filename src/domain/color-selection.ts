import type { Color } from './color';

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value.
export class ColorSelection {
  constructor(
    readonly paletteId: string | null,
    readonly custom: Color,
  ) {}

  // Points at a palette entry; the last hand-picked custom color is kept for the way back.
  withPaletteRef(id: string): ColorSelection {
    return new ColorSelection(id, this.custom);
  }

  // Picking a custom color also drops the palette reference — the two are mutually exclusive.
  withCustom(color: Color): ColorSelection {
    return new ColorSelection(null, color);
  }

  // Drops a reference to `id` (used when that palette entry is removed); unrelated selections
  // are returned as-is.
  withClearedRefIf(id: string): ColorSelection {
    return this.paletteId === id ? new ColorSelection(null, this.custom) : this;
  }
}
