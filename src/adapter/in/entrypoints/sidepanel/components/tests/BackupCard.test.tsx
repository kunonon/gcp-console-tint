import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRule } from '../../../../../../domain/project-rule';
import { TintSettings } from '../../../../../../domain/tint-settings';
import type { SettingsStore } from '../../../../../../port/settings-store';
import BackupCard from '../BackupCard';

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
    render(
      <BackupCard
        settingsStore={store}
        settings={new TintSettings([])}
        onImport={async () => ({ added: 0, replaced: 0 })}
      />,
    );

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
    render(
      <BackupCard
        settingsStore={store}
        settings={new TintSettings([])}
        onImport={async () => ({ added: 0, replaced: 0 })}
      />,
    );

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
});
