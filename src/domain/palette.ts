// Palette: a project's named color entries plus the enabled flag.
import { z } from 'zod';
import { Color } from './color';
import type { ColorSelection } from './color-selection';

export class PaletteEntry {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly color: Color,
  ) {}

  static create(name: string, color: Color): PaletteEntry {
    return new PaletteEntry(crypto.randomUUID(), name, color);
  }

  withName(name: string): PaletteEntry {
    return new PaletteEntry(this.id, name, this.color);
  }

  withColor(color: Color): PaletteEntry {
    return new PaletteEntry(this.id, this.name, color);
  }
}

export class Palette {
  constructor(
    readonly enabled: boolean,
    readonly entries: readonly PaletteEntry[],
  ) {}

  // Resolves a surface's effective color: the referenced palette entry when the palette is
  // enabled and the reference resolves, otherwise the surface's own custom color.
  resolve(selection: ColorSelection): Color {
    if (this.enabled && selection.paletteId) {
      const entry = this.entries.find((e) => e.id === selection.paletteId);
      if (entry) return entry.color;
    }
    return selection.custom;
  }

  withEnabled(enabled: boolean): Palette {
    return new Palette(enabled, this.entries);
  }

  addEntry(entry: PaletteEntry): Palette {
    return new Palette(this.enabled, [...this.entries, entry]);
  }

  renameEntry(id: string, name: string): Palette {
    return this.mapEntries(id, (entry) => entry.withName(name));
  }

  recolorEntry(id: string, color: Color): Palette {
    return this.mapEntries(id, (entry) => entry.withColor(color));
  }

  // Removal only: clearing the surfaces' now-dangling references is ProjectSettings' job (see
  // ProjectSettings.withPaletteEntryRemoved), since a Palette cannot see them.
  removeEntry(id: string): Palette {
    return new Palette(
      this.enabled,
      this.entries.filter((entry) => entry.id !== id),
    );
  }

  private mapEntries(id: string, update: (entry: PaletteEntry) => PaletteEntry): Palette {
    return new Palette(
      this.enabled,
      this.entries.map((entry) => (entry.id === id ? update(entry) : entry)),
    );
  }
}

// Parameterized by injected defaults: which entries a palette falls back to (and which color a
// junk entry color falls back to) is product policy and lives in project-settings.ts.
/** @internal — domain modules only */
export function paletteSchema(defaults: { entries: () => PaletteEntry[]; entryColor: Color }) {
  const entrySchema = z
    .object({
      id: z.string().catch(() => crypto.randomUUID()),
      name: z.string().catch(''),
      color: z
        .unknown()
        .optional()
        .transform((value) => (typeof value === 'string' ? Color.parse(value) : null) ?? defaults.entryColor),
    })
    .transform((value) => new PaletteEntry(value.id, value.name, value.color));

  // Parses `value` as a PaletteEntry[]: a non-array value (missing or junk) falls back to the
  // default entries wholesale, otherwise each element is parsed independently and invalid
  // elements are dropped (not substituted) so one bad entry can't nuke its valid siblings.
  const parseEntries = (value: unknown): PaletteEntry[] => {
    if (!Array.isArray(value)) return defaults.entries();
    return value.reduce<PaletteEntry[]>((kept, item) => {
      const parsed = entrySchema.safeParse(item);
      if (parsed.success) kept.push(parsed.data);
      return kept;
    }, []);
  };

  const objectSchema = z
    .object({
      enabled: z.boolean().catch(true),
      // `.optional()` is required (not just cosmetic) even though parseEntries already handles
      // `undefined`: without it, Zod treats an entirely-absent `entries` key as an error
      // ("expected nonoptional") before the transform ever runs, regardless of what the
      // transform itself would accept.
      entries: z.unknown().optional().transform(parseEntries),
    })
    .transform((value) => new Palette(value.enabled, value.entries));

  return objectSchema.catch(() => objectSchema.parse({}));
}
