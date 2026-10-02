import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRule } from '../../../../../../domain/project-rule';
import { TintSettings } from '../../../../../../domain/tint-settings';
import ImportRulesModal from '../ImportRulesModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const incoming = [ProjectRule.create('exact', 'alpha'), ProjectRule.create('regex', '^beta-.*$')];

function renderModal(
  overrides: {
    current?: TintSettings;
    incoming?: readonly ProjectRule[];
    onImport?: (selected: readonly ProjectRule[]) => Promise<void>;
    onOpenChange?: (isOpen: boolean) => void;
  } = {},
) {
  return render(
    <ImportRulesModal
      isOpen
      onOpenChange={overrides.onOpenChange ?? (() => {})}
      fileName="settings.json"
      incoming={overrides.incoming ?? incoming}
      current={overrides.current ?? new TintSettings([])}
      onImport={overrides.onImport ?? (async () => {})}
    />,
  );
}

describe('ImportRulesModal', () => {
  // The modal opens after a file is read, so there is no button to hang a Modal.Trigger on: this
  // is the one place in the app where a HeroUI Modal is driven by isOpen alone.
  it('renders its dialog from isOpen alone, with no trigger element', async () => {
    renderModal();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Import rules')).toBeTruthy();
    expect(within(dialog).getByText('settings.json')).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'alpha' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: '^beta-.*$' })).toBeTruthy();
    // Nothing outside the dialog could have opened it.
    expect(screen.queryByRole('button', { name: /Import…/ })).toBeNull();
  });

  it('starts with every rule selected and disables Import once none are', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn(async (_selected: readonly ProjectRule[]) => {});
    renderModal({ onImport });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('2 of 2 selected')).toBeTruthy();
    const importButton = within(dialog).getByRole('button', { name: 'Import 2 rules' }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(false);

    await user.click(within(dialog).getByRole('checkbox', { name: 'alpha' }));
    await user.click(within(dialog).getByRole('checkbox', { name: '^beta-.*$' }));

    expect(within(dialog).getByText('0 of 2 selected')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Import 0 rules' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('imports only the selected rules, in file order', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn(async (_selected: readonly ProjectRule[]) => {});
    renderModal({ onImport });

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'alpha' }));
    await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport.mock.calls[0]![0]).toEqual([incoming[1]]);
  });

  it('marks the rules that would replace an existing one, and only counts the selected ones', async () => {
    const user = userEvent.setup();
    // Same match type and pattern as the first incoming rule, under its own identity.
    const current = new TintSettings([ProjectRule.create('exact', 'alpha')]);
    renderModal({ current });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('img', { name: 'Replaces an existing rule' })).toHaveLength(1);
    expect(within(dialog).getByText('Replaces 1 existing rule')).toBeTruthy();

    await user.click(within(dialog).getByRole('checkbox', { name: 'alpha' }));

    expect(within(dialog).queryByText('Replaces 1 existing rule')).toBeNull();
  });

  it('recomputes row targets for the selected subset and labels source and destination rows', async () => {
    const user = userEvent.setup();
    const duplicates = [
      ProjectRule.create('exact', 'alpha'),
      ProjectRule.create('exact', 'alpha'),
      ProjectRule.create('exact', 'gamma'),
    ];
    const current = new TintSettings([ProjectRule.create('exact', 'alpha'), ProjectRule.create('exact', 'alpha')]);
    renderModal({ current, incoming: duplicates });

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('File row 1 → Rule row 1')).toBeTruthy();
    const secondRowTarget = within(dialog).getByText('File row 2 → Rule row 2');
    expect(secondRowTarget).toBeTruthy();
    expect(
      (within(dialog).getAllByRole('checkbox', { name: 'alpha' })[1] as HTMLInputElement).getAttribute(
        'aria-describedby',
      ),
    ).toBe(secondRowTarget.id);
    expect(within(dialog).getByText('File row 3 → Add')).toBeTruthy();
    expect(within(dialog).getAllByRole('img', { name: 'Replaces an existing rule' })).toHaveLength(2);

    await user.click(within(dialog).getAllByRole('checkbox', { name: 'alpha' })[0]!);

    expect(within(dialog).getByText('File row 1 → Not selected')).toBeTruthy();
    expect(within(dialog).getByText('File row 2 → Rule row 1')).toBeTruthy();
    expect(within(dialog).getByText('File row 3 → Add')).toBeTruthy();
    expect(within(dialog).getAllByRole('img', { name: 'Replaces an existing rule' })).toHaveLength(1);
  });

  it('keeps selection after a save failure and retries with the then-current selection', async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockRejectedValueOnce(new Error('quota exceeded')).mockResolvedValueOnce(undefined);
    const current = new TintSettings([ProjectRule.create('exact', 'existing')]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderModal({ current, onImport });

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'alpha' }));
    await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));

    expect(await within(dialog).findByText('Couldn’t save imported rules')).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: '^beta-.*$' })).toBeTruthy();
    expect(onImport).toHaveBeenNthCalledWith(1, [incoming[1]]);
    expect(current.projectRules.map((rule) => rule.pattern)).toEqual(['existing']);

    await user.click(within(dialog).getByRole('checkbox', { name: '^beta-.*$' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'alpha' }));
    await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport).toHaveBeenNthCalledWith(2, [incoming[0]]);
    expect(within(dialog).queryByText('Couldn’t save imported rules')).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('ignores dismissal and selection changes while a save is pending and accepts one confirm', async () => {
    const user = userEvent.setup();
    let resolveSave!: () => void;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onImport = vi.fn(() => save);
    const onOpenChange = vi.fn();
    renderModal({ onImport, onOpenChange });

    const dialog = await screen.findByRole('dialog');
    const importButton = within(dialog).getByRole('button', { name: 'Import 2 rules' });
    await user.click(importButton);

    expect(onImport).toHaveBeenCalledTimes(1);
    expect((importButton as HTMLButtonElement).disabled).toBe(true);
    const alphaCheckbox = within(dialog).getByRole('checkbox', { name: 'alpha' }) as HTMLInputElement;
    expect(alphaCheckbox.disabled).toBe(true);
    expect(alphaCheckbox.checked).toBe(true);
    await user.click(importButton);
    await user.click(alphaCheckbox);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(alphaCheckbox.checked).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await act(async () => {
      resolveSave();
      await save;
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
