// Palette: a project's named color entries plus the enabled flag.
import { z } from 'zod';
import { DEFAULT_COLOR, HexColorSchema } from './color';

export const PaletteEntrySchema = z.object({
  id: z.string().catch(() => crypto.randomUUID()),
  name: z.string().catch(''),
  color: HexColorSchema.catch(DEFAULT_COLOR),
});
export type PaletteEntry = z.infer<typeof PaletteEntrySchema>;

// The palette's own default entries (a single "Primary" swatch). Its id is the stable literal
// 'default' — not a generated one — because topBar/platformBar's default color selection
// (below) references it by that id; resolveSelectedColor() would fail to resolve it otherwise.
// Returns a fresh array/object on every call so callers never share mutable state.
function defaultPaletteEntries(): PaletteEntry[] {
  return [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }];
}

// Parses `value` as a PaletteEntry[]: a non-array value (missing or junk) falls back to the
// default entries wholesale, otherwise each element is parsed independently and invalid
// elements are dropped (not substituted) so one bad entry can't nuke its valid siblings.
function parsePaletteEntries(value: unknown): PaletteEntry[] {
  if (!Array.isArray(value)) return defaultPaletteEntries();
  return value.reduce<PaletteEntry[]>((kept, item) => {
    const parsed = PaletteEntrySchema.safeParse(item);
    if (parsed.success) kept.push(parsed.data);
    return kept;
  }, []);
}

const PaletteSettingsObjectSchema = z.object({
  enabled: z.boolean().catch(true),
  // `.optional()` is required (not just cosmetic) even though parsePaletteEntries already
  // handles `undefined`: without it, Zod treats an entirely-absent `entries` key as an error
  // ("expected nonoptional") before the transform ever runs, regardless of what the transform
  // itself would accept.
  entries: z.unknown().optional().transform(parsePaletteEntries),
});
export const PaletteSettingsSchema = PaletteSettingsObjectSchema.catch(() => PaletteSettingsObjectSchema.parse({}));
export type PaletteSettings = z.infer<typeof PaletteSettingsSchema>;
