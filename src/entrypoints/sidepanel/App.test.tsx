import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within, act } from '@testing-library/react';
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
  projectRules: ProjectRule[];
}

const CURRENT_VERSION = '0.1.0';

async function getStoredSettings(): Promise<StoredTintSettings> {
  const result = await fakeBrowser.storage.local.get('tintSettings');
  return result.tintSettings as StoredTintSettings;
}

// Flushes the microtask/task queue (wrapped in act()) so the async
// `browser.storage.local.get(...).then(...)` inside App's mount effect has a chance to
// resolve and apply before assertions run. Needed for tests that must prove something did
// NOT happen after load (e.g. discarded storage), where the "before load" and "after load"
// states would otherwise be indistinguishable without an explicit wait.
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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

// Rule rows are the only list-page elements with the native `draggable` attribute.
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

const TOP_INDICATOR = 'shadow-[inset_0_2px_0_0_var(--focus)]';
const BOTTOM_INDICATOR = 'shadow-[inset_0_-2px_0_0_var(--focus)]';

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
  it('shows an empty rule list with just the Add row by default (no Default row)', async () => {
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    expect(getAllRuleRows()).toHaveLength(0);
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0);
    expect(screen.getByLabelText('New rule pattern')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
  });

  it('places the Add row before the rule list, with a divider between them that is hidden while the list is empty and appears once a rule exists', async () => {
    const user = userEvent.setup();
    render(<App />);
    const addInput = await screen.findByLabelText('New rule pattern');

    // With zero rules there is nothing to separate, so no divider (border-t) container is
    // rendered below the Add row.
    const projectsCard = addInput.closest('.card') as HTMLElement;
    expect(projectsCard.querySelector('.border-t')).toBeNull();

    await addRule(user, 'my-project');

    // Document order: the Add row's Input precedes the rule row once one exists.
    const position = addInput.compareDocumentPosition(getRuleRow('my-project'));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The divider now separates the Add row from the rule list below it.
    expect(projectsCard.querySelector('.border-t')).toBeTruthy();
  });

  it('a freshly-added rule shows the palette entry and Top bar/Platform Bar triggers referencing it by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

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

  it("Add rule initializes the new rule's settings from the built-in DEFAULT_PROJECT_SETTINGS", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'my-project');

    const stored = await getStoredSettings();
    expect(stored.projectRules).toHaveLength(1);
    const settings = stored.projectRules[0].settings;
    expect(settings.topBarColor).toBe('#ff6d00');
    expect(settings.topBarPaletteId).toBe('default');
    expect(settings.topBarHeight).toBe(4);
    expect(settings.topBarStripes).toBe(false);
    expect(settings.palette).toEqual([{ id: 'default', name: 'Primary', color: '#ff6d00' }]);
  });

  it('opens the Top bar picker showing the referenced palette entry active and Custom inactive', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

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
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette).toHaveLength(2);
    });

    const colorInputs = paletteCard.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[1], { target: { value: '#00ff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette[1].color).toBe('#00ff00');
    });
    const secondEntry = (await getStoredSettings()).projectRules[0].settings.palette[1];

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.click(getPaletteSwatch(dialog, secondEntry.name));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.topBarPaletteId).toBe(secondEntry.id);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain(secondEntry.name);
  });

  it('Top bar: changing the Custom color in the picker clears the palette reference and shows the hex on the trigger', async () => {
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
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#654321');
  });

  it('Platform Bar: changing the Custom color in the picker clears the palette reference', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#101010' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.platformBarPaletteId).toBeNull();
      expect(stored.projectRules[0].settings.platformBarColor).toBe('#101010');
    });
  });

  it('Platform Bar text color: selecting a palette entry via the picker saves the reference and shows its name on the trigger', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextPaletteId).toBe('default');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('Primary');
  });

  it('a palette entry color change is reflected in the effective color of the same rule (not a one-shot copy)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteColorInput = getColorInput(getCard('Color palette'));
    fireEvent.change(paletteColorInput, { target: { value: '#123456' } });

    await waitFor(() => {
      expect(hexOrRgb('#123456')).toContain(getTriggerSwatch('Top bar color').style.backgroundColor);
    });
    // The trigger label still shows the palette entry's name, not the hex, since the reference is unchanged.
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');

    const stored = await getStoredSettings();
    expect(stored.projectRules[0].settings.topBarColor).toBe('#ff6d00');
    expect(stored.projectRules[0].settings.palette[0].color).toBe('#123456');
  });

  it('adds a new palette entry via the "Add color" icon button and exposes it in the picker', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.palette).toHaveLength(2);
      expect(stored.projectRules[0].settings.palette[1].name).toBe('Color 2');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, 'Color 2')).toBeTruthy();
  });

  it('adds multiple palette entries with sequential default names', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton);
    await user.click(addButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.palette.map((e) => e.name)).toEqual(['Primary', 'Color 2', 'Color 3']);
    });
  });

  it('names new entries as "Color ${length+1}" based on the current array length; this is current, not-a-bug-fix-target behavior, and it can produce a duplicate name after a middle entry is removed and a new one added', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton); // -> ['Primary', 'Color 2']
    await user.click(addButton); // -> ['Primary', 'Color 2', 'Color 3']
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette.map((e) => e.name)).toEqual([
        'Primary',
        'Color 2',
        'Color 3',
      ]);
    });

    // Remove the middle entry ("Color 2"), leaving ['Primary', 'Color 3'] (length 2).
    const removeButtons = within(getCard('Color palette')).getAllByRole('button', { name: 'Remove color' });
    await user.click(removeButtons[1]);
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette.map((e) => e.name)).toEqual([
        'Primary',
        'Color 3',
      ]);
    });

    // Adding again names the new entry from the current length (2 + 1 = "Color 3"), colliding
    // with the "Color 3" that was already there.
    await user.click(within(getCard('Color palette')).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette.map((e) => e.name)).toEqual([
        'Primary',
        'Color 3',
        'Color 3',
      ]);
    });
  });

  it("saves a palette entry's name edit to storage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Brand' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.palette[0].name).toBe('Brand');
    });
  });

  it("saves a palette entry's color edit to storage", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    fireEvent.change(getColorInput(getCard('Color palette')), { target: { value: '#a1b2c3' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.palette[0].color).toBe('#a1b2c3');
    });
  });

  it('removing a non-referenced palette entry (icon button) does not affect other entries or references', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette).toHaveLength(2);
    });

    // "default" (Primary) is referenced by Top bar and Platform Bar; remove the second, unreferenced entry.
    const removeButtons = within(paletteCard).getAllByRole('button', { name: 'Remove color' });
    await user.click(removeButtons[1]);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      const settings = stored.projectRules[0].settings;
      expect(settings.palette).toHaveLength(1);
      expect(settings.palette[0].id).toBe('default');
      expect(settings.topBarPaletteId).toBe('default');
      expect(settings.platformBarPaletteId).toBe('default');
    });
  });

  it('removing a palette entry clears its reference within the same rule only, leaving other rules unaffected', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'alpha');
    await addRule(user, 'beta');
    await openRuleDetail(user, 'alpha');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Remove color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      const alpha = stored.projectRules.find((r) => r.pattern === 'alpha')!;
      const beta = stored.projectRules.find((r) => r.pattern === 'beta')!;
      expect(alpha.settings.palette).toHaveLength(0);
      expect(alpha.settings.topBarPaletteId).toBeNull();
      expect(alpha.settings.platformBarPaletteId).toBeNull();
      // The other rule's own palette entry and references are untouched.
      expect(beta.settings.palette).toHaveLength(1);
      expect(beta.settings.topBarPaletteId).toBe('default');
      expect(beta.settings.platformBarPaletteId).toBe('default');
    });
  });

  it('removing a palette entry also clears its reference from platformBarTextPaletteId (the third referencing field, alongside topBarPaletteId and platformBarPaletteId)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    // Point Platform Bar text color at the "default" palette entry (it defaults to a Custom hex).
    const textDialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(textDialog, 'Primary'));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextPaletteId).toBe('default');
    });
    await closePicker(user);

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Remove color' }));

    await waitFor(async () => {
      const settings = (await getStoredSettings()).projectRules[0].settings;
      expect(settings.platformBarTextPaletteId).toBeNull();
      expect(settings.topBarPaletteId).toBeNull();
      expect(settings.platformBarPaletteId).toBeNull();
    });
  });

  it("a rule's palette is independent: adding a palette entry to one rule does not affect another rule's palette", async () => {
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
  });

  it('shows "(unnamed)" as the swatch label in the picker for a palette entry with an empty name', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.palette[0].name).toBe('');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, '(unnamed)')).toBeTruthy();
  });

  it('hides the Palette section and shows the own hex on the trigger when Color palette is turned off', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.paletteEnabled).toBe(false);
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
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.paletteEnabled).toBe(false);
      expect(stored.projectRules[0].settings.palette).toHaveLength(1);
      expect(stored.projectRules[0].settings.topBarPaletteId).toBe('default');
    });

    await user.click(screen.getByRole('switch', { name: 'Color palette' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.paletteEnabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
  });

  it('falls back a referencing item to Custom when its referenced palette entry is removed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    const removeButton = within(paletteCard).getByRole('button', { name: 'Remove color' });
    await user.click(removeButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.topBarPaletteId).toBeNull();
      expect(stored.projectRules[0].settings.platformBarPaletteId).toBeNull();
      expect(stored.projectRules[0].settings.palette).toHaveLength(0);
    });

    const dialog = await openPicker(user, 'Top bar color');
    // No palette entries left, so only the Custom section is shown.
    expect(within(dialog).queryByText('Palette')).toBeNull();

    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#777777' } });
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.topBarColor).toBe('#777777');
    });
  });

  it('Platform Bar text color: the picker shows an Auto option, inactive, with Custom active by default', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

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
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextAuto).toBe(true);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toBe('Auto');
  });

  it('Platform Bar text color: the auto-computed swatch color follows the Platform Bar background (not one-shot)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#000080' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarColor).toBe('#000080');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#ffffff')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#ffff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarColor).toBe('#ffff00');
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
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.platformBarTextAuto).toBe(false);
      expect(stored.projectRules[0].settings.platformBarTextPaletteId).toBe('default');
    });
  });

  it('Platform Bar text color: changing the Custom color clears Auto', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.platformBarTextAuto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#333333' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.platformBarTextAuto).toBe(false);
      expect(stored.projectRules[0].settings.platformBarTextColor).toBe('#333333');
      expect(stored.projectRules[0].settings.platformBarTextPaletteId).toBeNull();
    });
  });

  it('Top bar: Height input shows the default value and saves changes to storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    expect(heightInput.value).toBe('4');

    fireEvent.change(heightInput, { target: { value: '10' } });

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.topBarHeight).toBe(10);
    });
  });

  it('emptying the Top bar Height input is ignored: the previous valid value is kept in storage (valueAsNumber is NaN for an empty number input, which fails the Number.isFinite guard)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    fireEvent.change(heightInput, { target: { value: '15' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.topBarHeight).toBe(15);
    });

    fireEvent.change(heightInput, { target: { value: '' } });

    // No save happens for the empty value, so the last valid value remains in storage.
    expect((await getStoredSettings()).projectRules[0].settings.topBarHeight).toBe(15);
  });

  it('Top bar: the Stripes switch toggles topBarStripes in storage', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const stripesSwitch = within(getCard('Top bar')).getByRole('switch', { name: 'Stripes' }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0].settings.topBarStripes).toBe(true);
    });
  });

  it('Platform Bar: the Stripes switch toggles platformBarStripes independently of Top bar Stripes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const stripesSwitch = within(getCard('Platform Bar')).getByRole('switch', {
      name: 'Stripes',
    }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0].settings.platformBarStripes).toBe(true);
      expect(stored.projectRules[0].settings.topBarStripes).toBe(false);
    });
  });

  it('wraps every icon-only button (Edit/Duplicate/Delete/Add rule/Back/Remove color/Add color) in a HeroUI Tooltip.Trigger with a single Tab stop (the button itself, not the trigger wrapper)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    await addRule(user, 'my-project');

    // HeroUI's Tooltip.Trigger renders an actual wrapping element marked
    // data-slot="tooltip-trigger" around its child (confirmed by inspecting the rendered DOM),
    // and that wrapper is itself focusable (tabIndex 0) by default so tooltips also work on
    // non-interactive children. Since every child here is an already-focusable Button, App.tsx
    // passes tabIndex={-1} to each Tooltip.Trigger to remove the wrapper from the Tab order,
    // leaving the button as the page's only Tab stop for that control.
    function expectSingleTabStop(button: HTMLElement) {
      const wrapper = button.closest('[data-slot="tooltip-trigger"]') as HTMLElement | null;
      expect(wrapper).toBeTruthy();
      expect(wrapper!.tabIndex).toBe(-1);
      expect(button.tabIndex).toBe(0);
    }

    // List page: Edit / Duplicate / Delete on the rule row, plus Add rule.
    const row = getRuleRow('my-project');
    for (const label of ['Edit', 'Duplicate', 'Delete']) {
      expectSingleTabStop(within(row).getByRole('button', { name: label }));
    }
    expectSingleTabStop(screen.getByRole('button', { name: 'Add rule' }));

    // Detail page: Back, Remove color, Add color.
    await openRuleDetail(user, 'my-project');
    expectSingleTabStop(screen.getByRole('button', { name: 'Back' }));
    expectSingleTabStop(screen.getByRole('button', { name: 'Remove color' }));
    expectSingleTabStop(screen.getByRole('button', { name: 'Add color' }));
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
        projectRules: [
          { id: 'r1', pattern: 'my-project', settings: { topBarColor: '#123123', topBarPaletteId: null } },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('my-project');
    await openRuleDetail(user, 'my-project');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#123123');
    });
    // Fields not present in the stored partial object fall back to defaults (still referencing "Primary").
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
  });

  it('discards stored data with no schemaVersion (old flat v1 shape) and applies fresh (empty) defaults on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        projectRules: [{ id: 'r1', pattern: 'should-not-appear', settings: { topBarColor: '#334455' } }],
      },
    });

    render(<App />);
    await flush();

    expect(screen.queryByText('should-not-appear')).toBeNull();
    expect(getAllRuleRows()).toHaveLength(0);
  });

  it('reads stored data whose schemaVersion equals SCHEMA_MIN_VERSION on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        projectRules: [
          { id: 'r1', pattern: 'my-project', settings: { topBarColor: '#334455', topBarPaletteId: null } },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('my-project');
    await openRuleDetail(user, 'my-project');

    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#334455');
  });

  it('reads stored data whose schemaVersion is newer than the current version as-is on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '9.9.9',
        projectRules: [
          { id: 'r1', pattern: 'my-project', settings: { topBarColor: '#334455', topBarPaletteId: null } },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('my-project');
    await openRuleDetail(user, 'my-project');

    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#334455');
  });

  it('discards stored data whose schemaVersion is missing, non-string, or below SCHEMA_MIN_VERSION on mount', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.0.9',
        projectRules: [{ id: 'r1', pattern: 'should-not-appear', settings: { topBarColor: '#334455' } }],
      },
    });

    render(<App />);
    await flush();

    expect(screen.queryByText('should-not-appear')).toBeNull();
    expect(getAllRuleRows()).toHaveLength(0);
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

  it('loads settings once on mount; external storage changes made afterward are not reflected in the UI (no live storage.onChanged listener, unlike content.ts)', async () => {
    render(<App />);
    await screen.findByLabelText('New rule pattern');

    // Simulate another tab/window (or content.ts's own writes) changing storage after this
    // sidepanel instance has already completed its one-time load.
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: CURRENT_VERSION,
        projectRules: [{ id: 'external', pattern: 'from-elsewhere', settings: { topBarColor: '#334455' } }],
      },
    });

    // Give any (hypothetical) listener a chance to fire; App registers none, so nothing changes.
    await flush();

    expect(screen.queryByText('from-elsewhere')).toBeNull();
    expect(getAllRuleRows()).toHaveLength(0);
  });

  describe('Rules', () => {
    it('ignores adding an empty or whitespace-only pattern', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'existing-rule');

      const input = screen.getByLabelText('New rule pattern') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '   ' } });
      await user.click(screen.getByRole('button', { name: 'Add rule' }));

      expect((await getStoredSettings()).projectRules).toHaveLength(1);
      expect(getAllRuleRows()).toHaveLength(1);
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

    it('the Pattern field can be edited down to an empty string and saves it as-is, unlike Add rule which guards against empty (current behavior: no guard on edits, so an in-progress clear-and-retype is never blocked)', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'my-project');
      await openRuleDetail(user, 'my-project');

      const patternInput = screen.getByLabelText('Pattern') as HTMLInputElement;
      fireEvent.change(patternInput, { target: { value: '' } });

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0].pattern).toBe('');
      });
      // An empty string is a valid regular expression (it matches the empty position), so no
      // "Invalid regular expression" warning is shown for it.
      expect(screen.queryByText('Invalid regular expression')).toBeNull();
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

    it('dropping a row onto itself is a no-op: order and storage stay unchanged, and no drop indicator is shown', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');
      const before = (await getStoredSettings()).projectRules.map((r) => r.id);

      const alphaRow = getRuleRow('alpha');
      const grip = getGrip(alphaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(alphaRow, dt); // draggingIndex = 0
      fireEvent.dragOver(alphaRow, dt); // dragOverIndex = 0 === draggingIndex -> no indicator
      expect(alphaRow.className).not.toContain('var(--focus)');

      fireEvent.drop(alphaRow, dt);
      fireEvent.dragEnd(alphaRow, dt);

      expect((await getStoredSettings()).projectRules.map((r) => r.id)).toEqual(before);
      expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'beta']);
    });

    it('shows a bottom-edge drop indicator on the target row when dragging downward (dragOverIndex > draggingIndex)', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      const alphaRow = getRuleRow('alpha'); // index 0
      const betaRow = getRuleRow('beta'); // index 1
      const grip = getGrip(alphaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(alphaRow, dt); // draggingIndex = 0
      fireEvent.dragOver(betaRow, dt); // dragOverIndex = 1 (> 0) -> downward -> bottom line on beta

      expect(betaRow.className).toContain(BOTTOM_INDICATOR);
      expect(betaRow.className).not.toContain(TOP_INDICATOR);
      // The dragged row itself never shows an indicator.
      expect(alphaRow.className).not.toContain('var(--focus)');
    });

    it('shows a top-edge drop indicator on the target row when dragging upward (dragOverIndex < draggingIndex)', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      const alphaRow = getRuleRow('alpha'); // index 0
      const betaRow = getRuleRow('beta'); // index 1
      const grip = getGrip(betaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(betaRow, dt); // draggingIndex = 1
      fireEvent.dragOver(alphaRow, dt); // dragOverIndex = 0 (< 1) -> upward -> top line on alpha

      expect(alphaRow.className).toContain(TOP_INDICATOR);
      expect(alphaRow.className).not.toContain(BOTTOM_INDICATOR);
      expect(betaRow.className).not.toContain('var(--focus)');
    });

    it('clears the drop indicator once the drop is handled', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      const alphaRow = getRuleRow('alpha');
      const betaRow = getRuleRow('beta');
      const grip = getGrip(alphaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(alphaRow, dt);
      fireEvent.dragOver(betaRow, dt);
      expect(betaRow.className).toContain(BOTTOM_INDICATOR);

      fireEvent.drop(betaRow, dt);
      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['beta', 'alpha']);
      });
      // Rows are recreated post-reorder; re-fetch and confirm neither shows an indicator.
      expect(getRuleRow('alpha').className).not.toContain('var(--focus)');
      expect(getRuleRow('beta').className).not.toContain('var(--focus)');
    });

    it('clears the drop indicator on dragEnd even when the drag ends outside any row (e.g. dropped outside the list)', async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      const alphaRow = getRuleRow('alpha');
      const betaRow = getRuleRow('beta');
      const grip = getGrip(alphaRow);
      const dt = makeDataTransferInit();

      fireEvent.mouseDown(grip);
      fireEvent.dragStart(alphaRow, dt);
      fireEvent.dragOver(betaRow, dt);
      expect(betaRow.className).toContain(BOTTOM_INDICATOR);

      // dragEnd without a preceding drop, as happens when the drag is released outside the list.
      fireEvent.dragEnd(alphaRow, dt);

      expect(getRuleRow('beta').className).not.toContain('var(--focus)');
      // Cancelling the drag (no drop) must not reorder anything: handleRowDrop, which is the
      // only place that calls save() with a reordered array, was never invoked.
      expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'beta']);
    });

    it("editing a rule's settings in detail saves to that rule only, without affecting other rules", async () => {
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
    });

    it("a Top bar Custom color change while editing a rule saves to that rule's settings only", async () => {
      const user = userEvent.setup();
      render(<App />);
      await screen.findByLabelText('New rule pattern');

      await addRule(user, 'alpha');
      await addRule(user, 'beta');
      await openRuleDetail(user, 'alpha');

      const dialog = await openPicker(user, 'Top bar color');
      fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

      await waitFor(async () => {
        const stored = await getStoredSettings();
        const alpha = stored.projectRules.find((r) => r.pattern === 'alpha')!;
        const beta = stored.projectRules.find((r) => r.pattern === 'beta')!;
        expect(alpha.settings.topBarPaletteId).toBeNull();
        expect(alpha.settings.topBarColor).toBe('#654321');
        // The other rule keeps its own default reference untouched.
        expect(beta.settings.topBarPaletteId).toBe('default');
      });
    });
  });
});
