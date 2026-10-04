import { useEffect, useRef, useState } from 'react';
import { TintSettings } from '../../../domain/tint-settings';
import type { SettingsStore } from '../../../port/settings-store';

// Owns the side panel's settings state and its persistence via the injected SettingsStore
// port. The store instance comes from the composition root (main.tsx) through App's props.
export function useTintSettings(settingsStore: SettingsStore) {
  // No rules until the store's load() resolves.
  const [settings, setSettings] = useState<TintSettings>(() => new TintSettings([]));
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const saveTail = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    settingsStore
      .load()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus('failed');
        console.error('[gcp-console-tint] settings load failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [settingsStore]);

  // The persisted schema version is the store's business; local state holds the same
  // domain value that was handed to save().
  const enqueueSave = (next: TintSettings, applyAfterSave = false): Promise<void> => {
    const result = saveTail.current.then(async () => {
      await settingsStore.save(next);
      if (applyAfterSave) setSettings(next);
    });
    saveTail.current = result.catch(() => undefined);
    return result;
  };

  const save = (next: TintSettings) => {
    setSettings(next);
    void enqueueSave(next).catch((error) => console.error('[gcp-console-tint] settings save failed', error));
  };

  const saveThenApply = (next: TintSettings) => enqueueSave(next, true);

  // Reads what is persisted once every save queued before this call has settled (a failed one
  // included, as the queue itself carries on past failures). Read-only: it neither joins the save
  // queue, so later saves are not held up behind it, nor touches settings/status — after a failed
  // optimistic save the stored value can differ from what the panel shows, and only the caller
  // decides what to do with that.
  const loadSaved = () => {
    const tail = saveTail.current;
    return tail.then(() => settingsStore.load());
  };

  return { settings, status, save, saveThenApply, loadSaved };
}
