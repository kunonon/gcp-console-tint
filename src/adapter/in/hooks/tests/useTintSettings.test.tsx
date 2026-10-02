import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRule } from '../../../../domain/project-rule';
import { TintSettings } from '../../../../domain/tint-settings';
import type { SettingsStore } from '../../../../port/settings-store';
import { useTintSettings } from '../useTintSettings';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const noSettings = () => new TintSettings([]);
const withRule = (pattern: string) => new TintSettings([ProjectRule.create('exact', pattern)]);

function makeStore(overrides: Partial<SettingsStore> = {}): SettingsStore {
  return {
    load: async () => noSettings(),
    save: async () => {},
    watch: () => {},
    exportJson: () => '{}',
    importJson: () => noSettings(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useTintSettings', () => {
  it('reports loading until load resolves, then reports ready', async () => {
    const load = deferred<TintSettings>();
    const loaded = withRule('loaded');
    const store = makeStore({ load: () => load.promise });
    const { result } = renderHook(() => useTintSettings(store));

    expect(result.current.status).toBe('loading');
    await act(async () => {
      load.resolve(loaded);
      await load.promise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toBe(loaded);
  });

  it('reports a load failure and logs its cause', async () => {
    const load = deferred<TintSettings>();
    const error = new Error('storage unavailable');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore({ load: () => load.promise });
    const { result } = renderHook(() => useTintSettings(store));

    await act(async () => {
      load.reject(error);
      await load.promise.catch(() => {});
    });

    expect(result.current.status).toBe('failed');
    expect(log).toHaveBeenCalledWith('[gcp-console-tint] settings load failed', error);
  });

  it('ignores a stale load after the settings store changes', async () => {
    const staleLoad = deferred<TintSettings>();
    const activeLoad = deferred<TintSettings>();
    const active = withRule('active');
    const staleLoadFn = vi.fn(() => staleLoad.promise);
    const activeLoadFn = vi.fn(() => activeLoad.promise);
    const staleStore = makeStore({ load: staleLoadFn });
    const activeStore = makeStore({ load: activeLoadFn });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(({ store }: { store: SettingsStore }) => useTintSettings(store), {
      initialProps: { store: staleStore },
    });

    expect(staleLoadFn).toHaveBeenCalledTimes(1);
    rerender({ store: activeStore });
    expect(activeLoadFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      activeLoad.resolve(active);
      await activeLoad.promise;
    });
    await act(async () => {
      staleLoad.resolve(withRule('stale'));
      await staleLoad.promise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toBe(active);
    expect(log).not.toHaveBeenCalled();
  });

  it('ignores the first load when StrictMode replays the mount effect', async () => {
    const firstLoad = deferred<TintSettings>();
    const secondLoad = deferred<TintSettings>();
    const load = vi.fn().mockReturnValueOnce(firstLoad.promise).mockReturnValueOnce(secondLoad.promise);
    const store = makeStore({ load });
    const active = withRule('second load');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useTintSettings(store), { reactStrictMode: true });

    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('loading');

    await act(async () => {
      secondLoad.resolve(active);
      await secondLoad.promise;
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toBe(active);

    await act(async () => {
      firstLoad.resolve(withRule('stale first load'));
      await firstLoad.promise;
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.settings).toBe(active);
    expect(log).not.toHaveBeenCalled();
  });

  it('waits for an ordinary save before persisting and applying an import', async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const writes = [firstWrite, secondWrite];
    const save = vi.fn((_settings: TintSettings) => writes.shift()!.promise);
    const store = makeStore({ save });
    const { result } = renderHook(() => useTintSettings(store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const edit = withRule('edit');
    const imported = withRule('imported');
    act(() => result.current.save(edit));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    let importSave!: Promise<void>;
    act(() => {
      importSave = result.current.saveThenApply(imported);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.settings).toBe(edit);

    await act(async () => {
      firstWrite.resolve(undefined);
      await firstWrite.promise;
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(result.current.settings).toBe(edit);

    await act(async () => {
      secondWrite.resolve(undefined);
      await importSave;
    });
    expect(result.current.settings).toBe(imported);
  });

  it('does not apply a failed import and allows a later import to retry', async () => {
    const ordinaryWrite = deferred<void>();
    const failedImportWrite = deferred<void>();
    const retryWrite = deferred<void>();
    const writes = [ordinaryWrite, failedImportWrite, retryWrite];
    const save = vi.fn((_settings: TintSettings) => writes.shift()!.promise);
    const store = makeStore({ save });
    const { result } = renderHook(() => useTintSettings(store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const edit = withRule('edit');
    act(() => result.current.save(edit));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    let failedImport!: Promise<void>;
    act(() => {
      failedImport = result.current.saveThenApply(withRule('failed import'));
    });
    await act(async () => {
      ordinaryWrite.resolve(undefined);
      await ordinaryWrite.promise;
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    const error = new Error('write failed');
    await act(async () => {
      failedImportWrite.reject(error);
      await expect(failedImport).rejects.toBe(error);
    });
    expect(result.current.settings).toBe(edit);

    let retry!: Promise<void>;
    const imported = withRule('retry');
    act(() => {
      retry = result.current.saveThenApply(imported);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(result.current.settings).toBe(edit);
    await act(async () => {
      retryWrite.resolve(undefined);
      await retry;
    });
    expect(result.current.settings).toBe(imported);
  });

  it('catches ordinary save rejection while keeping the optimistic settings', async () => {
    const write = deferred<void>();
    const save = vi.fn((_settings: TintSettings) => write.promise);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore({ save });
    const { result } = renderHook(() => useTintSettings(store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const next = withRule('optimistic');
    act(() => result.current.save(next));
    expect(result.current.settings).toBe(next);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const error = new Error('write failed');
    await act(async () => {
      write.reject(error);
      await write.promise.catch(() => {});
    });

    expect(result.current.settings).toBe(next);
    expect(log).toHaveBeenCalledWith('[gcp-console-tint] settings save failed', error);
  });

  it('returns synchronous save failures as rejections and recovers the queue for retry', async () => {
    const error = new Error('synchronous failure');
    const save = vi.fn((_settings: TintSettings): Promise<void> => {
      if (save.mock.calls.length === 1) throw error;
      return Promise.resolve();
    });
    const store = makeStore({ save });
    const { result } = renderHook(() => useTintSettings(store));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const failed = withRule('failed');
    let firstAttempt!: Promise<void>;
    act(() => {
      firstAttempt = result.current.saveThenApply(failed);
    });
    await act(async () => {
      await expect(firstAttempt).rejects.toBe(error);
    });
    expect(result.current.settings.projectRules).toHaveLength(0);

    const retry = withRule('retry');
    let retryAttempt!: Promise<void>;
    act(() => {
      retryAttempt = result.current.saveThenApply(retry);
    });
    await act(async () => {
      await retryAttempt;
    });
    expect(result.current.settings).toBe(retry);
  });
});
