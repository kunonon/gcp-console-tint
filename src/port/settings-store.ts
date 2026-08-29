import type { TintSettings } from '../domain/tint-settings';
import { assertNever } from '../utils/assert';

// One field an imported file got wrong: where it sits (`projectRules[1].settings.topBar.height`)
// and why it was refused. The UI lists these so the user can fix the file.
export interface SettingsImportIssue {
  path: string;
  message: string;
}

// Why an import was refused. Import is strict — nothing is ever repaired with a default — so a
// file is either taken whole or refused with a reason. The UI turns each reason into a sentence
// and, when there is an underlying error or a list of bad fields, shows that too so the user
// knows what to fix and a support request can be diagnosed.
export type SettingsImportFailure =
  | { reason: 'invalid-json' } // the text is not JSON at all
  | { reason: 'not-settings' } // JSON, but not an object carrying a string schemaVersion
  | { reason: 'unsupported-version'; version: string } // schemaVersion below the oldest readable one
  | { reason: 'newer-version'; version: string } // schemaVersion above what this build can have written: a later release's file
  // a settings file whose fields are missing, wrongly typed, or hold unusable values
  | { reason: 'invalid-fields'; issues: readonly SettingsImportIssue[] }
  | { reason: 'no-rules' }; // a settings file, but with no rule in it

function importFailureMessage(failure: SettingsImportFailure): string {
  switch (failure.reason) {
    case 'invalid-json':
      return 'Not valid JSON';
    case 'not-settings':
      return 'Not a GCP Console Tint settings file';
    case 'unsupported-version':
      return `Settings file version ${failure.version} is not supported`;
    case 'newer-version':
      return `Settings file version ${failure.version} is newer than this extension`;
    case 'invalid-fields':
      return `Missing or invalid fields (${failure.issues.length})`;
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
  // current-shape settings. Strict, unlike load(): every field the export writes must be present
  // with the right JSON type (checked by the adapter) and hold a value the domain accepts
  // (checked by the domain's own factories) — nothing is repaired with a default. Throws
  // SettingsImportError instead of silently returning defaults, so the caller can show the user
  // the reason, and for a field-level refusal which fields were wrong.
  importJson(text: string): TintSettings;
}
