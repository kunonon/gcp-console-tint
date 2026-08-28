// Palette: a project's named color entries plus the enabled flag.
import { Entity } from './base/entity';
import { ValueObject } from './base/value-object';
import type { Color } from './color';
import type { ColorSelection } from './color-selection';

// Identity of a PaletteEntry. The raw string is private so this type stays nominally distinct
// from other ids; only the boundaries (settings repository, React keys) read it via toString().
export class PaletteEntryId extends ValueObject<PaletteEntryId> {
  private constructor(private readonly value: string) {
    super();
  }

  // A brand-new identity.
  static create(): PaletteEntryId {
    return new PaletteEntryId(crypto.randomUUID());
  }

  // Rehydrates an existing identity (from storage or the UI). Ids carry no format invariant:
  // the default entry's id is the literal 'default'.
  static recreate(value: string): PaletteEntryId {
    return new PaletteEntryId(value);
  }

  equals(other: PaletteEntryId): boolean {
    return this.value === other.value;
  }

  override toString(): string {
    return this.value;
  }
}

export class PaletteEntry extends Entity<PaletteEntry> {
  private constructor(
    readonly id: PaletteEntryId,
    readonly name: string,
    readonly color: Color,
  ) {
    super();
  }

  // Entity identity: same id means the same entry, whatever its current attributes.
  equals(other: PaletteEntry): boolean {
    return this.id.equals(other.id);
  }

  // A brand-new entry under a fresh identity.
  static create(name: string, color: Color): PaletteEntry {
    return new PaletteEntry(PaletteEntryId.create(), name, color);
  }

  // Rebuilds an entry under an existing identity: persisted entries (settings repository) and
  // the default entry with its literal id (ProjectSettings.DEFAULT).
  static recreate(id: PaletteEntryId, name: string, color: Color): PaletteEntry {
    return new PaletteEntry(id, name, color);
  }

  rename(name: string): PaletteEntry {
    return new PaletteEntry(this.id, name, this.color);
  }

  changeColor(color: Color): PaletteEntry {
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
    // Hoisted: TypeScript does not keep the property narrowing inside the find() callback.
    const paletteId = selection.paletteId;
    if (this.enabled && paletteId) {
      const entry = this.entries.find((e) => e.id.equals(paletteId));
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

  renameEntry(id: PaletteEntryId, name: string): Palette {
    return this.mapEntries(id, (entry) => entry.rename(name));
  }

  changeEntryColor(id: PaletteEntryId, color: Color): Palette {
    return this.mapEntries(id, (entry) => entry.changeColor(color));
  }

  // Removal only: clearing the surfaces' now-dangling references is ProjectSettings' job (see
  // ProjectSettings.withPaletteEntryRemoved), since a Palette cannot see them.
  removeEntry(id: PaletteEntryId): Palette {
    return new Palette(
      this.enabled,
      this.entries.filter((entry) => !entry.id.equals(id)),
    );
  }

  private mapEntries(id: PaletteEntryId, update: (entry: PaletteEntry) => PaletteEntry): Palette {
    return new Palette(
      this.enabled,
      this.entries.map((entry) => (entry.id.equals(id) ? update(entry) : entry)),
    );
  }
}
