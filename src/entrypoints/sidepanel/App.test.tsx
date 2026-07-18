import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from './App';

interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

interface StoredTintSettings {
  paletteEnabled: boolean;
  palette: PaletteEntry[];
  topBarEnabled: boolean;
  topBarColor: string;
  topBarPaletteId: string | null;
  platformBarEnabled: boolean;
  platformBarColor: string;
  platformBarPaletteId: string | null;
  platformBarTextEnabled: boolean;
  platformBarTextColor: string;
  platformBarTextPaletteId: string | null;
  platformBarTextAuto: boolean;
  topBarHeight: number;
  topBarStripes: boolean;
  platformBarStripes: boolean;
}

async function getStoredSettings(): Promise<StoredTintSettings> {
  const result = await fakeBrowser.storage.local.get('tintSettings');
  return result.tintSettings as StoredTintSettings;
}

function getCard(switchName: string): HTMLElement {
  const el = screen.getByRole('switch', { name: switchName });
  const card = el.closest('.card');
  if (!card) throw new Error(`card not found for switch "${switchName}"`);
  return card as HTMLElement;
}

function getColorInput(card: HTMLElement): HTMLInputElement {
  const input = card.querySelector('input[type="color"]');
  if (!input) throw new Error('color input not found in card');
  return input as HTMLInputElement;
}

function getTriggerSwatch(triggerLabel: string): HTMLSpanElement {
  const trigger = screen.getByRole('button', { name: triggerLabel });
  const swatch = trigger.querySelector('span[aria-hidden="true"]');
  if (!swatch) throw new Error(`swatch not found in trigger "${triggerLabel}"`);
  return swatch as HTMLSpanElement;
}

// Opens a PaletteColorPicker popover by clicking its trigger (identified by its aria-label,
// e.g. "Top bar color") and returns the opened dialog element.
async function openPicker(user: ReturnType<typeof userEvent.setup>, triggerLabel: string) {
  await user.click(screen.getByRole('button', { name: triggerLabel }));
  return screen.getByRole('dialog');
}

// react-aria's Popover hides everything else in the document, including its own trigger
// button, while it is open (correct modal-overlay accessibility behavior). Tests that need
// to inspect the trigger or interact with sibling elements after using the picker must close
// it first.
async function closePicker(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
}

function getPaletteSwatch(dialog: HTMLElement, entryLabel: string): HTMLButtonElement {
  return within(dialog).getByRole('button', { name: entryLabel }) as HTMLButtonElement;
}

function getCustomColorInput(dialog: HTMLElement): HTMLInputElement {
  return within(dialog).getByLabelText('Custom color') as HTMLInputElement;
}

function getAutoButton(dialog: HTMLElement): HTMLButtonElement {
  return within(dialog).getByRole('button', { name: 'Auto' }) as HTMLButtonElement;
}

