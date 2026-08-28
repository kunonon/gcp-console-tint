// Palette: a project's named color entries plus the enabled flag.
import { Entity } from './base/entity';
import { ValueObject } from './base/value-object';
import type { Color } from './color';
import type { ColorSelection } from './color-selection';

export class PaletteEntry extends Entity<PaletteEntry> {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly color: Color,
  ) {
    super();
  }

  // Entity identity: same id means the same entry, whatever its current attributes.
  equals(other: PaletteEntry): boolean {
    return this.id === other.id;
  }

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

export class Palette extends ValueObject<Palette> {
  constructor(
    readonly enabled: boolean,
    readonly entries: readonly PaletteEntry[],
  ) {
    super();
  }

  // Entries are compared as entities (by id, in order): two palettes are equal when they hold
  // the same entries in the same order, regardless of the entries' current name/color.
  equals(other: Palette): boolean {
    return (
      this.enabled === other.enabled &&
      this.entries.length === other.entries.length &&
      this.entries.every((entry, i) => {
        const otherEntry = other.entries[i];
        return otherEntry !== undefined && entry.equals(otherEntry);
      })
    );
  }

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
