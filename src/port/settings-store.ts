import type { TintSettings } from '../domain/tint-settings';

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
}
