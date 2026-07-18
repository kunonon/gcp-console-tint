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

interface ProjectSettings {
  paletteEnabled: boolean;
  palette: PaletteEntry[];
  topBarEnabled: boolean;
  topBarColor: string;
  topBarPaletteId: string | null;
  topBarHeight: number;
  topBarStripes: boolean;
  platformBarEnabled: boolean;
  platformBarColor: string;
  platformBarPaletteId: string | null;
  platformBarStripes: boolean;
  platformBarTextEnabled: boolean;
  platformBarTextColor: string;
  platformBarTextPaletteId: string | null;
  platformBarTextAuto: boolean;
}

interface ProjectRule {
  id: string;
  pattern: string;
  settings: ProjectSettings;
}

interface StoredTintSettings {
  schemaVersion: string;
  defaultProject: ProjectSettings;
  projectRules: ProjectRule[];
}

const CURRENT_VERSION = '0.1.0';

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

// Rule rows are the only list-page elements with the native `draggable` attribute, which
// distinguishes them from the (non-draggable) Default row.
function getAllRuleRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[draggable="true"]')) as HTMLElement[];
}

function getRuleRowAt(index: number): HTMLElement {
  const row = getAllRuleRows()[index];
  if (!row) throw new Error(`rule row not found at index ${index}`);
  return row;
}

// Only usable when `pattern` is unique among currently-rendered rows (e.g. not right after a
// Duplicate, when two rows briefly share the same pattern text); use getRuleRowAt for those.
function getRuleRow(pattern: string): HTMLElement {
  const label = screen.getByText(pattern);
  const row = label.closest('[draggable="true"]');
  if (!row) throw new Error(`rule row not found for pattern "${pattern}"`);
  return row as HTMLElement;
}

function getGrip(row: HTMLElement): HTMLElement {
  const grip = row.querySelector('span[aria-hidden="true"]');
  if (!grip) throw new Error('grip handle not found in row');
  return grip as HTMLElement;
}

function getDefaultRow(): HTMLElement {
  const label = screen.getByText('Default');
  const row = label.closest('div');
  if (!row) throw new Error('Default row not found');
  return row as HTMLElement;
}

async function addRule(user: ReturnType<typeof userEvent.setup>, pattern: string) {
  const input = screen.getByLabelText('New rule pattern') as HTMLInputElement;
  fireEvent.change(input, { target: { value: pattern } });
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  await waitFor(async () => {
    expect((await getStoredSettings()).projectRules.some((r) => r.pattern === pattern)).toBe(true);
  });
}

