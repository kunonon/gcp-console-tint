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
        target="my-project"
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

  it('clicking the trigger opens a popover showing the question and target as separate lines, plus a confirm button', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this rule?')).toBeTruthy();
    expect(within(dialog).getByText('my-project')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('renders the target on its own element, styled as monospace/muted so it reads as data rather than prose (not concatenated into the question text)', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');

    const question = within(dialog).getByText('Delete this rule?');
    const target = within(dialog).getByText('my-project');

    // Two distinct elements, not one combined string.
    expect(question).not.toBe(target);
    expect(target.className).toContain('font-mono');
    expect(target.className).toContain('text-muted');
    expect(question.className).not.toContain('font-mono');
  });

  it('renders the confirm button at full width (w-full) rather than right-aligned', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');

    const confirmButton = within(dialog).getByRole('button', { name: 'Delete' });
    expect(confirmButton.className).toContain('w-full');
    expect(confirmButton.className).not.toContain('self-end');
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

  it('clicking outside the popover dismisses it without calling onConfirm (no Cancel button; dismissal is the only cancel path)', async () => {
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

  it('does not render a Cancel button in the popover', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('renders distinct question/target/confirmLabel per instance (e.g. Remove color usage)', async () => {
    const user = userEvent.setup();
    render(
      <DeleteConfirmPopover
        question="Remove this color?"
        target="Primary"
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
    expect(within(dialog).getByText('Primary')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
