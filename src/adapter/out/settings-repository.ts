import { Color } from '../../domain/color';
import type { ColorSelection } from '../../domain/color-selection';
import { type Fill, Gradient } from '../../domain/gradient';
import { TintSettings } from '../../domain/tint-settings';
import { SettingsImportError, StoredSettingsError, type StoredSettingsFailure } from '../../port/settings-store';
import { assertNever } from '../../utils/assert';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { type FillFile, readSettingsValue, type SettingsFile } from './settings-file';
import { compareVersions, VersionComparisonResult } from './version';

// The schemaVersion for storage writes and the import ceiling: the running release version,
// floored at CURRENT_SCHEMA_VERSION. The floor is the invariant that matters — data written in the
// current shape must never carry a label older than that shape's schema version, or the
// next load would re-run migration steps against already-migrated data and refuse it (reachable
// if a new migration step ships without the manifest version catching up).
export function effectiveSchemaVersion(currentVersion: string): string {
  return compareVersions(currentVersion, CURRENT_SCHEMA_VERSION) === VersionComparisonResult.Older
    ? CURRENT_SCHEMA_VERSION
    : currentVersion;
}

// Reads what storage holds, strictly: the same checks as the import (readSettingsValue), so a
// stored value is either read whole or refused with the reason and the offending paths, and
// nothing is repaired with a default. Only an absent key (undefined) is legitimately empty: an
// unconfigured install. `currentVersion` is the effective schema version ceiling, as for the
// import. Pure: never writes storage. The background script persists the migrated form once via
// migrateStoredSettings (browser-settings-store.ts).
export function toDomain(stored: unknown, currentVersion: string): TintSettings {
  if (stored === undefined) return new TintSettings([], TintSettings.DEFAULT_THEME);
  try {
    return readSettingsValue(stored, currentVersion);
  } catch (error) {
    if (error instanceof SettingsImportError) {
      // readSettingsValue never refuses with invalid-json or no-rules (only parseSettingsFile
      // does), so the narrowing is sound.
      throw new StoredSettingsError(error.failure as StoredSettingsFailure, stored, { cause: error });
    }
    throw error;
  }
}

// The stored JSON shape. Fills leave the model as { type: 'solid' | 'gradient', ... } objects (see
// storedFill) and the platform bar text's custom color as a '#rrggbb' string; everything else is
// written verbatim — this is the persisted contract, so keep it in sync with the schemas that read
// it back (settings-file.ts; adapter/out/tests/browser-settings-store.test.ts asserts it).
export function toStored(settings: TintSettings, schemaVersion: string): SettingsFile & { schemaVersion: string } {
  return {
    schemaVersion,
    theme: settings.theme,
    projectRules: settings.projectRules.map((rule) => ({
      id: rule.id.toString(),
      matchType: rule.matchType,
      pattern: rule.pattern,
      settings: {
        palette: {
          enabled: rule.settings.palette.enabled,
          entries: rule.settings.palette.entries.map((entry) => ({
            id: entry.id.toString(),
            name: entry.name,
            color: storedFill(entry.color),
          })),
        },
        topBar: {
          enabled: rule.settings.topBar.enabled,
          color: storedSelection(rule.settings.topBar.color),
          height: rule.settings.topBar.height.toPixels(),
          stripes: rule.settings.topBar.stripes,
        },
        platformBar: {
          enabled: rule.settings.platformBar.enabled,
          color: storedSelection(rule.settings.platformBar.color),
          stripes: rule.settings.platformBar.stripes,
        },
        platformBarText: {
          enabled: rule.settings.platformBarText.enabled,
          color: {
            paletteId: rule.settings.platformBarText.color.paletteId?.toString() ?? null,
            custom: rule.settings.platformBarText.color.custom.toHex(),
          },
          auto: rule.settings.platformBarText.auto,
        },
      },
    })),
  };
}

// A solid fill is written as { type: 'solid', color: '#rrggbb' }, a gradient as
// { type: 'gradient', stops: [{ color: '#rrggbb', position }, ...] }, the ends' 0 and 100 included
// so the file explains itself and the import can check them.
function storedFill(fill: Fill): FillFile {
  if (fill instanceof Gradient) {
    return {
      type: 'gradient',
      stops: fill.stops.map((stop) => ({ color: stop.color.toHex(), position: stop.position })),
    };
  }
  if (fill instanceof Color) return { type: 'solid', color: fill.toHex() };
  return assertNever(fill);
}

// The bars' selections. toStored writes the text's selection itself: SettingsFile types its custom as a
// string, which storedFill's FillFile result is not.
function storedSelection(selection: ColorSelection) {
  return { paletteId: selection.paletteId?.toString() ?? null, custom: storedFill(selection.custom) };
}
