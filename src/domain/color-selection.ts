import { ValueObject } from './base/value-object';
import { type Fill, fillEquals } from './gradient';
import type { PaletteEntryId } from './palette';

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value. `C` is the fill a surface can paint: the bars take any Fill, the platform
// bar text only a Color (CSS `color` cannot take a gradient).
export class ColorSelection<C extends Fill = Fill> extends ValueObject<ColorSelection<C>> {
  constructor(
    readonly paletteId: PaletteEntryId | undefined,
    readonly custom: C,
  ) {
    super();
  }

  equals(other: ColorSelection<C>): boolean {
    // Both set: compare the ids. Otherwise only "both unset" counts as the same reference.
    const samePalette =
      this.paletteId && other.paletteId ? this.paletteId.equals(other.paletteId) : this.paletteId === other.paletteId;
    return samePalette && fillEquals(this.custom, other.custom);
  }

  // Points at a palette entry; the last hand-picked custom fill is kept for the way back.
  setPalette(id: PaletteEntryId): ColorSelection<C> {
    return new ColorSelection(id, this.custom);
  }

  // Picking a custom fill also drops the palette reference — the two are mutually exclusive.
  setCustomColor(color: C): ColorSelection<C> {
    return new ColorSelection(undefined, color);
  }

  // Drops the palette reference, falling back to the kept custom fill. Deciding WHICH
  // selections to clear (e.g. on palette-entry removal) is the caller's policy.
  clearPalette(): ColorSelection<C> {
    return new ColorSelection(undefined, this.custom);
  }
}
