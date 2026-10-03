import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRule } from '../../../../../../domain/project-rule';
import { TintSettings } from '../../../../../../domain/tint-settings';
import type { SettingsStore } from '../../../../../../port/settings-store';
import BackupCard, { type Notice, type NoticeInput } from '../BackupCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createStore(): SettingsStore {
  return {
    load: async () => new TintSettings([]),
    save: async () => {},
    watch: () => {},
    exportJson: () => '',
    importJson: (text) => new TintSettings([ProjectRule.create('exact', text)]),
  };
}

const noRules = new TintSettings([]);

// Stands in for App, which owns the notice (and numbers it) so it outlives the card; `mounted`
// plays the part of the Settings tab being picked or left.
function Harness({
  store,
  mounted = true,
  onImport = async () => ({ added: 0, replaced: 0 }),
  onNotice,
}: {
  store: SettingsStore;
  mounted?: boolean;
  onImport?: (selected: readonly ProjectRule[]) => Promise<{ added: number; replaced: number }>;
  onNotice?: (input: NoticeInput) => void;
}) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const nextId = useRef(0);
  if (!mounted) return null;
  return (
    <BackupCard
      settingsStore={store}
      settings={noRules}
      loadSaved={() => store.load()}
      onImport={onImport}
      notice={notice}
      onNotice={(input: NoticeInput) => {
        onNotice?.(input);
        nextId.current += 1;
        setNotice({ ...input, id: nextId.current });
      }}
      onClearNotice={() => setNotice(null)}
    />
  );
}

function upload(fileName: string, text: () => Promise<string>) {
  const input = screen.getByLabelText('Import settings file') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: fileName, text }] });
  fireEvent.change(input);
  return input;
}

