import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '../../../../../../domain/color';
import { type Fill, Gradient } from '../../../../../../domain/gradient';
import ColorSwatchField from '../ColorSwatchField';

const red = Color.fromHex('#ff0000')!;

afterEach(() => {
  cleanup();
});

describe('ColorSwatchField', () => {
  it('adds the "hidden @min-[220px]:inline" classes to the hex span when hexHidableOnNarrow is true', () => {
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} hexHidableOnNarrow />);

    const hexSpan = screen.getByText('#ff0000');
    expect(hexSpan.className).toContain('hidden');
    expect(hexSpan.className).toContain('@min-[220px]:inline');
  });

  it('omits the "hidden @min-[220px]:inline" classes from the hex span when hexHidableOnNarrow is false/absent', () => {
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);

    const hexSpan = screen.getByText('#ff0000');
    expect(hexSpan.className).not.toContain('hidden');
    expect(hexSpan.className).not.toContain('@min-[220px]:inline');
  });

  it('is a button named by ariaLabel that holds a "color-chip" bead filled with the value and the hex text', () => {
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);

    const trigger = screen.getByRole('button', { name: 'Test color' });
    expect(trigger.tagName).toBe('BUTTON');

    const bead = trigger.querySelector('span[aria-hidden="true"]') as HTMLElement | null;
    expect(bead).toBeTruthy();
    expect(bead!.classList.contains('color-chip')).toBe(true);
    expect(['#ff0000', 'rgb(255, 0, 0)']).toContain(bead!.style.backgroundColor);

    expect(trigger.contains(screen.getByText('#ff0000'))).toBe(true);
  });

  it('fills the bead of a gradient with the gradient, as longhands, and labels it "Gradient"', () => {
    const gradient = Gradient.fromStops([red, Color.fromHex('#0000ff')!])!;
    render(<ColorSwatchField ariaLabel="Test color" value={gradient} onChange={() => {}} hexHidableOnNarrow />);

    const trigger = screen.getByRole('button', { name: 'Test color' });
    const bead = trigger.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(['#ff0000', 'rgb(255, 0, 0)']).toContain(bead.style.backgroundColor);
    expect(bead.style.backgroundImage).toMatch(
      /^linear-gradient\(to right, (#ff0000|rgb\(255, 0, 0\)), (#0000ff|rgb\(0, 0, 255\))\)$/,
    );
    const label = within(trigger).getByText('Gradient');
    expect(label.className).toContain('@min-[220px]:inline');
  });

  it('marks the button with "outlined-control", the hook style.css uses to strengthen the border of hand-built controls in the dark theme, and never rings it (a palette row has no alternatives to be chosen among)', () => {
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);

    const trigger = screen.getByRole('button', { name: 'Test color' });
    expect(trigger.classList.contains('outlined-control')).toBe(true);
    expect(trigger.className).not.toContain('ring-2');
  });

  it("is the row's only Tab stop: Popover.Trigger's own wrapper is taken out of the Tab order", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />
        <button type="button">after</button>
      </>,
    );

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Test color' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }));
  });

  it('opens the editor from a press on the hex text as well as the bead (the whole control is the button), in a dialog named like the control', async () => {
    const user = userEvent.setup();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByText('#ff0000'));

    const dialog = screen.getByRole('dialog', { name: 'Test color' });
    const hex = within(dialog).getByLabelText('Hex') as HTMLInputElement;
    expect(hex.tagName).toBe('INPUT');
    expect(hex.value).toBe('#ff0000');
    expect(within(dialog).getByRole('group', { name: /Saturation and brightness/ })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Hue' })).toBeTruthy();
    // The dialog scrolls inside the popover, the element react-aria caps the height of.
    expect(dialog.className).toContain('min-h-0');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(dialog.closest('[data-placement]')?.className).toContain('flex flex-col');
    // It narrows with a panel that is narrower than the dialog and its 12px margins.
    expect(dialog.className).toContain('max-w-[calc(100vw-24px)]');
  });

  it('says on the button that takes focus that it opens a dialog and whether that dialog is open', async () => {
    const user = userEvent.setup();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);

    const trigger = screen.getByLabelText('Test color');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    await user.click(trigger);

    screen.getByRole('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('Tab walks the open editor in the order it is laid out and comes round again: Add stop, Hex, the face, the hue, Add stop', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(fill: Fill) => void>();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Test color' }));
    const dialog = within(screen.getByRole('dialog'));
    const add = dialog.getByRole('button', { name: 'Add stop' });
    const hex = dialog.getByLabelText('Hex');
    const face = within(dialog.getByRole('group', { name: /Saturation and brightness/ })).getByRole('slider');
    const hue = within(dialog.getByRole('group', { name: 'Hue' })).getByRole('slider');

    // A colour's one stop is not a control, and Remove stop is disabled.
    for (const stop of [add, hex, face, hue, add]) {
      await user.tab();
      expect(document.activeElement).toBe(stop);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hands a complete hex typed in the editor to onChange as a domain Color', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(fill: Fill) => void>();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Test color' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Hex'), { target: { value: '#123456' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual(Color.fromHex('#123456'));
  });

  it('Enter in the hex input closes the popover and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Test color' }));
    await user.click(within(screen.getByRole('dialog')).getByLabelText('Hex'));
    await user.keyboard('{Enter}');

    // react-aria restores focus a frame after the popover is gone.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Test color' }));
    });
  });

  it('Escape closes the popover and drops a draft: nothing is written', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(fill: Fill) => void>();
    render(<ColorSwatchField ariaLabel="Test color" value={red} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Test color' }));
    const hex = within(screen.getByRole('dialog')).getByLabelText('Hex');
    await user.click(hex);
    await user.keyboard('abc{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(['fff', '#abc', '12'])(
    'a press outside the popover with the draft %j in the field closes it and writes nothing; reopened, the field shows the value',
    async (text) => {
      const user = userEvent.setup();
      const onChange = vi.fn<(fill: Fill) => void>();
      render(
        <>
          <h1>Outside</h1>
          <ColorSwatchField ariaLabel="Test color" value={red} onChange={onChange} />
        </>,
      );

      await user.click(screen.getByRole('button', { name: 'Test color' }));
      await user.click(within(screen.getByRole('dialog')).getByLabelText('Hex'));
      await user.keyboard(text);
      await user.click(screen.getByRole('heading', { name: 'Outside', hidden: true }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(onChange).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Test color' }));
      expect((within(screen.getByRole('dialog')).getByLabelText('Hex') as HTMLInputElement).value).toBe('#ff0000');
    },
  );
});
