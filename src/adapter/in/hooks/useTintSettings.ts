import { useEffect, useState } from 'react';
import type { TintSettings } from '../../../types';
import { DEFAULT_SETTINGS } from '../../../utils/settings';
import { settingsStore } from '../../out/browser-settings-store';

// Owns the side panel's settings state and its persistence via the SettingsStore port.
export function useTintSettings() {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    settingsStore.load().then(setSettings);
  }, []);

  // save() returns the stamped value; reflecting it into state keeps the UI in sync
  // with exactly what will be persisted.
  const save = (next: TintSettings) => {
    setSettings(settingsStore.save(next));
  };

  return { settings, save };
}
