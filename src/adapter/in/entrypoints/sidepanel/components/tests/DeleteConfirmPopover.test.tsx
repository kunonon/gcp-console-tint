import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeleteConfirmPopover from '../DeleteConfirmPopover';

afterEach(() => {
  cleanup();
});

function renderHarness(onConfirm: () => void) {
  return render(
    <div>
      <DeleteConfirmPopover
        question="Delete this rule?"
        items={[{ id: '1', text: 'my-project', detail: 'exact' }]}
        itemsLabel="Rule to delete"
        confirmLabel="Delete"
        tooltipLabel="Delete"
        onConfirm={onConfirm}
      >
        <button type="button" aria-label="Delete">
          X
        </button>
      </DeleteConfirmPopover>
      <h1>outside content</h1>
    </div>,
  );
}

describe('DeleteConfirmPopover', () => {
  it('is closed by default: no dialog, no confirm button, until the trigger is clicked', () => {
    renderHarness(() => {});

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it("has no extra focusable wrapper: Popover.Trigger's own Pressable wrapper div is removed from the Tab order (tabindex=-1), leaving the trigger button as the only stop", () => {
    renderHarness(() => {});

    const button = screen.getByRole('button', { name: 'Delete' });
    const wrapper = button.closest('[data-slot="popover-trigger"]') as HTMLElement | null;
    expect(wrapper).toBeTruthy();
    expect(wrapper!.tabIndex).toBe(-1);
    expect(button.tabIndex).toBe(0);
  });

  it('reaches the trigger with a single Tab from the top of the document, and opens the popover by pressing Enter on it (keyboard-only, not just a pointer click)', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.tab();
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(button);

    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('clicking the trigger opens a dialog labelled by its question, with a note that it is final, the item, and Cancel and confirm buttons', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete this rule?' });
    expect(within(dialog).getByRole('heading', { name: 'Delete this rule?' })).toBeTruthy();
    expect(within(dialog).getByText('This can’t be undone.')).toBeTruthy();
    expect(within(dialog).getByText('my-project')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('lists every item in full, each with its detail, in a list named by itemsLabel', async () => {
    const user = userEvent.setup();
    const pattern = '^(?:team|org)-billing-(?:eu|us)-west-\\d{2}$';
    render(
      <DeleteConfirmPopover
        question="Delete 3 rules?"
        items={[
          { id: 'a', text: 'alpha', detail: 'exact' },
          { id: 'b', text: 'alpha', detail: 'prefix' },
          { id: 'c', text: pattern, detail: 'regex' },
        ]}
        itemsLabel="Rules to delete"
        confirmLabel="Delete 3 rules"
        tooltipLabel="Delete selected"
        onConfirm={() => {}}
      >
        <button type="button" aria-label="Delete selected">
          X
        </button>
      </DeleteConfirmPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    const list = within(screen.getByRole('dialog')).getByRole('list', { name: 'Rules to delete' });
    const rows = within(list).getAllByRole('listitem');

    // Two rules with the same pattern stay apart by their match type.
    expect(rows.map((row) => row.textContent)).toEqual(['alphaexact', 'alphaprefix', `${pattern}regex`]);
    const text = within(rows[2] as HTMLElement).getByText(pattern);
    expect(text.className).toContain('font-mono');
    expect(text.className).toContain('confirm-item');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete 3 rules' })).toBeTruthy();
  });

  it("shows a rule's empty pattern as a muted placeholder rather than an empty row", async () => {
    const user = userEvent.setup();
    render(
      <DeleteConfirmPopover
        question="Delete this rule?"
        items={[{ id: '1', text: '', detail: 'prefix' }]}
        itemsLabel="Rule to delete"
        confirmLabel="Delete"
        tooltipLabel="Delete"
        onConfirm={() => {}}
      >
        <button type="button" aria-label="Delete">
          X
        </button>
      </DeleteConfirmPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const placeholder = within(screen.getByRole('dialog')).getByText('(empty pattern)');
    expect(placeholder.className).toContain('text-muted');
  });

  it('puts Cancel before the confirm button, both 12px-cornered to sit concentric in the popover', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');

    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Delete']);
    for (const button of buttons) expect(button.className).toContain('rounded-xl');
  });

  it('renders a Popover.Arrow pointing at the trigger', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(document.querySelector('[data-slot="popover-overlay-arrow-group"]')).toBeTruthy();
  });

  it('clicking the confirm button calls onConfirm and closes the popover', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('pressing Escape dismisses the popover without calling onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clicking outside the popover dismisses it without calling onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(onConfirm);

    // Grab the reference before opening: react-aria's Popover marks the rest of the page
    // aria-hidden while open, so it must be queried beforehand.
    const outside = screen.getByRole('heading', { name: 'outside content' });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(outside);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Cancel closes the popover without calling onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderHarness(onConfirm);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders distinct question/items/confirmLabel per instance (e.g. Remove color, with a swatch and no monospace)', async () => {
    const user = userEvent.setup();
    render(
      <DeleteConfirmPopover
        question="Remove this color?"
        items={[{ id: '1', text: 'Primary', swatch: '#ff0000' }]}
        itemsLabel="Color to remove"
        monospace={false}
        confirmLabel="Remove"
        tooltipLabel="Remove color"
        onConfirm={() => {}}
      >
        <button type="button" aria-label="Remove color">
          X
        </button>
      </DeleteConfirmPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Remove color' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove this color?')).toBeTruthy();
    const name = within(dialog).getByText('Primary');
    expect(name.className).not.toContain('font-mono');
    expect(within(dialog).getByRole('list', { name: 'Color to remove' })).toBeTruthy();
    expect((dialog.querySelector('.confirm-swatch') as HTMLElement).style.background).toBe('rgb(255, 0, 0)');
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