async function openRuleDetail(user: ReturnType<typeof userEvent.setup>, pattern: string) {
  await user.click(within(getRuleRow(pattern)).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Back' });
}

async function openRuleDetailAt(user: ReturnType<typeof userEvent.setup>, index: number) {
  await user.click(within(getRuleRowAt(index)).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Back' });
}

async function openDefaultDetail(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(getDefaultRow()).getByRole('button', { name: 'Edit' }));
  await screen.findByRole('button', { name: 'Back' });
}

async function goBack(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
}

function makeDataTransferInit() {
  const store: Record<string, string> = {};
  return {
    dataTransfer: {
      setData: (format: string, data: string) => {
        store[format] = data;
      },
      getData: (format: string) => store[format] ?? '',
      effectAllowed: '',
      dropEffect: '',
    },
  };
}

beforeEach(() => {
  fakeBrowser.reset();
  // @webext-core/fake-browser leaves runtime.getManifest() as an unimplemented stub that
  // throws; App.tsx calls it unconditionally (on load, to compare schemaVersion, and on
  // every save, to stamp it), so tests shim it here to return a fixed current version.
  (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({
    version: CURRENT_VERSION,
  });
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('shows default state: on the list page just the Default row and Add row; the Default detail page shows the palette entry and Top bar/Platform Bar triggers referencing it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    expect(getAllRuleRows()).toHaveLength(0);
    expect(getDefaultRow()).toBeTruthy();

    await openDefaultDetail(user);

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' }) as HTMLInputElement;
    expect(paletteSwitch.checked).toBe(true);

    const paletteCard = getCard('Color palette');
    const nameInputs = within(paletteCard).getAllByLabelText('Color name') as HTMLInputElement[];
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0].value).toBe('Primary');

    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('#ffffff');
  });

  it('shows an empty rule list with just the Default row and the Add row by default', async () => {
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    expect(getAllRuleRows()).toHaveLength(0);
    expect(getDefaultRow()).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getByLabelText('New rule pattern')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
  });

  it('opens the Top bar picker showing the referenced palette entry active and Custom inactive', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

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
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.palette).toHaveLength(2);
    });

    const colorInputs = paletteCard.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[1], { target: { value: '#00ff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.palette[1].color).toBe('#00ff00');
    });
    const secondEntry = (await getStoredSettings()).defaultProject.palette[1];

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.click(getPaletteSwatch(dialog, secondEntry.name));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.topBarPaletteId).toBe(secondEntry.id);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain(secondEntry.name);
  });

  it('Top bar: changing the Custom color in the picker clears the palette reference and shows the hex on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.topBarPaletteId).toBeNull();
      expect(stored.defaultProject.topBarColor).toBe('#654321');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#654321');
  });

  it('Platform Bar: changing the Custom color in the picker clears the palette reference', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#101010' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.platformBarPaletteId).toBeNull();
      expect(stored.defaultProject.platformBarColor).toBe('#101010');
    });
  });

  it('Platform Bar text color: selecting a palette entry via the picker saves the reference and shows its name on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarTextPaletteId).toBe('default');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('Primary');
  });

  it('a palette entry color change is reflected in the effective color of the same project (not a one-shot copy)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteColorInput = getColorInput(getCard('Color palette'));
    fireEvent.change(paletteColorInput, { target: { value: '#123456' } });

    await waitFor(() => {
      expect(hexOrRgb('#123456')).toContain(getTriggerSwatch('Top bar color').style.backgroundColor);
    });
    // The trigger label still shows the palette entry's name, not the hex, since the reference is unchanged.
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');

    const stored = await getStoredSettings();
    expect(stored.defaultProject.topBarColor).toBe('#ff6d00');
    expect(stored.defaultProject.palette[0].color).toBe('#123456');
  });

  it('adds a new palette entry via the "Add color" icon button and exposes it in the picker', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.palette).toHaveLength(2);
      expect(stored.defaultProject.palette[1].name).toBe('Color 2');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, 'Color 2')).toBeTruthy();
  });

  it('adds multiple palette entries with sequential default names', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton);
    await user.click(addButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.palette.map((e) => e.name)).toEqual(['Primary', 'Color 2', 'Color 3']);
    });
  });

  it("saves a palette entry's name edit to storage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Brand' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.palette[0].name).toBe('Brand');
    });
  });

  it("saves a palette entry's color edit to storage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    fireEvent.change(getColorInput(getCard('Color palette')), { target: { value: '#a1b2c3' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.palette[0].color).toBe('#a1b2c3');
    });
  });

  it('removing a non-referenced palette entry (icon button) does not affect other entries or references', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.palette).toHaveLength(2);
    });

    // "default" (Primary) is referenced by Top bar and Platform Bar; remove the second, unreferenced entry.
    const removeButtons = within(paletteCard).getAllByRole('button', { name: 'Remove color' });
    await user.click(removeButtons[1]);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.palette).toHaveLength(1);
      expect(stored.defaultProject.palette[0].id).toBe('default');
      expect(stored.defaultProject.topBarPaletteId).toBe('default');
      expect(stored.defaultProject.platformBarPaletteId).toBe('default');
    });
  });

  it('removing a palette entry clears its reference within the same project only, leaving other rules and Default unaffected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    // "my-project" is cloned from defaultProject (via cloneProjectSettings), so it starts out
    // with its own independent copy of the palette, still referencing "default".
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Remove color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      const rule = stored.projectRules.find((r) => r.pattern === 'my-project')!;
      expect(rule.settings.palette).toHaveLength(0);
      expect(rule.settings.topBarPaletteId).toBeNull();
      expect(rule.settings.platformBarPaletteId).toBeNull();
      // Default's own palette entry and references are untouched.
      expect(stored.defaultProject.palette).toHaveLength(1);
      expect(stored.defaultProject.topBarPaletteId).toBe('default');
      expect(stored.defaultProject.platformBarPaletteId).toBe('default');
    });
  });

  it("a rule's palette is independent: adding a palette entry to one rule does not affect another rule's or Default's palette", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'alpha');
    await addRule(user, 'beta');

    await openRuleDetail(user, 'alpha');
    await user.click(within(getCard('Color palette')).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      const rules = (await getStoredSettings()).projectRules;
      expect(rules.find((r) => r.pattern === 'alpha')!.settings.palette).toHaveLength(2);
    });

    const stored = await getStoredSettings();
    expect(stored.projectRules.find((r) => r.pattern === 'beta')!.settings.palette).toHaveLength(1);
    expect(stored.defaultProject.palette).toHaveLength(1);
  });

  it('shows "(unnamed)" as the swatch label in the picker for a palette entry with an empty name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.palette[0].name).toBe('');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, '(unnamed)')).toBeTruthy();
  });

  it('hides the Palette section and shows the own hex on the trigger when Color palette is turned off', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.paletteEnabled).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#ff6d00');

    const dialog = await openPicker(user, 'Top bar color');
    expect(within(dialog).queryByText('Palette')).toBeNull();
    expect(getCustomColorInput(dialog)).toBeTruthy();
  });

  it('keeps palette data and references in storage when turned off, and restores the trigger name when turned back on', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.paletteEnabled).toBe(false);
      expect(stored.defaultProject.palette).toHaveLength(1);
      expect(stored.defaultProject.topBarPaletteId).toBe('default');
    });

    await user.click(screen.getByRole('switch', { name: 'Color palette' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.paletteEnabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
  });

  it('falls back a referencing item to Custom when its referenced palette entry is removed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const paletteCard = getCard('Color palette');
    const removeButton = within(paletteCard).getByRole('button', { name: 'Remove color' });
    await user.click(removeButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.topBarPaletteId).toBeNull();
      expect(stored.defaultProject.platformBarPaletteId).toBeNull();
      expect(stored.defaultProject.palette).toHaveLength(0);
    });

    const dialog = await openPicker(user, 'Top bar color');
    // No palette entries left, so only the Custom section is shown.
    expect(within(dialog).queryByText('Palette')).toBeNull();

    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#777777' } });
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.topBarColor).toBe('#777777');
    });
  });

  it('Platform Bar text color: the picker shows an Auto option, inactive, with Custom active by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const dialog = await openPicker(user, 'Platform Bar text color');

    const autoButton = getAutoButton(dialog);
    expect(autoButton.className).not.toContain('ring-2');

    const customInput = getCustomColorInput(dialog);
    expect(customInput.parentElement?.className).toContain('ring-2');
  });

  it('Platform Bar text color: selecting Auto saves platformBarTextAuto and the trigger shows "Auto"', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));

    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarTextAuto).toBe(true);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toBe('Auto');
  });

  it('Platform Bar text color: the auto-computed swatch color follows the Platform Bar background (not one-shot)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#000080' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarColor).toBe('#000080');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#ffffff')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#ffff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarColor).toBe('#ffff00');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#000000')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });
  });

  it('Platform Bar text color: selecting a palette entry clears Auto', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.platformBarTextAuto).toBe(false);
      expect(stored.defaultProject.platformBarTextPaletteId).toBe('default');
    });
  });

  it('Platform Bar text color: changing the Custom color clears Auto', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#333333' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.platformBarTextAuto).toBe(false);
      expect(stored.defaultProject.platformBarTextColor).toBe('#333333');
      expect(stored.defaultProject.platformBarTextPaletteId).toBeNull();
    });
  });

  it('Top bar: Height input shows the default value and saves changes to storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    expect(heightInput.value).toBe('4');

    fireEvent.change(heightInput, { target: { value: '10' } });

    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.topBarHeight).toBe(10);
    });
  });

  it('Top bar: the Stripes switch toggles topBarStripes in storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const stripesSwitch = within(getCard('Top bar')).getByRole('switch', { name: 'Stripes' }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).defaultProject.topBarStripes).toBe(true);
    });
  });

  it('Platform Bar: the Stripes switch toggles platformBarStripes independently of Top bar Stripes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await openDefaultDetail(user);

    const stripesSwitch = within(getCard('Platform Bar')).getByRole('switch', {
      name: 'Stripes',
    }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.defaultProject.platformBarStripes).toBe(true);
      expect(stored.defaultProject.topBarStripes).toBe(false);
    });
  });

  it('does not render a "Reset to defaults" button', async () => {
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull();
  });

  it('reflects a partial stored settings object merged with defaults', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        defaultProject: {
          topBarColor: '#123123',
          topBarPaletteId: null,
        },
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await openDefaultDetail(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#123123');
    });
    // Fields not present in the stored partial object fall back to defaults (still referencing "Primary").
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
  });

  it('discards stored data with no schemaVersion (old flat v1 shape) and applies defaults on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        topBarEnabled: true,
        topBarPaletteId: null,
        topBarColor: '#334455',
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await openDefaultDetail(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    });
  });

  it('reads stored data whose schemaVersion equals SCHEMA_MIN_VERSION on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        defaultProject: { topBarColor: '#334455', topBarPaletteId: null },
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await openDefaultDetail(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#334455');
    });
  });

  it('reads stored data whose schemaVersion is newer than the current version as-is on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '9.9.9',
        defaultProject: { topBarColor: '#334455', topBarPaletteId: null },
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await openDefaultDetail(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#334455');
    });
  });

  it('discards stored data whose schemaVersion is missing, non-string, or below SCHEMA_MIN_VERSION on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.0.9',
        defaultProject: { topBarColor: '#334455', topBarPaletteId: null },
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await openDefaultDetail(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    });
  });

  it('stamps the current version as schemaVersion whenever settings are saved', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'my-project');

    await waitFor(async () => {
      expect((await getStoredSettings()).schemaVersion).toBe(CURRENT_VERSION);
    });
  });

  describe('Rules', () => {
    it('Add rule appends a new rule initialized as a deep copy of defaultProject, at the end of the list, and stays on the list page', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      // Diverge defaultProject from the built-in defaults first, to prove the copy is a snapshot.
      await openDefaultDetail(user);
      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '20' } });
      await waitFor(async () => {
        expect((await getStoredSettings()).defaultProject.topBarHeight).toBe(20);
      });
      await goBack(user);

      await addRule(user, 'my-project');

      const stored = await getStoredSettings();
      expect(stored.projectRules).toHaveLength(1);
      expect(stored.projectRules[0].pattern).toBe('my-project');
      expect(stored.projectRules[0].settings).toEqual(stored.defaultProject);

      // Adding does not navigate away from the list.
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(getRuleRow('my-project')).toBeTruthy();
    });

    it('ignores adding an empty or whitespace-only pattern', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      const input = screen.getByLabelText('New rule pattern') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '   ' } });
      await user.click(screen.getByRole('button', { name: 'Add rule' }));

      // Perform an unrelated save first so getStoredSettings() has something to read.
      await openDefaultDetail(user);
      await user.click(within(getCard('Top bar')).getByRole('switch', { name: 'Stripes' }));
      await waitFor(async () => {
        expect((await getStoredSettings()).defaultProject.topBarStripes).toBe(true);
      });
      await goBack(user);

      expect((await getStoredSettings()).projectRules).toEqual([]);
      expect(getAllRuleRows()).toHaveLength(0);
    });

    it('allows adding multiple rules with the same pattern text, each with its own id (regex duplicates may be intentional)', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'same-pattern');
      await addRule(user, 'same-pattern');

      const stored = await getStoredSettings();
      expect(stored.projectRules.map((r) => r.pattern)).toEqual(['same-pattern', 'same-pattern']);
      expect(stored.projectRules[0].id).not.toBe(stored.projectRules[1].id);
    });

    it('Edit navigates to a rule detail page with a Pattern field; editing it saves and flags an invalid regex', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'my-project');
      await openRuleDetail(user, 'my-project');

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('my-project');
      expect(screen.queryByText('Invalid regular expression')).toBeNull();

      const patternInput = screen.getByLabelText('Pattern') as HTMLInputElement;
      fireEvent.change(patternInput, { target: { value: 'proj-[' } });

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0].pattern).toBe('proj-[');
      });
      expect(screen.getByText('Invalid regular expression')).toBeTruthy();

      await goBack(user);
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(getRuleRow('proj-[')).toBeTruthy();
    });

    it("Default row's Edit navigates to its detail page without a Pattern field, and edits save to defaultProject", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await openDefaultDetail(user);

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Default');
      expect(screen.queryByLabelText('Pattern')).toBeNull();

      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '9' } });
      await waitFor(async () => {
        expect((await getStoredSettings()).defaultProject.topBarHeight).toBe(9);
      });
    });

    it('Duplicate inserts a copy directly below the original with a new id, editable independently', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await user.click(within(getRuleRowAt(0)).getByRole('button', { name: 'Duplicate' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'alpha', 'beta']);
      });

      const [original, duplicate] = (await getStoredSettings()).projectRules;
      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.settings).toEqual(original.settings);

      // Editing the duplicate (index 1, the second "alpha" row) must not affect the original (index 0).
      await openRuleDetailAt(user, 1);
      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '22' } });
      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[1].settings.topBarHeight).toBe(22);
      });
      expect((await getStoredSettings()).projectRules[0].settings.topBarHeight).toBe(4);
    });

    it("Duplicate deep-copies the palette array (cloneProjectSettings): editing the duplicate's palette does not affect the original's", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await user.click(within(getRuleRowAt(0)).getByRole('button', { name: 'Duplicate' }));
      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules).toHaveLength(2);
      });

      // Edit the duplicate's (index 1) palette entry color.
      await openRuleDetailAt(user, 1);
      fireEvent.change(getColorInput(getCard('Color palette')), { target: { value: '#00ff00' } });
      await waitFor(async () => {
        const rules = (await getStoredSettings()).projectRules;
        expect(rules[1].settings.palette[0].color).toBe('#00ff00');
      });

      // The original (index 0) keeps its own, unaffected palette entry.
      const rules = (await getStoredSettings()).projectRules;
      expect(rules[0].settings.palette[0].color).toBe('#ff6d00');
    });

    it('Delete removes the rule from the list and storage', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await user.click(within(getRuleRow('alpha')).getByRole('button', { name: 'Delete' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['beta']);
      });
      expect(screen.queryByText('alpha')).toBeNull();
    });

    it('reorders rules via drag-and-drop from the grip handle, and persists the new order to storage', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');
      expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'beta']);

      const alphaRow = getRuleRow('alpha');
      const betaRow = getRuleRow('beta');
      const grip = getGrip(alphaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(alphaRow, dt);
      fireEvent.dragOver(betaRow, dt);
      fireEvent.drop(betaRow, dt);
      fireEvent.dragEnd(alphaRow, dt);

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['beta', 'alpha']);
      });
    });

    it('does not start a drag when the gesture does not originate on the grip handle', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      const alphaRow = getRuleRow('alpha');
      const betaRow = getRuleRow('beta');
      const dt = makeDataTransferInit();

      // No mousedown on the grip first: dragstart should be cancelled and no reorder should occur.
      fireEvent.dragStart(alphaRow, dt);
      fireEvent.dragOver(betaRow, dt);
      fireEvent.drop(betaRow, dt);

      expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'beta']);
    });

    it("editing a rule's settings in detail saves to that rule only, without affecting other rules or Default", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await openRuleDetail(user, 'alpha');
      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '11' } });
      await waitFor(async () => {
        const rules = (await getStoredSettings()).projectRules;
        expect(rules.find((r) => r.pattern === 'alpha')!.settings.topBarHeight).toBe(11);
      });
      await goBack(user);

      await openRuleDetail(user, 'beta');
      const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
      expect(heightInput.value).toBe('4');
      fireEvent.change(heightInput, { target: { value: '33' } });

      await waitFor(async () => {
        const rules = (await getStoredSettings()).projectRules;
        expect(rules.find((r) => r.pattern === 'beta')!.settings.topBarHeight).toBe(33);
        expect(rules.find((r) => r.pattern === 'alpha')!.settings.topBarHeight).toBe(11);
      });
      expect((await getStoredSettings()).defaultProject.topBarHeight).toBe(4);
    });

    it("a Top bar Custom color change while editing a rule saves to that rule's settings, not defaultProject", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'my-project');
      await openRuleDetail(user, 'my-project');

      const dialog = await openPicker(user, 'Top bar color');
      fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

      await waitFor(async () => {
        const stored = await getStoredSettings();
        expect(stored.projectRules[0].settings.topBarPaletteId).toBeNull();
        expect(stored.projectRules[0].settings.topBarColor).toBe('#654321');
        // defaultProject keeps its copied-from reference untouched.
        expect(stored.defaultProject.topBarPaletteId).toBe('default');
      });
    });
  });
});
