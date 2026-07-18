import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AddRuleModal, { MATCH_TYPE_LABELS } from './AddRuleModal';
import type { MatchType } from '../types';

afterEach(() => {
  cleanup();
});

function renderHarness(onAdd: (matchType: MatchType, pattern: string) => void) {
  return render(
    <div>
      <AddRuleModal onAdd={onAdd}>
        <button aria-label="Add rule">+</button>
      </AddRuleModal>
      <h1>outside content</h1>
    </div>,
  );
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  return screen.findByRole('dialog');
}

function getAdd(dialog: HTMLElement): HTMLButtonElement {
  return within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
}

describe('AddRuleModal', () => {
  it('is closed by default: no dialog, until the trigger is clicked', () => {
    renderHarness(() => {});

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
  });

  it('clicking the trigger opens a modal titled "Add project rule"', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    const dialog = await openModal(user);

    expect(within(dialog).getByRole('heading', { name: 'Add project rule' })).toBeTruthy();
  });

  it('offers all four match types, in order, as radio options', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    const radios = within(dialog).getAllByRole('radio');
    const labels = radios.map((radio) => radio.closest('label')?.textContent?.trim());
    expect(labels).toEqual(['Starts with', 'Ends with', 'Exact', 'Regex']);
  });

  it('defaults to "Exact" selected, an empty "Project ID" value field, and a disabled Add button', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect((within(dialog).getByRole('radio', { name: 'Exact' }) as HTMLInputElement).checked).toBe(true);
    const valueInput = within(dialog).getByLabelText('Project ID') as HTMLInputElement;
    expect(valueInput.value).toBe('');
    expect(getAdd(dialog).disabled).toBe(true);
  });

  it('each match type is selectable and updates the checked radio', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    for (const matchType of ['prefix', 'suffix', 'regex', 'exact'] as const) {
      await user.click(within(dialog).getByRole('radio', { name: MATCH_TYPE_LABELS[matchType] }));
      expect((within(dialog).getByRole('radio', { name: MATCH_TYPE_LABELS[matchType] }) as HTMLInputElement).checked).toBe(
        true,
      );
    }
  });

  it('switches the value field\'s label to "Pattern" for Regex and back to "Project ID" for the others', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect(within(dialog).getByLabelText('Project ID')).toBeTruthy();

    await user.click(within(dialog).getByRole('radio', { name: 'Regex' }));
    expect(within(dialog).getByLabelText('Pattern')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Project ID')).toBeNull();

    await user.click(within(dialog).getByRole('radio', { name: 'Starts with' }));
    expect(within(dialog).getByLabelText('Project ID')).toBeTruthy();
    expect(within(dialog).queryByLabelText('Pattern')).toBeNull();
  });

  it('keeps Add disabled while the value is empty or whitespace-only, and enables it once non-blank text is entered', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect(getAdd(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: '   ' } });
    expect(getAdd(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: 'my-project' } });
    expect(getAdd(dialog).disabled).toBe(false);
  });

  it('for Regex, shows "Invalid regular expression" and disables Add only when the pattern is an invalid regex', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    await user.click(within(dialog).getByRole('radio', { name: 'Regex' }));
    fireEvent.change(within(dialog).getByLabelText('Pattern'), { target: { value: 'proj-[' } });

    expect(within(dialog).getByText('Invalid regular expression')).toBeTruthy();
    expect(getAdd(dialog).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('Pattern'), { target: { value: 'proj-.*' } });
    expect(within(dialog).queryByText('Invalid regular expression')).toBeNull();
    expect(getAdd(dialog).disabled).toBe(false);
  });

  it('does not validate the value as a regex, and never shows the warning, for prefix/suffix/exact', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    // '[' alone is an invalid regex, but the default match type is 'exact', so no warning and
    // Add is enabled once the value is non-blank.
    fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: '[' } });
    expect(within(dialog).queryByText('Invalid regular expression')).toBeNull();
    expect(getAdd(dialog).disabled).toBe(false);
  });

  it('clicking Add calls onAdd with the (matchType, trimmed value) and closes the modal', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderHarness(onAdd);
    const dialog = await openModal(user);

    await user.click(within(dialog).getByRole('radio', { name: 'Ends with' }));
    fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: '  my-project  ' } });
    await user.click(getAdd(dialog));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith('suffix', 'my-project');
  });

  it('pressing Enter in the value field adds the rule and closes the modal, same as clicking Add', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderHarness(onAdd);
    const dialog = await openModal(user);

    const valueInput = within(dialog).getByLabelText('Project ID');
    fireEvent.change(valueInput, { target: { value: 'my-project' } });
    fireEvent.keyDown(valueInput, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onAdd).toHaveBeenCalledWith('exact', 'my-project');
  });

  it('pressing Enter while the value is blank does not call onAdd and leaves the modal open', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderHarness(onAdd);
    const dialog = await openModal(user);

    fireEvent.keyDown(within(dialog).getByLabelText('Project ID'), { key: 'Enter' });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('resets to Exact and an empty value every time it is reopened, discarding the previous session', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    let dialog = await openModal(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Regex' }));
    fireEvent.change(within(dialog).getByLabelText('Pattern'), { target: { value: 'left-over' } });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    dialog = await openModal(user);
    expect((within(dialog).getByRole('radio', { name: 'Exact' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText('Project ID') as HTMLInputElement).value).toBe('');
  });

  it('pressing Escape dismisses the modal without calling onAdd (no Cancel button; dismissal is the only cancel path)', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderHarness(onAdd);
    const dialog = await openModal(user);

    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('clicking outside the modal dismisses it without calling onAdd', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    renderHarness(onAdd);

    // Grab the reference before opening: react-aria's Modal marks the rest of the page
    // aria-hidden while open, so it must be queried beforehand.
    const outside = screen.getByRole('heading', { name: 'outside content' });
    await openModal(user);

    await user.click(outside);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onAdd).not.toHaveBeenCalled();
  });
});
