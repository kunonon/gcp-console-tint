import { useEffect, useState } from 'react';
import type { SettingsStore } from '../../../port/settings-store';
import type { TintSettings } from '../../../types';
import { DEFAULT_SETTINGS } from '../../../utils/settings';

// Owns the side panel's settings state and its persistence via the injected SettingsStore
// port. The store instance comes from the composition root (main.tsx) through App's props.
export function useTintSettings(settingsStore: SettingsStore) {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    settingsStore.load().then(setSettings);
  }, [settingsStore]);

  // save() returns the stamped value; reflecting it into state keeps the UI in sync
  // with exactly what will be persisted.
  const save = (next: TintSettings) => {
    setSettings(settingsStore.save(next));
  };

  return { settings, save };
}
