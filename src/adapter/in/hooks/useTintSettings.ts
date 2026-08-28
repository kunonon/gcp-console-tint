import { useEffect, useState } from 'react';
import { TintSettings } from '../../../domain/tint-settings';
import type { SettingsStore } from '../../../port/settings-store';

// Owns the side panel's settings state and its persistence via the injected SettingsStore
// port. The store instance comes from the composition root (main.tsx) through App's props.
export function useTintSettings(settingsStore: SettingsStore) {
  // No rules until the store's load() resolves.
  const [settings, setSettings] = useState<TintSettings>(() => new TintSettings([]));

  useEffect(() => {
    settingsStore.load().then(setSettings);
  }, [settingsStore]);

  // The persisted schema version is the store's business; local state holds the same
  // domain value that was handed to save().
  const save = (next: TintSettings) => {
    setSettings(next);
    settingsStore.save(next);
  };

  return { settings, save };
}
