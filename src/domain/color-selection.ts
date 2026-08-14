import { z } from 'zod';
import { DEFAULT_COLOR, type HexColor, HexColorSchema } from './color';
import type { PaletteSettings } from './palette';

// A color choice shared by every tinted surface: the palette entry wins while paletteId is
// set (and the project's palette is enabled), otherwise `custom` applies. `custom` is kept
// even while a palette entry is selected, so switching back to custom restores the last
// hand-picked value.
//
// Parameterized by defaults because each surface falls back to a different selection: topBar
// and platformBar point at the default palette entry, while platformBarText has no palette
// reference and falls back to a plain custom color instead.
export function colorSelectionSchema(defaults: { paletteId: string | null; custom: HexColor }) {
  return z
    .object({
      paletteId: z.string().nullable().catch(defaults.paletteId),
      custom: HexColorSchema.catch(defaults.custom),
    })
    .catch(() => ({ ...defaults }));
}
export const ColorSelectionSchema = colorSelectionSchema({ paletteId: null, custom: DEFAULT_COLOR });
export type ColorSelection = z.infer<typeof ColorSelectionSchema>;

// Resolves a surface's effective color: the referenced palette entry when the palette is
// enabled and the reference resolves, otherwise the surface's own custom color.
export function resolveSelectedColor(palette: PaletteSettings, selection: ColorSelection): HexColor {
  if (palette.enabled && selection.paletteId) {
    const entry = palette.entries.find((e) => e.id === selection.paletteId);
    if (entry) return entry.color;
  }
  return selection.custom;
}
