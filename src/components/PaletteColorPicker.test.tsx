import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaletteColorPicker from './PaletteColorPicker';

afterEach(() => {
  cleanup();
});

const palette = [{ id: 'default', name: 'Primary', color: '#ff6d00' }];

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
          paletteId="default"
          customColor="#123456"
          effectiveColor="#ff6d00"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toContain('Primary');
    });

    it('shows the custom hex color when paletteId is null (no reference)', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={null}
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
          paletteId="default"
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
        paletteId="default"
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

  it('hides the Palette section in the popover when paletteEnabled is false, even with palette entries present', async () => {
    const user = userEvent.setup();
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled={false}
        palette={palette}
        paletteId={null}
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
