import type { TintSettings } from '../domain/tint-settings';
import { assertNever } from '../utils/assert';

// Why an import was refused. The UI turns each reason into a sentence and, when there is an
// underlying error, shows it too so a support request can be diagnosed.
export type SettingsImportFailure =
  | { reason: 'invalid-json' } // the text is not JSON at all
  | { reason: 'not-settings' } // JSON, but not an object carrying a string schemaVersion
  | { reason: 'unsupported-version'; version: string } // schemaVersion below the oldest readable one
  | { reason: 'no-rules' }; // a settings file, but with no readable rule

function importFailureMessage(failure: SettingsImportFailure): string {
  switch (failure.reason) {
    case 'invalid-json':
      return 'Not valid JSON';
    case 'not-settings':
      return 'Not a GCP Console Tint settings file';
    case 'unsupported-version':
      return `Settings file version ${failure.version} is not supported`;
    case 'no-rules':
      return 'No rules found in the file';
    default:
      return assertNever(failure);
  }
}

export class SettingsImportError extends Error {
  constructor(
    readonly failure: SettingsImportFailure,
    options?: { cause?: unknown },
  ) {
    super(importFailureMessage(failure), options);
    this.name = 'SettingsImportError';
  }
}

// Driven-side port: the persistence boundary for TintSettings. The browser.storage
// implementation lives in adapter/out; driving adapters (side panel, content script)
// depend on this interface instead of the storage API.
export interface SettingsStore {
  // Reads whatever is stored and returns it folded to the current schema shape
  // (in-memory migration; never writes).
  load(): Promise<TintSettings>;
  // Stamps the effective schema version and persists asynchronously (fire-and-forget).
  save(settings: TintSettings): void;
  // Invokes onChange with current-shape settings whenever the stored value changes.
  // Deletions are ignored. Listeners live for the lifetime of the context.
  watch(onChange: (settings: TintSettings) => void): void;
  // Serializes settings in the stored JSON shape, stamped with the effective schema version and
  // pretty-printed (2-space) — the export file format. importJson reads it back, and because it
  // is the stored shape, load()'s migration chain will read it in any later release too.
  exportJson(settings: TintSettings): string;
  // Parses text written by exportJson (or the stored shape of any past release) into
  // current-shape settings. Throws SettingsImportError instead of silently returning defaults:
  // the caller shows the reason (and the underlying error) to the user.
  importJson(text: string): TintSettings;
}
