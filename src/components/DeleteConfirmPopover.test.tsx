import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DeleteConfirmPopover from './DeleteConfirmPopover';

afterEach(() => {
  cleanup();
});

function renderHarness(onConfirm: () => void) {
  return render(
    <div>
      <DeleteConfirmPopover
        message='Delete "my-project"?'
        confirmLabel="Delete"
        tooltipLabel="Delete"
        onConfirm={onConfirm}
      >
        <button aria-label="Delete">X</button>
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

  it('clicking the trigger opens a popover showing the message and a confirm button', async () => {
    const user = userEvent.setup();
    renderHarness(() => {});

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Delete "my-project"?');
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeTruthy();
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

  it('renders distinct message and confirmLabel per instance (e.g. Remove color usage)', async () => {
    const user = userEvent.setup();
    render(
      <DeleteConfirmPopover
        message='Remove "Primary"?'
        confirmLabel="Remove"
        tooltipLabel="Remove color"
        onConfirm={() => {}}
      >
        <button aria-label="Remove color">X</button>
      </DeleteConfirmPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Remove color' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Remove "Primary"?');
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
