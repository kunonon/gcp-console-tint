import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Color } from '../../../../../../domain/color';
import { PaletteEntry, PaletteEntryId } from '../../../../../../domain/palette';
import PaletteColorPicker from '../PaletteColorPicker';

afterEach(() => {
  cleanup();
});

const defaultEntryId = PaletteEntryId.recreate('default');
const palette = [PaletteEntry.recreate(defaultEntryId, 'Primary', Color.fromHex('#ff6d00')!)];

async function openDialog(user: ReturnType<typeof userEvent.setup>, triggerLabel: string) {
  await user.click(screen.getByRole('button', { name: triggerLabel }));
  return screen.getByRole('dialog');
}

describe('PaletteColorPicker', () => {
  describe('trigger label', () => {
    it('shows the referenced palette entry name when paletteId references a valid entry', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={defaultEntryId}
          customColor="#123456"
          effectiveColor="#ff6d00"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toContain('Primary');
    });

    it('shows the custom hex color when paletteId is undefined (no reference)', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={undefined}
          customColor="#123456"
          effectiveColor="#123456"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toContain('#123456');
    });

    it('shows "Auto" when autoSelected is true, taking priority over a paletteId reference', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={defaultEntryId}
          customColor="#123456"
          effectiveColor="#ff6d00"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
          supportsAuto
          autoSelected
          onSelectAuto={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toBe('Auto');
    });
  });

  it('when autoSelected is true and paletteId references a valid entry, the popover shows Auto active while neither the matching palette swatch nor Custom gets an active ring (exclusivity)', async () => {
    const user = userEvent.setup();
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={palette}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
        supportsAuto
        autoSelected
        onSelectAuto={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    const autoButton = within(dialog).getByRole('button', { name: 'Auto' });
    expect(autoButton.className).toContain('ring-2');

    // "default" is the entry paletteId references; it must NOT show an active ring while Auto
    // is selected, since Auto and a palette reference are mutually exclusive states.
    const paletteSwatch = within(dialog).getByRole('button', { name: 'Primary' });
    expect(paletteSwatch.className).not.toContain('ring-2');

    const customInput = within(dialog).getByLabelText('Custom color');
    const customLabel = customInput.closest('label');
    expect(customLabel).toBeTruthy();
    expect(customLabel!.className).not.toContain('ring-2');
  });

  it("offsets the selected palette option's ring from the dot with a gap in the popover's surface colour (\"ring-offset-2 ring-offset-overlay\"), so the ring stays visible whatever the dot's colour", async () => {
    const user = userEvent.setup();
    const twoEntries = [
      ...palette,
      PaletteEntry.recreate(PaletteEntryId.recreate('second'), 'Secondary', Color.fromHex('#d50000')!),
    ];
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={twoEntries}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    const selected = within(dialog).getByRole('button', { name: 'Primary' });
    for (const className of ['ring-2', 'ring-focus', 'ring-offset-2', 'ring-offset-overlay']) {
      expect(selected.classList.contains(className), className).toBe(true);
    }
    const other = within(dialog).getByRole('button', { name: 'Secondary' });
    for (const className of ['ring-2', 'ring-offset-2']) {
      expect(other.classList.contains(className), className).toBe(false);
    }
  });

  it('marks the trigger and the "Match contrast" button with "outlined-control", and the trigger\'s dot and every palette option with "color-chip", the hooks style.css uses for the dark-theme control border and the bead rim', async () => {
    const user = userEvent.setup();
    const twoEntries = [
      ...palette,
      PaletteEntry.recreate(PaletteEntryId.recreate('second'), 'Secondary', Color.fromHex('#d50000')!),
    ];
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={twoEntries}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
        supportsAuto
        onSelectAuto={() => {}}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Test color' });
    expect(trigger.classList.contains('outlined-control')).toBe(true);
    const dot = trigger.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    expect(dot!.classList.contains('color-chip')).toBe(true);

    const dialog = await openDialog(user, 'Test color');

    expect(within(dialog).getByRole('button', { name: 'Auto' }).classList.contains('outlined-control')).toBe(true);
    for (const name of ['Primary', 'Secondary']) {
      expect(within(dialog).getByRole('button', { name }).classList.contains('color-chip')).toBe(true);
    }
  });

  it('hides the Palette section in the popover when paletteEnabled is false, even with palette entries present', async () => {
    const user = userEvent.setup();
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled={false}
        palette={palette}
        paletteId={undefined}
        customColor="#123456"
        effectiveColor="#123456"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    expect(within(dialog).queryByText('Palette')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Primary' })).toBeNull();
    // Custom is still shown regardless of paletteEnabled.
    expect(within(dialog).getByLabelText('Custom color')).toBeTruthy();
  });
});