function hexOrRgb(hex: string): (string | undefined)[] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [hex, `rgb(${r}, ${g}, ${b})`];
}

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('shows default state: Top bar/Platform Bar triggers show the referenced palette name, text color trigger shows the Custom hex', async () => {
    render(<App />);

    const paletteSwitch = (await screen.findByRole('switch', { name: 'Color palette' })) as HTMLInputElement;
    expect(paletteSwitch.checked).toBe(true);

    const paletteCard = getCard('Color palette');
    const nameInputs = within(paletteCard).getAllByLabelText('Color name') as HTMLInputElement[];
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0].value).toBe('Primary');

    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('#ffffff');
  });

  it('opens the Top bar picker showing the referenced palette entry active and Custom inactive', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Top bar color');

    const swatch = getPaletteSwatch(dialog, 'Primary');
    expect(swatch.className).toContain('ring-2');

    const customInput = getCustomColorInput(dialog);
    expect(customInput.value).toBe('#ff6d00');
    expect(customInput.parentElement?.className).not.toContain('ring-2');
  });

  it('Top bar: selecting a different palette swatch saves the reference and shows its name on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).palette).toHaveLength(2);
    });

    const colorInputs = paletteCard.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[1], { target: { value: '#00ff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).palette[1].color).toBe('#00ff00');
    });
    const secondEntry = (await getStoredSettings()).palette[1];

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.click(getPaletteSwatch(dialog, secondEntry.name));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.topBarPaletteId).toBe(secondEntry.id);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain(secondEntry.name);
  });

  it('Top bar: changing the Custom color in the picker clears the palette reference and shows the hex on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.topBarPaletteId).toBeNull();
      expect(stored.topBarColor).toBe('#654321');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#654321');
  });

  it('Platform Bar: changing the Custom color in the picker clears the palette reference', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#101010' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.platformBarPaletteId).toBeNull();
      expect(stored.platformBarColor).toBe('#101010');
    });
  });

  it('Platform Bar text color: selecting a palette entry via the picker saves the reference and shows its name on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarTextPaletteId).toBe('default');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('Primary');
  });

  it('updates the trigger swatch color of referencing items when a palette entry color changes (not one-shot)', async () => {
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const paletteColorInput = getColorInput(getCard('Color palette'));
    fireEvent.change(paletteColorInput, { target: { value: '#123456' } });

    await waitFor(() => {
      expect(hexOrRgb('#123456')).toContain(getTriggerSwatch('Top bar color').style.backgroundColor);
    });
    // The trigger label still shows the palette entry's name, not the hex, since the reference is unchanged.
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');

    const stored = await getStoredSettings();
    expect(stored.topBarColor).toBe('#ff6d00');
    expect(stored.palette[0].color).toBe('#123456');
  });

  it('adds a new palette entry via the "Add color" icon button and exposes it in the picker', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.palette).toHaveLength(2);
      expect(stored.palette[1].name).toBe('Color 2');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, 'Color 2')).toBeTruthy();
  });

  it('adds multiple palette entries with sequential default names', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton);
    await user.click(addButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.palette.map((e) => e.name)).toEqual(['Primary', 'Color 2', 'Color 3']);
    });
  });

  it("saves a palette entry's name edit to storage", async () => {
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Brand' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.palette[0].name).toBe('Brand');
    });
  });

  it("saves a palette entry's color edit to storage", async () => {
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    fireEvent.change(getColorInput(getCard('Color palette')), { target: { value: '#a1b2c3' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.palette[0].color).toBe('#a1b2c3');
    });
  });

  it('removing a non-referenced palette entry (icon button) does not affect other entries or references', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).palette).toHaveLength(2);
    });

    // "default" (Primary) is referenced by Top bar and Platform Bar; remove the second, unreferenced entry.
    const removeButtons = within(paletteCard).getAllByRole('button', { name: 'Remove color' });
    await user.click(removeButtons[1]);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.palette).toHaveLength(1);
      expect(stored.palette[0].id).toBe('default');
      expect(stored.topBarPaletteId).toBe('default');
      expect(stored.platformBarPaletteId).toBe('default');
    });
  });

  it('shows "(unnamed)" as the swatch label in the picker for a palette entry with an empty name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).palette[0].name).toBe('');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, '(unnamed)')).toBeTruthy();
  });

  it('hides the Palette section and shows the own hex on the trigger when Color palette is turned off', async () => {
    const user = userEvent.setup();
    render(<App />);
    const paletteSwitch = await screen.findByRole('switch', { name: 'Color palette' });

    await user.click(paletteSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).paletteEnabled).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#ff6d00');

    const dialog = await openPicker(user, 'Top bar color');
    expect(within(dialog).queryByText('Palette')).toBeNull();
    expect(getCustomColorInput(dialog)).toBeTruthy();
  });

  it('keeps palette data and references in storage when turned off, and restores the trigger name when turned back on', async () => {
    const user = userEvent.setup();
    render(<App />);
    const paletteSwitch = await screen.findByRole('switch', { name: 'Color palette' });

    await user.click(paletteSwitch);
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.paletteEnabled).toBe(false);
      expect(stored.palette).toHaveLength(1);
      expect(stored.topBarPaletteId).toBe('default');
    });

    await user.click(screen.getByRole('switch', { name: 'Color palette' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).paletteEnabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
  });

  it('falls back a referencing item to Custom when its referenced palette entry is removed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const paletteCard = getCard('Color palette');
    const removeButton = within(paletteCard).getByRole('button', { name: 'Remove color' });
    await user.click(removeButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.topBarPaletteId).toBeNull();
      expect(stored.platformBarPaletteId).toBeNull();
      expect(stored.palette).toHaveLength(0);
    });

    const dialog = await openPicker(user, 'Top bar color');
    // No palette entries left, so only the Custom section is shown.
    expect(within(dialog).queryByText('Palette')).toBeNull();

    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#777777' } });
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.topBarColor).toBe('#777777');
    });
  });

  it('Platform Bar text color: the picker shows an Auto option, inactive, with Custom active by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Platform Bar text color');

    const autoButton = getAutoButton(dialog);
    expect(autoButton.className).not.toContain('ring-2');

    const customInput = getCustomColorInput(dialog);
    expect(customInput.parentElement?.className).toContain('ring-2');
  });

  it('Platform Bar text color: selecting Auto saves platformBarTextAuto and the trigger shows "Auto"', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));

    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarTextAuto).toBe(true);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toBe('Auto');
  });

  it('Platform Bar text color: the auto-computed swatch color follows the Platform Bar background (not one-shot)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#000080' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarColor).toBe('#000080');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#ffffff')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#ffff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarColor).toBe('#ffff00');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#000000')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });
  });

  it('Platform Bar text color: selecting a palette entry clears Auto', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.platformBarTextAuto).toBe(false);
      expect(stored.platformBarTextPaletteId).toBe('default');
    });
  });

  it('Platform Bar text color: changing the Custom color clears Auto', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#333333' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.platformBarTextAuto).toBe(false);
      expect(stored.platformBarTextColor).toBe('#333333');
      expect(stored.platformBarTextPaletteId).toBeNull();
    });
  });

  it('Top bar: Height input shows the default value and saves changes to storage', async () => {
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    expect(heightInput.value).toBe('4');

    fireEvent.change(heightInput, { target: { value: '10' } });

    await waitFor(async () => {
      expect((await getStoredSettings()).topBarHeight).toBe(10);
    });
  });

  it('Top bar: the Stripes switch toggles topBarStripes in storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const stripesSwitch = within(getCard('Top bar')).getByRole('switch', { name: 'Stripes' }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).topBarStripes).toBe(true);
    });
  });

  it('Platform Bar: the Stripes switch toggles platformBarStripes independently of Top bar Stripes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    const stripesSwitch = within(getCard('Platform Bar')).getByRole('switch', {
      name: 'Stripes',
    }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.platformBarStripes).toBe(true);
      expect(stored.topBarStripes).toBe(false);
    });
  });

  it('does not render a "Reset to defaults" button', async () => {
    render(<App />);
    await screen.findByRole('switch', { name: 'Color palette' });

    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull();
  });

  it('falls back to a single-entry palette and topBar/platformBar colors from the legacy tintColor string on mount', async () => {
    await fakeBrowser.storage.local.set({ tintColor: '#556677' });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    });
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
    expect(getColorInput(getCard('Color palette')).value).toBe('#556677');
  });

  it('reflects a partial stored settings object merged with defaults', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        topBarColor: '#123123',
        topBarPaletteId: null,
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#123123');
    });

    // Fields not present in the stored partial object fall back to defaults (still referencing "Primary").
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
  });
});
