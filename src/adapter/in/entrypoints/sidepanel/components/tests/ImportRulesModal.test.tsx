import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectRule } from '../../../../../../domain/project-rule';
import { TintSettings } from '../../../../../../domain/tint-settings';
import ImportRulesModal from '../ImportRulesModal';

afterEach(() => {
  cleanup();
});

const incoming = [ProjectRule.create('exact', 'alpha'), ProjectRule.create('regex', '^beta-.*$')];

function renderModal(
  overrides: { current?: TintSettings; onImport?: (selected: readonly ProjectRule[]) => void } = {},
) {
  return render(
    <ImportRulesModal
      isOpen
      onOpenChange={() => {}}
      fileName="settings.json"
      incoming={incoming}
      current={overrides.current ?? new TintSettings([])}
      onImport={overrides.onImport ?? (() => {})}
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
    const onImport = vi.fn();
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
    const onImport = vi.fn();
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
});