describe('BackupCard file reads', () => {
  it('keeps the latest file when an earlier slow read finishes afterward', async () => {
    const store = createStore();
    let resolveFirst!: (text: string) => void;
    let resolveSecond!: (text: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    const importJson = vi.spyOn(store, 'importJson');
    render(<Harness store={store} />);

    const input = upload('first.json', () => first);
    expect(input.value).toBe('');
    upload('second.json', () => second);

    await act(async () => {
      resolveSecond('second rule');
      await second;
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('second.json')).toBeTruthy();

    await act(async () => {
      resolveFirst('first rule');
      await first;
    });
    expect(within(screen.getByRole('dialog')).getByText('second.json')).toBeTruthy();
    expect(importJson).toHaveBeenCalledTimes(1);
    expect(importJson).toHaveBeenCalledWith('second rule');
  });

  it('ignores an earlier read rejection after a later file has opened', async () => {
    const store = createStore();
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (text: string) => void;
    const first = new Promise<string>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const observedFirstRejection = first.catch(() => undefined);
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness store={store} />);

    upload('first.json', () => first);
    upload('second.json', () => second);
    await act(async () => {
      resolveSecond('second rule');
      await second;
    });
    const dialog = await screen.findByRole('dialog');

    await act(async () => {
      rejectFirst(new Error('old file disappeared'));
      await observedFirstRejection;
    });
    expect(within(dialog).getByText('second.json')).toBeTruthy();
    expect(screen.queryByText('Couldn’t import this file')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('refuses a file picked in the same tick as an accepted Export', async () => {
    const store = createStore();
    let release!: (settings: TintSettings) => void;
    vi.spyOn(store, 'load').mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const importJson = vi.spyOn(store, 'importJson');
    render(<Harness store={store} />);
    const text = vi.fn(async () => 'x');
    let input!: HTMLInputElement;
    // Export has not re-rendered yet, so the input is still enabled: only the handler's own check
    // can refuse the file.
    act(() => {
      screen.getByRole('button', { name: 'Export' }).click();
      input = upload('a.json', text);
    });
    expect(text).not.toHaveBeenCalled();
    expect(importJson).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    await act(async () => {
      release(noRules);
    });
  });
});

describe('BackupCard notices', () => {
  const failure: NoticeInput = {
    tone: 'danger',
    title: 'Couldn’t import this file',
    description: 'x.json could not be read.',
  };

  function renderCard(notice: Notice | null) {
    const store = createStore();
    const card = (next: Notice | null) => (
      <BackupCard
        settingsStore={store}
        settings={noRules}
        loadSaved={() => store.load()}
        onImport={async () => ({ added: 0, replaced: 0 })}
        notice={next}
        onNotice={() => {}}
        onClearNotice={() => {}}
      />
    );
    const { rerender } = render(card(notice));
    return (next: Notice | null) => rerender(card(next));
  }

  it('gives each new notice its own live region element, even straight after one with the same text', () => {
    const show = renderCard(null);
    show({ ...failure, id: 1 });
    const first = screen.getByRole('alert');
    show({ ...failure, id: 2 });
    const second = screen.getByRole('alert');

    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.textContent).toBe(first.textContent);
  });

  it('shows a notice that was already there when it mounted without a live role, and announces the next one', () => {
    const show = renderCard({ ...failure, id: 7 });
    expect(screen.getByText('x.json could not be read.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    show({
      tone: 'info',
      title: 'No saved rules to export',
      description: 'Add and save a rule, then try again.',
      id: 8,
    });
    expect(screen.getByRole('status').textContent).toBe('No saved rules to exportAdd and save a rule, then try again.');
  });
});

describe('BackupCard after unmounting', () => {
  it('reports nothing when an import it started finishes saving after the card is gone', async () => {
    const store = createStore();
    let finishSave!: (outcome: { added: number; replaced: number }) => void;
    const saving = new Promise<{ added: number; replaced: number }>((resolve) => {
      finishSave = resolve;
    });
    const onImport = vi.fn(() => saving);
    const onNotice = vi.fn();
    const { rerender } = render(<Harness store={store} onImport={onImport} onNotice={onNotice} />);

    upload('x.json', async () => 'picked rule');
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
    expect(onImport).toHaveBeenCalledTimes(1);

    rerender(<Harness store={store} mounted={false} onImport={onImport} onNotice={onNotice} />);
    await act(async () => {
      finishSave({ added: 1, replaced: 0 });
      await saving;
    });
    rerender(<Harness store={store} onImport={onImport} onNotice={onNotice} />);

    expect(onNotice).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Imported/)).toBeNull();
  });
});

// Chromium moves focus off a button that becomes disabled to <body> once the export outlasts a
// frame; jsdom does not (and ignores blur() on a disabled element). These tests stand in for it by
// passing focus through a control outside the card and blurring that.
describe('BackupCard export focus', () => {
  // Presses a focused Export and holds the saved-settings read open until `settle` is called.
  function pressExport() {
    let settle!: (outcome: () => TintSettings) => void;
    const read = new Promise<TintSettings>((resolve, reject) => {
      settle = (outcome) => {
        try {
          resolve(outcome());
        } catch (error) {
          reject(error);
        }
      };
    });
    const store = createStore();
    vi.spyOn(store, 'load').mockReturnValueOnce(read);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:settings');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <>
        <Harness store={store} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const exportButton = screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;
    exportButton.focus();
    fireEvent.click(exportButton);
    expect(exportButton.disabled).toBe(true);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    return { exportButton, elsewhere, settle };
  }

  it.each([
    ['a backup is made', () => new TintSettings([ProjectRule.create('exact', 'alpha')]), 'Backup ready'],
    ['there are no saved rules', () => new TintSettings([]), 'No saved rules to export'],
    [
      'the saved settings cannot be read',
      () => {
        throw new Error('storage down');
      },
      'Couldn’t create a backup',
    ],
  ])('puts focus back on Export when %s, after the browser dropped it to <body>', async (_case, outcome, title) => {
    const { exportButton, elsewhere, settle } = pressExport();
    elsewhere.focus();
    elsewhere.blur();
    expect(document.activeElement).toBe(document.body);

    settle(outcome);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(exportButton.disabled).toBe(false);
    expect(document.activeElement).toBe(exportButton);
  });

  it('leaves focus where the user moved it while the export ran', async () => {
    const { exportButton, elsewhere, settle } = pressExport();
    elsewhere.focus();

    settle(() => new TintSettings([]));
    expect(await screen.findByText('No saved rules to export')).toBeTruthy();
    expect(exportButton.disabled).toBe(false);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('puts focus back only once, not on a later return to idle', async () => {
    const store = createStore();
    vi.spyOn(store, 'importJson').mockImplementation(() => {
      throw new Error('bad file');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Harness store={store} />);
    const exportButton = screen.getByRole('button', { name: 'Export' });
    exportButton.focus();
    fireEvent.click(exportButton);
    expect(await screen.findByText('No saved rules to export')).toBeTruthy();
    expect(document.activeElement).toBe(exportButton);

    exportButton.blur();
    upload('settings.json', async () => '{}');
    expect(await screen.findByText('Couldn’t import this file')).toBeTruthy();
    await act(async () => {});
    expect(document.activeElement).toBe(document.body);
  });

  it('does not take focus when Export was pressed without it', async () => {
    render(<Harness store={createStore()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(await screen.findByText('No saved rules to export')).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });
});
