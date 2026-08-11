import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { TintSettings } from '../../../types';
import { DEFAULT_SETTINGS, effectiveSchemaVersion, loadSettings } from '../../../utils/settings';

// Owns the side panel's settings state and its persistence: reads (and in-memory migrates)
// the stored settings once on mount, and writes every change back to storage via save().
export function useTintSettings() {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    const currentVersion = browser.runtime.getManifest().version;
    browser.storage.local.get('tintSettings').then((result) => {
      setSettings(loadSettings(result.tintSettings, currentVersion));
    });
  }, []);

  const save = (next: TintSettings) => {
    // Floor at CURRENT_SCHEMA_VERSION (see effectiveSchemaVersion): stamping the raw manifest
    // version here could label current-shape nested data with an older schemaVersion, causing
    // the next load to re-run the flat->nested migration against already-nested data and
    // silently reset the user's values to defaults.
    const stamped: TintSettings = {
      ...next,
      schemaVersion: effectiveSchemaVersion(browser.runtime.getManifest().version),
    };
    setSettings(stamped);
    browser.storage.local.set({ tintSettings: stamped });
  };

  return { settings, save };
}
