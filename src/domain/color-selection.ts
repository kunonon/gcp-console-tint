import { z } from 'zod';
import { Color } from './color';

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

// Parameterized by defaults because each surface falls back to a different selection: topBar
// and platformBar point at the default palette entry, while platformBarText has no palette
// reference and falls back to a plain custom color instead.
/** @internal — domain modules only */
export function colorSelectionSchema(defaults: { paletteId: string | null; custom: Color }) {
  return z
    .object({
      paletteId: z.string().nullable().catch(defaults.paletteId),
      // Anything that is not a '#rrggbb' string recovers to the surface's default color, the
      // same per-field policy `.catch()` gives the other fields.
      custom: z
        .unknown()
        .optional()
        .transform((value) => (typeof value === 'string' ? Color.parse(value) : null) ?? defaults.custom),
    })
    .transform((value) => new ColorSelection(value.paletteId, value.custom))
    .catch(() => new ColorSelection(defaults.paletteId, defaults.custom));
}
