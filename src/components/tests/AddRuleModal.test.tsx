import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatchType } from '../../types';
import AddRuleModal from '../AddRuleModal';
import { MATCH_TYPE_LABELS } from '../MatchTypeSelect';

afterEach(() => {
  cleanup();
});

function renderHarness(onAdd: (matchType: MatchType, pattern: string) => void) {
  return render(
    <div>
      <AddRuleModal onAdd={onAdd}>
        <button type="button" aria-label="Add rule">
          +
        </button>
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

// The Select trigger's accessible name concatenates its aria-labelledby refs (the
// currently-selected value's text, then the field's own "Match type" aria-label), e.g.
// "Exact Match type" — so it's matched by substring, and its displayed value is read from its
// text content rather than an exact accessible name.
function getMatchTypeTrigger(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: /Match type/ });
}

async function selectMatchType(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, matchType: MatchType) {
  await user.click(getMatchTypeTrigger(dialog));
  await user.click(await screen.findByRole('option', { name: MATCH_TYPE_LABELS[matchType] }));
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

  it("has no extra focusable wrapper: Modal.Trigger's own Pressable wrapper div is removed from the Tab order (tabindex=-1), leaving the trigger Button as the only stop", () => {
    renderHarness(() => {});

    const button = screen.getByRole('button', { name: 'Add rule' });
    const wrapper = button.closest('[data-slot="modal-trigger"]') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper!.tabIndex).toBe(-1);
    expect(button.tabIndex).toBe(0);
  });

  it('reaches the trigger with a single Tab from the top of the document, and opens the modal by pressing Enter on it (keyboard-only, not just a pointer click)', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.tab();
    const button = screen.getByRole('button', { name: 'Add rule' });
    expect(document.activeElement).toBe(button);

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('autofocuses the value input when the modal opens (not the Match type Select) so the flow is open -> paste -> Enter', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect(document.activeElement).toBe(within(dialog).getByLabelText('Project ID'));
  });

  it('offers all four match types, in order, in the Match type Select', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    await user.click(getMatchTypeTrigger(dialog));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Starts with', 'Ends with', 'Exact', 'Regex']);
  });

  it('defaults to "Exact" selected, an empty "Project ID" value field, and a disabled Add button', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect(getMatchTypeTrigger(dialog).textContent).toContain('Exact');
    const valueInput = within(dialog).getByLabelText('Project ID') as HTMLInputElement;
    expect(valueInput.value).toBe('');
    expect(getAdd(dialog).disabled).toBe(true);
  });

  it("each match type is selectable and updates the Select's displayed value", async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    for (const matchType of ['prefix', 'suffix', 'regex', 'exact'] as const) {
      await selectMatchType(user, dialog, matchType);
      expect(getMatchTypeTrigger(dialog).textContent).toContain(MATCH_TYPE_LABELS[matchType]);
    }
  });

  it('switches the value field\'s label (and placeholder) to "Pattern" for Regex and back to "Project ID" for the others', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});
    const dialog = await openModal(user);

    expect(within(dialog).getByLabelText('Project ID').getAttribute('placeholder')).toBe('my-project-123');

    await selectMatchType(user, dialog, 'regex');
    expect(within(dialog).getByLabelText('Pattern').getAttribute('placeholder')).toBe('^my-project-.*$');
    expect(within(dialog).queryByLabelText('Project ID')).toBeNull();

    await selectMatchType(user, dialog, 'prefix');
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

    await selectMatchType(user, dialog, 'regex');
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

    await selectMatchType(user, dialog, 'suffix');
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

  it('resets to Exact, an empty value, and input focus every time it is reopened, discarding the previous session', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    let dialog = await openModal(user);
    await selectMatchType(user, dialog, 'regex');
    const patternInput = within(dialog).getByLabelText('Pattern');
    fireEvent.change(patternInput, { target: { value: 'left-over' } });
    // Move focus into the field before Escape, matching a real user's flow (pick match type,
    // then click/type into the value field) rather than leaving focus on the Select's trigger
    // right after it closes.
    patternInput.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    dialog = await openModal(user);
    expect(getMatchTypeTrigger(dialog).textContent).toContain('Exact');
    expect((within(dialog).getByLabelText('Project ID') as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Project ID'));
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
