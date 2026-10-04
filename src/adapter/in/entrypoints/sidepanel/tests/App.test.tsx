import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ProjectRule as DomainProjectRule } from '../../../../../domain/project-rule';
import { TintSettings } from '../../../../../domain/tint-settings';
import { SettingsImportError } from '../../../../../port/settings-store';
import { SettingsStoreImpl } from '../../../../out/browser-settings-store';
import { effectiveSchemaVersion, toDomain } from '../../../../out/settings-repository';
import App from '../App';
import { MATCH_TYPE_LABELS } from '../components/MatchTypeSelect';

type MatchType = 'prefix' | 'suffix' | 'exact' | 'regex';

interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

interface ColorSelection {
  paletteId: string | null;
  custom: string;
}

interface PaletteSettings {
  enabled: boolean;
  entries: PaletteEntry[];
}

interface TopBarSettings {
  enabled: boolean;
  color: ColorSelection;
  height: number;
  stripes: boolean;
}

interface PlatformBarSettings {
  enabled: boolean;
  color: ColorSelection;
  stripes: boolean;
}

interface PlatformBarTextSettings {
  enabled: boolean;
  color: ColorSelection;
  auto: boolean;
}

interface ProjectSettings {
  palette: PaletteSettings;
  topBar: TopBarSettings;
  platformBar: PlatformBarSettings;
  platformBarText: PlatformBarTextSettings;
}

interface ProjectRule {
  id: string;
  matchType: MatchType;
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

// Opens a DeleteConfirmPopover by clicking its trigger button (e.g. a row's "Delete", or a
// palette entry's "Remove color") and returns the opened popover.
async function openDeleteConfirm(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement) {
  await user.click(trigger);
  return screen.findByRole('dialog');
}

// Opens the DeleteConfirmPopover from `trigger` and clicks its confirm action (labeled
// `confirmLabel`, e.g. "Delete" or "Remove"), waiting for the popover to close afterward.
async function confirmDelete(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, confirmLabel: string) {
  const popover = await openDeleteConfirm(user, trigger);
  await user.click(within(popover).getByRole('button', { name: confirmLabel }));
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

// Opens the Add rule modal via its trigger button (the [+] icon in the Projects card header)
// and returns the opened dialog.
async function openAddRuleModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add rule' }));
  return screen.findByRole('dialog');
}

// Adds a rule through the modal using its default match type (exact). Most tests only care that
// a rule with this pattern ends up in the list/storage; tests that need a specific match type use
// addRuleWithMatchType instead.
async function addRule(user: ReturnType<typeof userEvent.setup>, pattern: string) {
  const dialog = await openAddRuleModal(user);
  fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: pattern } });
  await user.click(within(dialog).getByRole('button', { name: 'Add' }));
  await waitFor(async () => {
    expect((await getStoredSettings()).projectRules.some((r) => r.pattern === pattern)).toBe(true);
  });
}

// Adds a rule through the modal with an explicit match type, selecting it via the shared
// MatchTypeSelect when it isn't the modal's default ('exact'). The value input's accessible
// label follows AddRuleModal's own convention: "Pattern" for regex, "Project ID" for the others.
async function addRuleWithMatchType(user: ReturnType<typeof userEvent.setup>, matchType: MatchType, pattern: string) {
  const dialog = await openAddRuleModal(user);
  if (matchType !== 'exact') {
    // The Select trigger's accessible name concatenates its aria-labelledby refs (the
    // currently-selected value's text, then the field's own "Match type" aria-label), so match
    // by substring rather than an exact string (see the equivalent detail-page tests below).
    await user.click(within(dialog).getByRole('button', { name: /Match type/ }));
    await user.click(await screen.findByRole('option', { name: MATCH_TYPE_LABELS[matchType] }));
  }
  const label = matchType === 'regex' ? 'Pattern' : 'Project ID';
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value: pattern } });
  await user.click(within(dialog).getByRole('button', { name: 'Add' }));
  await waitFor(async () => {
    const rule = (await getStoredSettings()).projectRules.find((r) => r.pattern === pattern);
    expect(rule?.matchType).toBe(matchType);
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

// Switches the list page from the default Rules tab to Settings, and waits for the Backup card.
async function openSettingsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Settings' }));
  return screen.findByRole('button', { name: 'Export' });
}

// The URL statics exactly as the environment provides them, captured before any test touches them:
// in this Vitest jsdom environment createObjectURL is URL's own static and revokeObjectURL is
// inherited, and both must look like that again after every test.
const URL_API = {
  createObjectURL: URL.createObjectURL,
  createObjectURLOwn: Object.hasOwn(URL, 'createObjectURL'),
  createObjectURLDescriptor: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: URL.revokeObjectURL,
  revokeObjectURLOwn: Object.hasOwn(URL, 'revokeObjectURL'),
  revokeObjectURLDescriptor: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  inheritedRevokeObjectURLDescriptor: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(URL), 'revokeObjectURL'),
};

// jsdom performs no real download, so Export's last two steps are spied on: the Blob handed to
// createObjectURL and the anchor that was clicked are captured for assertions. vi.spyOn (not
// assignment) is what lets the shared afterEach's vi.restoreAllMocks put the real methods back,
// which the URL restore check below verifies after every test.
function stubDownloads() {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((_blob) => 'blob:settings');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const clicks: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureClick(this: HTMLAnchorElement) {
    clicks.push(this);
  });
  return { createObjectURL, revokeObjectURL, clicks };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Picks a file in the Backup card's (visually hidden, but labelled) file input.
async function uploadSettingsFile(user: ReturnType<typeof userEvent.setup>, fileName: string, contents: string) {
  const input = screen.getByLabelText('Import settings file');
  await user.upload(input as HTMLInputElement, new File([contents], fileName, { type: 'application/json' }));
}

// An export file in the stored shape, built from real stored rules so it stays schema-valid.
function settingsFile(...projectRules: ProjectRule[]): string {
  return JSON.stringify({ schemaVersion: CURRENT_VERSION, projectRules } satisfies StoredTintSettings);
}

// Same match type and pattern as `rule` — so importing it replaces that rule rather than adding
// one — under a different id and with one visibly different setting.
function replacementFor(rule: ProjectRule, topBarHeight: number): ProjectRule {
  return {
    ...rule,
    id: 'file-alpha',
    settings: { ...rule.settings, topBar: { ...rule.settings.topBar, height: topBarHeight } },
  };
}

// A rule the current settings don't have, carrying an id the merge must not reuse.
function newRule(rule: ProjectRule, pattern: string): ProjectRule {
  return { ...rule, id: 'file-beta', pattern };
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

// Registered before the shared afterEach on purpose: Vitest runs afterEach hooks in reverse
// registration order (sequence.hooks 'stack'), so this check runs after vi.restoreAllMocks.
afterEach(() => {
  expect(URL.createObjectURL).toBe(URL_API.createObjectURL);
  expect(Object.hasOwn(URL, 'createObjectURL')).toBe(URL_API.createObjectURLOwn);
  expect(Object.getOwnPropertyDescriptor(URL, 'createObjectURL')).toEqual(URL_API.createObjectURLDescriptor);
  expect(URL.revokeObjectURL).toBe(URL_API.revokeObjectURL);
  expect(Object.hasOwn(URL, 'revokeObjectURL')).toBe(URL_API.revokeObjectURLOwn);
  expect(Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')).toEqual(URL_API.revokeObjectURLDescriptor);
  expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(URL), 'revokeObjectURL')).toEqual(
    URL_API.inheritedRevokeObjectURLDescriptor,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows an empty rule list with just the Projects header (Add rule button) by default (no Default row)', async () => {
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    expect(getAllRuleRows()).toHaveLength(0);
    expect(screen.queryByText('Default')).toBeNull();
    expect(screen.queryAllByRole('button', { name: 'Edit' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
  });

  it('places the Projects header row before the rule list, with a divider between them that is hidden while the list is empty and appears once a rule exists', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    const addButton = await screen.findByRole('button', { name: 'Add rule' });

    // With zero rules there is nothing to separate, so no divider (border-t) container is
    // rendered below the header row.
    const projectsCard = addButton.closest('.card') as HTMLElement;
    expect(projectsCard.querySelector('.border-t')).toBeNull();

    await addRule(user, 'my-project');

    // Document order: the header row's Add button precedes the rule row once one exists.
    const position = addButton.compareDocumentPosition(getRuleRow('my-project'));
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The divider now separates the header row from the rule list below it.
    expect(projectsCard.querySelector('.border-t')).toBeTruthy();
  });

  it('a freshly-added rule shows the palette entry and Top bar/Platform Bar triggers referencing it by default', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' }) as HTMLInputElement;
    expect(paletteSwitch.checked).toBe(true);

    const paletteCard = getCard('Color palette');
    const nameInputs = within(paletteCard).getAllByLabelText('Color name') as HTMLInputElement[];
    expect(nameInputs).toHaveLength(1);
    expect(nameInputs[0]!.value).toBe('Primary');

    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar color' }).textContent).toContain('Primary');
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('#ffffff');
  });

  it("Add rule initializes the new rule's settings from the built-in ProjectSettings.DEFAULT", async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'my-project');

    const stored = await getStoredSettings();
    expect(stored.projectRules).toHaveLength(1);
    const settings = stored.projectRules[0]!.settings;
    expect(settings.topBar.color.custom).toBe('#ff6d00');
    expect(settings.topBar.color.paletteId).toBe('default');
    expect(settings.topBar.height).toBe(4);
    expect(settings.topBar.stripes).toBe(false);
    expect(settings.palette.entries).toEqual([{ id: 'default', name: 'Primary', color: '#ff6d00' }]);
  });

  it('opens the Top bar picker showing the referenced palette entry active and Custom inactive', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
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
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries).toHaveLength(2);
    });

    const colorInputs = paletteCard.querySelectorAll('input[type="color"]');
    fireEvent.change(colorInputs[1]!, { target: { value: '#00ff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries[1]!.color).toBe('#00ff00');
    });
    const secondEntry = (await getStoredSettings()).projectRules[0]!.settings.palette.entries[1]!;

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.click(getPaletteSwatch(dialog, secondEntry.name));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.topBar.color.paletteId).toBe(secondEntry.id);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain(secondEntry.name);
  });

  it('Top bar: changing the Custom color in the picker clears the palette reference and shows the hex on the trigger', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Top bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.topBar.color.paletteId).toBeNull();
      expect(stored.projectRules[0]!.settings.topBar.color.custom).toBe('#654321');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#654321');
  });

  it('Platform Bar: changing the Custom color in the picker clears the palette reference', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#101010' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.platformBar.color.paletteId).toBeNull();
      expect(stored.projectRules[0]!.settings.platformBar.color.custom).toBe('#101010');
    });
  });

  it('Platform Bar text color: selecting a palette entry via the picker saves the reference and shows its name on the trigger', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.color.paletteId).toBe('default');
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toContain('Primary');
  });

  it('a palette entry color change is reflected in the effective color of the same rule (not a one-shot copy)', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
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
    expect(stored.projectRules[0]!.settings.topBar.color.custom).toBe('#ff6d00');
    expect(stored.projectRules[0]!.settings.palette.entries[0]!.color).toBe('#123456');
  });

  it('adds a new palette entry via the "Add color" icon button and exposes it in the picker', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.palette.entries).toHaveLength(2);
      expect(stored.projectRules[0]!.settings.palette.entries[1]!.name).toBe('Color 2');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, 'Color 2')).toBeTruthy();
  });

  it('adds multiple palette entries with sequential default names', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton);
    await user.click(addButton);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.palette.entries.map((e) => e.name)).toEqual([
        'Primary',
        'Color 2',
        'Color 3',
      ]);
    });
  });

  // biome-ignore lint/suspicious/noTemplateCurlyInString: prose describing App.tsx's `Color ${length+1}` naming pattern, not a template literal
  it('names new entries as "Color ${length+1}" based on the current array length; this is current, not-a-bug-fix-target behavior, and it can produce a duplicate name after a middle entry is removed and a new one added', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const addButton = within(getCard('Color palette')).getByRole('button', { name: 'Add color' });
    await user.click(addButton); // -> ['Primary', 'Color 2']
    await user.click(addButton); // -> ['Primary', 'Color 2', 'Color 3']
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries.map((e) => e.name)).toEqual([
        'Primary',
        'Color 2',
        'Color 3',
      ]);
    });

    // Remove the middle entry ("Color 2"), leaving ['Primary', 'Color 3'] (length 2).
    const removeButtons = within(getCard('Color palette')).getAllByRole('button', { name: 'Remove color' });
    await confirmDelete(user, removeButtons[1]!, 'Remove');
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries.map((e) => e.name)).toEqual([
        'Primary',
        'Color 3',
      ]);
    });

    // Adding again names the new entry from the current length (2 + 1 = "Color 3"), colliding
    // with the "Color 3" that was already there.
    await user.click(within(getCard('Color palette')).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries.map((e) => e.name)).toEqual([
        'Primary',
        'Color 3',
        'Color 3',
      ]);
    });
  });

  it("saves a palette entry's name edit to storage", async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Brand' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.palette.entries[0]!.name).toBe('Brand');
    });
  });

  it("saves a palette entry's color edit to storage", async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    fireEvent.change(getColorInput(getCard('Color palette')), { target: { value: '#a1b2c3' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.palette.entries[0]!.color).toBe('#a1b2c3');
    });
  });

  it('removing a non-referenced palette entry (icon button) does not affect other entries or references', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await user.click(within(paletteCard).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries).toHaveLength(2);
    });

    // "default" (Primary) is referenced by Top bar and Platform Bar; remove the second, unreferenced entry.
    const removeButtons = within(paletteCard).getAllByRole('button', { name: 'Remove color' });
    await confirmDelete(user, removeButtons[1]!, 'Remove');

    await waitFor(async () => {
      const stored = await getStoredSettings();
      const settings = stored.projectRules[0]!.settings;
      expect(settings.palette.entries).toHaveLength(1);
      expect(settings.palette.entries[0]!.id).toBe('default');
      expect(settings.topBar.color.paletteId).toBe('default');
      expect(settings.platformBar.color.paletteId).toBe('default');
    });
  });

  it('Remove color opens a confirmation popover naming the entry, without deleting yet (falls back to "(unnamed)")', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const before = await getStoredSettings();
    const paletteCard = getCard('Color palette');
    const popover = await openDeleteConfirm(user, within(paletteCard).getByRole('button', { name: 'Remove color' }));

    expect(within(popover).getByText('Remove this color?')).toBeTruthy();
    expect(within(popover).getByText('Primary')).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(await getStoredSettings()).toEqual(before);
  });

  it('Remove color popover falls back to "(unnamed)" in its target line when the entry has an empty name', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries[0]!.name).toBe('');
    });

    const paletteCard = getCard('Color palette');
    const popover = await openDeleteConfirm(user, within(paletteCard).getByRole('button', { name: 'Remove color' }));
    expect(within(popover).getByText('Remove this color?')).toBeTruthy();
    expect(within(popover).getByText('(unnamed)')).toBeTruthy();
  });

  it('clicking outside the Remove color confirmation popover leaves the entry and storage unchanged and closes it', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const before = await getStoredSettings();
    const paletteCard = getCard('Color palette');
    // Grab a non-interactive reference before opening (the detail page's <h1>, which merely
    // shows the rule pattern): see the equivalent Delete-popover test for why the reference
    // must be captured before the popover opens. Not the "Color palette" switch label itself,
    // since clicking that would toggle it rather than act as a neutral outside click.
    const heading = screen.getByRole('heading', { name: 'my-project' });
    await openDeleteConfirm(user, within(paletteCard).getByRole('button', { name: 'Remove color' }));
    await user.click(heading);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await getStoredSettings()).toEqual(before);
  });

  it('confirming Remove color deletes the palette entry and closes the popover', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    await confirmDelete(user, within(paletteCard).getByRole('button', { name: 'Remove color' }), 'Remove');

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries).toHaveLength(0);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('removing a palette entry clears its reference within the same rule only, leaving other rules unaffected', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'alpha');
    await addRule(user, 'beta');
    await openRuleDetail(user, 'alpha');

    const paletteCard = getCard('Color palette');
    await confirmDelete(user, within(paletteCard).getByRole('button', { name: 'Remove color' }), 'Remove');

    await waitFor(async () => {
      const stored = await getStoredSettings();
      const alpha = stored.projectRules.find((r) => r.pattern === 'alpha')!;
      const beta = stored.projectRules.find((r) => r.pattern === 'beta')!;
      expect(alpha.settings.palette.entries).toHaveLength(0);
      expect(alpha.settings.topBar.color.paletteId).toBeNull();
      expect(alpha.settings.platformBar.color.paletteId).toBeNull();
      // The other rule's own palette entry and references are untouched.
      expect(beta.settings.palette.entries).toHaveLength(1);
      expect(beta.settings.topBar.color.paletteId).toBe('default');
      expect(beta.settings.platformBar.color.paletteId).toBe('default');
    });
  });

  it('removing a palette entry also clears its reference from platformBarText.color.paletteId (the third referencing field, alongside topBar.color.paletteId and platformBar.color.paletteId)', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    // Point Platform Bar text color at the "default" palette entry (it defaults to a Custom hex).
    const textDialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(textDialog, 'Primary'));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.color.paletteId).toBe('default');
    });
    await closePicker(user);

    const paletteCard = getCard('Color palette');
    await confirmDelete(user, within(paletteCard).getByRole('button', { name: 'Remove color' }), 'Remove');

    await waitFor(async () => {
      const settings = (await getStoredSettings()).projectRules[0]!.settings;
      expect(settings.platformBarText.color.paletteId).toBeNull();
      expect(settings.topBar.color.paletteId).toBeNull();
      expect(settings.platformBar.color.paletteId).toBeNull();
    });
  });

  it("a rule's palette is independent: adding a palette entry to one rule does not affect another rule's palette", async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'alpha');
    await addRule(user, 'beta');

    await openRuleDetail(user, 'alpha');
    await user.click(within(getCard('Color palette')).getByRole('button', { name: 'Add color' }));
    await waitFor(async () => {
      const rules = (await getStoredSettings()).projectRules;
      expect(rules.find((r) => r.pattern === 'alpha')!.settings.palette.entries).toHaveLength(2);
    });

    const stored = await getStoredSettings();
    expect(stored.projectRules.find((r) => r.pattern === 'beta')!.settings.palette.entries).toHaveLength(1);
  });

  it('shows "(unnamed)" as the swatch label in the picker for a palette entry with an empty name', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const nameInput = within(getCard('Color palette')).getByLabelText('Color name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.entries[0]!.name).toBe('');
    });

    const dialog = await openPicker(user, 'Top bar color');
    expect(getPaletteSwatch(dialog, '(unnamed)')).toBeTruthy();
  });

  it('hides the Palette section and shows the own hex on the trigger when Color palette is turned off', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.enabled).toBe(false);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('#ff6d00');

    const dialog = await openPicker(user, 'Top bar color');
    expect(within(dialog).queryByText('Palette')).toBeNull();
    expect(getCustomColorInput(dialog)).toBeTruthy();
  });

  it('keeps palette data and references in storage when turned off, and restores the trigger name when turned back on', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteSwitch = screen.getByRole('switch', { name: 'Color palette' });
    await user.click(paletteSwitch);
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.palette.enabled).toBe(false);
      expect(stored.projectRules[0]!.settings.palette.entries).toHaveLength(1);
      expect(stored.projectRules[0]!.settings.topBar.color.paletteId).toBe('default');
    });

    await user.click(screen.getByRole('switch', { name: 'Color palette' }));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.palette.enabled).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
  });

  it('falls back a referencing item to Custom when its referenced palette entry is removed', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const paletteCard = getCard('Color palette');
    const removeButton = within(paletteCard).getByRole('button', { name: 'Remove color' });
    await confirmDelete(user, removeButton, 'Remove');

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.topBar.color.paletteId).toBeNull();
      expect(stored.projectRules[0]!.settings.platformBar.color.paletteId).toBeNull();
      expect(stored.projectRules[0]!.settings.palette.entries).toHaveLength(0);
    });

    const dialog = await openPicker(user, 'Top bar color');
    // No palette entries left, so only the Custom section is shown.
    expect(within(dialog).queryByText('Palette')).toBeNull();

    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#777777' } });
    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.topBar.color.custom).toBe('#777777');
    });
  });

  it('Platform Bar text color: the picker shows an Auto option, inactive, with Custom active by default', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar text color');

    const autoButton = getAutoButton(dialog);
    expect(autoButton.className).not.toContain('ring-2');

    const customInput = getCustomColorInput(dialog);
    expect(customInput.parentElement?.className).toContain('ring-2');
  });

  it('Platform Bar text color: selecting Auto saves platformBarText.auto and the trigger shows "Auto"', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.auto).toBe(true);
    });

    await closePicker(user);
    expect(screen.getByRole('button', { name: 'Platform Bar text color' }).textContent).toBe('Auto');
  });

  it('Platform Bar text color: the auto-computed swatch color follows the Platform Bar background (not one-shot)', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.auto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#000080' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBar.color.custom).toBe('#000080');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#ffffff')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });

    dialog = await openPicker(user, 'Platform Bar color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#ffff00' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBar.color.custom).toBe('#ffff00');
    });
    await closePicker(user);

    await waitFor(() => {
      expect(hexOrRgb('#000000')).toContain(getTriggerSwatch('Platform Bar text color').style.backgroundColor);
    });
  });

  it('Platform Bar text color: selecting a palette entry clears Auto', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.auto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getPaletteSwatch(dialog, 'Primary'));

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.platformBarText.auto).toBe(false);
      expect(stored.projectRules[0]!.settings.platformBarText.color.paletteId).toBe('default');
    });
  });

  it('Platform Bar text color: changing the Custom color clears Auto', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    let dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.click(getAutoButton(dialog));
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.platformBarText.auto).toBe(true);
    });
    await closePicker(user);

    dialog = await openPicker(user, 'Platform Bar text color');
    fireEvent.change(getCustomColorInput(dialog), { target: { value: '#333333' } });

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.platformBarText.auto).toBe(false);
      expect(stored.projectRules[0]!.settings.platformBarText.color.custom).toBe('#333333');
      expect(stored.projectRules[0]!.settings.platformBarText.color.paletteId).toBeNull();
    });
  });

  it('Top bar: Height input shows the default value and saves changes to storage', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    expect(heightInput.value).toBe('4');

    fireEvent.change(heightInput, { target: { value: '10' } });

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.topBar.height).toBe(10);
    });
  });

  it('emptying the Top bar Height input is ignored: the previous valid value is kept in storage (valueAsNumber is NaN for an empty number input, which fails the Number.isFinite guard)', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
    fireEvent.change(heightInput, { target: { value: '15' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.topBar.height).toBe(15);
    });

    fireEvent.change(heightInput, { target: { value: '' } });

    // No save happens for the empty value, so the last valid value remains in storage.
    expect((await getStoredSettings()).projectRules[0]!.settings.topBar.height).toBe(15);
  });

  it('Top bar: the Stripes switch toggles topBar.stripes in storage', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const stripesSwitch = within(getCard('Top bar')).getByRole('switch', { name: 'Stripes' }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.topBar.stripes).toBe(true);
    });
  });

  it('Platform Bar: the Stripes switch toggles platformBar.stripes independently of Top bar Stripes', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });
    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');

    const stripesSwitch = within(getCard('Platform Bar')).getByRole('switch', {
      name: 'Stripes',
    }) as HTMLInputElement;
    expect(stripesSwitch.checked).toBe(false);

    await user.click(stripesSwitch);

    await waitFor(async () => {
      const stored = await getStoredSettings();
      expect(stored.projectRules[0]!.settings.platformBar.stripes).toBe(true);
      expect(stored.projectRules[0]!.settings.topBar.stripes).toBe(false);
    });
  });

  it('wraps every icon-only button (Edit/Duplicate/Delete/Add rule/Back/Remove color/Add color) in a HeroUI Tooltip.Trigger with a single Tab stop (the button itself, not the trigger wrapper)', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

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

    // Add rule and Delete additionally nest inside a Modal.Trigger / Popover.Trigger, each of
    // which renders its own Pressable wrapper div[role="button"] (tabbable by default) between
    // the Tooltip.Trigger and the real button. AddRuleModal/DeleteConfirmPopover pass
    // tabIndex={-1} to that trigger too, so it must be checked separately from the outer
    // tooltip-trigger wrapper above (a bug here previously slipped past this test, since it only
    // ever inspected the outermost wrapper).
    function expectNoIntermediateWrapper(button: HTMLElement, dataSlot: string) {
      const wrapper = button.closest(`[data-slot="${dataSlot}"]`) as HTMLElement | null;
      expect(wrapper).toBeTruthy();
      expect(wrapper!.tabIndex).toBe(-1);
    }

    // List page: Edit / Duplicate / Delete on the rule row, plus Add rule.
    const row = getRuleRow('my-project');
    for (const label of ['Edit', 'Duplicate', 'Delete']) {
      expectSingleTabStop(within(row).getByRole('button', { name: label }));
    }
    expectNoIntermediateWrapper(within(row).getByRole('button', { name: 'Delete' }), 'popover-trigger');
    expectSingleTabStop(screen.getByRole('button', { name: 'Add rule' }));
    expectNoIntermediateWrapper(screen.getByRole('button', { name: 'Add rule' }), 'modal-trigger');

    // Detail page: Back, Remove color, Add color.
    await openRuleDetail(user, 'my-project');
    expectSingleTabStop(screen.getByRole('button', { name: 'Back' }));
    expectSingleTabStop(screen.getByRole('button', { name: 'Remove color' }));
    expectNoIntermediateWrapper(screen.getByRole('button', { name: 'Remove color' }), 'popover-trigger');
    expectSingleTabStop(screen.getByRole('button', { name: 'Add color' }));
  });

  it('does not render a "Reset to defaults" button', async () => {
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    expect(screen.queryByRole('button', { name: 'Reset to defaults' })).toBeNull();
  });

  it('reflects a partial stored settings object merged with defaults', async () => {
    // Nested (current-shape) on purpose: with an empty migration registry, 0.1.0 data is read
    // as-is (no reshaping), so a "partial merge" fixture must already be in the current shape
    // to actually exercise per-field merging rather than the destructive old-shape path
    // (covered separately below, "... but destructively").
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        projectRules: [
          {
            id: 'r1',
            pattern: 'my-project',
            settings: { topBar: { color: { custom: '#123123', paletteId: null } } },
          },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
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

    render(<App settingsStore={new SettingsStoreImpl()} />);
    await flush();

    expect(screen.queryByText('should-not-appear')).toBeNull();
    expect(getAllRuleRows()).toHaveLength(0);
  });

  it('reads stored data whose schemaVersion equals SCHEMA_MIN_VERSION on mount, but destructively: with no migration steps pre-release, old flat-shape settings are ignored and every section defaults, while the rule itself survives', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '0.1.0',
        projectRules: [
          { id: 'r1', pattern: 'my-project', settings: { topBarColor: '#334455', topBarPaletteId: null } },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByText('my-project');
    await openRuleDetail(user, 'my-project');

    // The rule (id/pattern) is kept, but its flat-shape settings don't match any key
    // mergeProjectSettings looks for (it reads stored.topBar, not stored.topBarColor), so
    // topBar falls back to ProjectSettings.DEFAULT entirely: the old hex is gone, and the
    // trigger shows the default palette entry's name instead.
    expect(screen.getByRole('button', { name: 'Top bar color' }).textContent).toContain('Primary');
  });

  it('reads stored data whose schemaVersion is newer than the current version as-is on mount', async () => {
    // Newer-than-current data is trusted as-is (no migration step runs for it), so unlike the
    // 0.1.0 fixtures above, this one must already be in the current nested shape.
    await fakeBrowser.storage.local.set({
      tintSettings: {
        schemaVersion: '9.9.9',
        projectRules: [
          {
            id: 'r1',
            pattern: 'my-project',
            settings: { topBar: { color: { custom: '#334455', paletteId: null } } },
          },
        ],
      },
    });

    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
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

    render(<App settingsStore={new SettingsStoreImpl()} />);
    await flush();

    expect(screen.queryByText('should-not-appear')).toBeNull();
    expect(getAllRuleRows()).toHaveLength(0);
  });

  it('stamps the current version as schemaVersion whenever settings are saved', async () => {
    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'my-project');

    // CURRENT_VERSION ('0.1.0') currently equals CURRENT_SCHEMA_VERSION, so
    // effectiveSchemaVersion is a no-op here; asserting through the real function (rather
    // than the literal '0.1.0') keeps this test meaningful if that ever changes. The
    // dedicated regression test below exercises a manifest version that actually differs
    // from CURRENT_SCHEMA_VERSION.
    await waitFor(async () => {
      expect((await getStoredSettings()).schemaVersion).toBe(effectiveSchemaVersion(CURRENT_VERSION));
    });
  });

  it('stamps schemaVersion as the manifest version when it is already current-or-newer, and the saved payload survives a toDomain round-trip unchanged', async () => {
    // '0.1.5' is newer than CURRENT_SCHEMA_VERSION ('0.1.0'), so effectiveSchemaVersion
    // passes it through unfloored — this no longer exercises the floor itself (that only
    // triggers below '0.1.0', which is the floor value itself, so no realistic manifest
    // version reaches it pre-release). What it still guards: with an empty migration
    // registry, a save-then-reload round-trip on already-nested data must not lose or reset
    // the user's values, regardless of which valid schemaVersion label it carries.
    (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({
      version: '0.1.5',
    });

    const user = userEvent.setup();
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

    await addRule(user, 'my-project');
    await openRuleDetail(user, 'my-project');
    fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '19' } });
    await waitFor(async () => {
      expect((await getStoredSettings()).projectRules[0]!.settings.topBar.height).toBe(19);
    });

    const stored = await getStoredSettings();
    expect(stored.schemaVersion).toBe('0.1.5');

    const reloaded = toDomain(stored);
    expect(reloaded.projectRules[0]!.settings.topBar.height.toPixels()).toBe(19);
  });

  it('loads settings once on mount; external storage changes made afterward are not reflected in the UI (no live storage.onChanged listener, unlike content.ts)', async () => {
    render(<App settingsStore={new SettingsStoreImpl()} />);
    await screen.findByRole('button', { name: 'Add rule' });

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
    it('ignores adding an empty or whitespace-only pattern: the Add button stays disabled', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'existing-rule');

      const dialog = await openAddRuleModal(user);
      fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: '   ' } });
      expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);

      await user.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });

      expect((await getStoredSettings()).projectRules).toHaveLength(1);
      expect(getAllRuleRows()).toHaveLength(1);
    });

    it('allows adding multiple rules with the same pattern text, each with its own id (regex duplicates may be intentional)', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'same-pattern');
      await addRule(user, 'same-pattern');

      const stored = await getStoredSettings();
      expect(stored.projectRules.map((r) => r.pattern)).toEqual(['same-pattern', 'same-pattern']);
      expect(stored.projectRules[0]!.id).not.toBe(stored.projectRules[1]!.id);
    });

    it("shows each rule's match type as a text hint next to its pattern in the list", async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRuleWithMatchType(user, 'prefix', 'my-project');

      const row = getRuleRow('my-project');
      expect(within(row).getByText('prefix')).toBeTruthy();
    });

    it('Edit navigates to a rule detail page with a Pattern field; editing it saves and flags an invalid regex', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRuleWithMatchType(user, 'regex', 'my-project');
      await openRuleDetail(user, 'my-project');

      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('my-project');
      expect(screen.queryByText('Invalid regular expression')).toBeNull();

      const patternInput = screen.getByLabelText('Pattern') as HTMLInputElement;
      fireEvent.change(patternInput, { target: { value: 'proj-[' } });

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0]!.pattern).toBe('proj-[');
      });
      expect(screen.getByText('Invalid regular expression')).toBeTruthy();

      await goBack(user);
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
      expect(getRuleRow('proj-[')).toBeTruthy();
    });

    it('the Pattern field can be edited down to an empty string and saves it as-is, unlike Add rule which guards against empty (current behavior: no guard on edits, so an in-progress clear-and-retype is never blocked)', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRuleWithMatchType(user, 'regex', 'my-project');
      await openRuleDetail(user, 'my-project');

      const patternInput = screen.getByLabelText('Pattern') as HTMLInputElement;
      fireEvent.change(patternInput, { target: { value: '' } });

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0]!.pattern).toBe('');
      });
      // An empty string is a valid regular expression (it matches the empty position), so no
      // "Invalid regular expression" warning is shown for it.
      expect(screen.queryByText('Invalid regular expression')).toBeNull();
    });

    it('Detail page: the Match type Select changes matchType and adapts the value field label between Project ID and Pattern', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'my-project'); // default match type is 'exact'
      await openRuleDetail(user, 'my-project');

      expect(screen.getByLabelText('Project ID')).toBeTruthy();
      expect(screen.queryByLabelText('Pattern')).toBeNull();

      // The Select trigger's accessible name concatenates its aria-labelledby refs (the
      // currently-selected value's text, then the field's own "Match type" aria-label), e.g.
      // "Starts with Match type", so match by substring rather than an exact string.
      await user.click(screen.getByRole('button', { name: /Match type/ }));
      await user.click(await screen.findByRole('option', { name: 'Regex' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0]!.matchType).toBe('regex');
      });
      expect(screen.getByLabelText('Pattern')).toBeTruthy();
      expect(screen.queryByLabelText('Project ID')).toBeNull();
    });

    it('Detail page: the Invalid regular expression warning only appears when Match type is Regex', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRuleWithMatchType(user, 'prefix', 'my-project');
      await openRuleDetail(user, 'my-project');

      const valueInput = screen.getByLabelText('Project ID') as HTMLInputElement;
      fireEvent.change(valueInput, { target: { value: 'proj-[' } });
      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0]!.pattern).toBe('proj-[');
      });
      // The same text would be an invalid regex, but matchType isn't 'regex' here, so no warning.
      expect(screen.queryByText('Invalid regular expression')).toBeNull();

      // The Select trigger's accessible name concatenates its aria-labelledby refs (the
      // currently-selected value's text, then the field's own "Match type" aria-label), e.g.
      // "Starts with Match type", so match by substring rather than an exact string.
      await user.click(screen.getByRole('button', { name: /Match type/ }));
      await user.click(await screen.findByRole('option', { name: 'Regex' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[0]!.matchType).toBe('regex');
      });
      expect(screen.getByText('Invalid regular expression')).toBeTruthy();
    });

    it('Duplicate inserts a copy directly below the original with a new id, editable independently', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await user.click(within(getRuleRowAt(0)).getByRole('button', { name: 'Duplicate' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['alpha', 'alpha', 'beta']);
      });

      const duplicateRules = (await getStoredSettings()).projectRules;
      const original = duplicateRules[0]!;
      const duplicate = duplicateRules[1]!;
      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.matchType).toBe(original.matchType);
      expect(duplicate.settings).toEqual(original.settings);

      // Editing the duplicate (index 1, the second "alpha" row) must not affect the original (index 0).
      await openRuleDetailAt(user, 1);
      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '22' } });
      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules[1]!.settings.topBar.height).toBe(22);
      });
      expect((await getStoredSettings()).projectRules[0]!.settings.topBar.height).toBe(4);
    });

    it("Duplicate copies a non-default matchType ('suffix') to the copy, shown in both rows' hints", async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRuleWithMatchType(user, 'suffix', 'alpha');
      await user.click(within(getRuleRowAt(0)).getByRole('button', { name: 'Duplicate' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.matchType)).toEqual(['suffix', 'suffix']);
      });
      const hints = screen.getAllByText('suffix');
      expect(hints).toHaveLength(2);
    });

    it("Duplicate shares the original's immutable settings: editing the duplicate's palette does not affect the original's", async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
        expect(rules[1]!.settings.palette.entries[0]!.color).toBe('#00ff00');
      });

      // The original (index 0) keeps its own, unaffected palette entry.
      const rules = (await getStoredSettings()).projectRules;
      expect(rules[0]!.settings.palette.entries[0]!.color).toBe('#ff6d00');
    });

    it('Delete opens a confirmation popover naming the rule pattern, without deleting yet', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'my-project');
      const before = await getStoredSettings();

      const popover = await openDeleteConfirm(
        user,
        within(getRuleRow('my-project')).getByRole('button', { name: 'Delete' }),
      );

      expect(within(popover).getByText('Delete this rule?')).toBeTruthy();
      expect(within(popover).getByText('my-project')).toBeTruthy();
      expect(within(popover).getByRole('button', { name: 'Delete' })).toBeTruthy();
      // No deletion has happened yet: only the popover opened. (Not also asserting the row's
      // DOM presence here: the popover's target line intentionally repeats the same pattern
      // text as its own element, and getByText, unlike getByRole, does not filter out the
      // aria-hidden row underneath while the popover is open, so a getRuleRow() call here
      // would ambiguously match both.)
      expect(await getStoredSettings()).toEqual(before);
    });

    it('clicking outside the delete confirmation popover leaves the rule and storage unchanged and closes it (no Cancel button; dismissal is cancel)', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'my-project');
      const before = await getStoredSettings();

      // Grab the reference before opening: react-aria's Popover marks the rest of the page
      // aria-hidden while open (established Popover behavior in this app), which would make
      // getByRole fail to find it if queried only after opening.
      const heading = screen.getByRole('heading', { name: 'GCP Console Tint' });
      await openDeleteConfirm(user, within(getRuleRow('my-project')).getByRole('button', { name: 'Delete' }));
      await user.click(heading);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(await getStoredSettings()).toEqual(before);
      expect(getRuleRow('my-project')).toBeTruthy();
    });

    it('pressing Escape in the delete confirmation popover closes it without deleting', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'my-project');
      const before = await getStoredSettings();

      await openDeleteConfirm(user, within(getRuleRow('my-project')).getByRole('button', { name: 'Delete' }));
      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(await getStoredSettings()).toEqual(before);
      expect(getRuleRow('my-project')).toBeTruthy();
    });

    it('confirming Delete in the popover removes the rule from the list and storage, and closes the popover', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await confirmDelete(user, within(getRuleRow('alpha')).getByRole('button', { name: 'Delete' }), 'Delete');

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules.map((r) => r.pattern)).toEqual(['beta']);
      });
      expect(screen.queryByText('alpha')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('reorders rules via drag-and-drop from the grip handle, and persists the new order to storage', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

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
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      await addRule(user, 'beta');

      await openRuleDetail(user, 'alpha');
      fireEvent.change(within(getCard('Top bar')).getByLabelText('Top bar height'), { target: { value: '11' } });
      await waitFor(async () => {
        const rules = (await getStoredSettings()).projectRules;
        expect(rules.find((r) => r.pattern === 'alpha')!.settings.topBar.height).toBe(11);
      });
      await goBack(user);

      await openRuleDetail(user, 'beta');
      const heightInput = within(getCard('Top bar')).getByLabelText('Top bar height') as HTMLInputElement;
      expect(heightInput.value).toBe('4');
      fireEvent.change(heightInput, { target: { value: '33' } });

      await waitFor(async () => {
        const rules = (await getStoredSettings()).projectRules;
        expect(rules.find((r) => r.pattern === 'beta')!.settings.topBar.height).toBe(33);
        expect(rules.find((r) => r.pattern === 'alpha')!.settings.topBar.height).toBe(11);
      });
    });

    it("a Top bar Custom color change while editing a rule saves to that rule's settings only", async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      await addRule(user, 'beta');
      await openRuleDetail(user, 'alpha');

      const dialog = await openPicker(user, 'Top bar color');
      fireEvent.change(getCustomColorInput(dialog), { target: { value: '#654321' } });

      await waitFor(async () => {
        const stored = await getStoredSettings();
        const alpha = stored.projectRules.find((r) => r.pattern === 'alpha')!;
        const beta = stored.projectRules.find((r) => r.pattern === 'beta')!;
        expect(alpha.settings.topBar.color.paletteId).toBeNull();
        expect(alpha.settings.topBar.color.custom).toBe('#654321');
        // The other rule keeps its own default reference untouched.
        expect(beta.settings.topBar.color.paletteId).toBe('default');
      });
    });
  });

  describe('Settings', () => {
    it('gates the side panel while the initial settings read is pending', async () => {
      const store = new SettingsStoreImpl();
      let resolveLoad!: (settings: TintSettings) => void;
      const load = new Promise<TintSettings>((resolve) => {
        resolveLoad = resolve;
      });
      vi.spyOn(store, 'load').mockReturnValue(load);

      render(<App settingsStore={store} />);

      expect(screen.getByRole('status').textContent).toContain('Loading settings');
      expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();

      await act(async () => {
        resolveLoad(new TintSettings([]));
        await load;
      });
      expect(await screen.findByRole('button', { name: 'Add rule' })).toBeTruthy();
    });

    it('shows a failure alert and keeps settings actions gated when the initial read rejects', async () => {
      const store = new SettingsStoreImpl();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(store, 'load').mockRejectedValue(new Error('storage unavailable'));

      render(<App settingsStore={store} />);

      expect(await screen.findByText('Couldn’t load settings')).toBeTruthy();
      expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] settings load failed', expect.any(Error));
    });

    it('opens on Rules by default and swaps the Projects card for the Backup card when Settings is picked', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      // The pill track behind the tabs only exists when Tabs.List is wrapped in
      // Tabs.ListContainer, so its presence is what proves the intended composition.
      expect(document.querySelector('.tabs__list-container')).toBeTruthy();
      const tabs = screen.getAllByRole('tab');
      expect(tabs.map((tab) => tab.textContent)).toEqual(['Rules', 'Settings']);
      expect((tabs[0] as HTMLElement).getAttribute('aria-selected')).toBe('true');

      await openSettingsTab(user);

      expect(screen.getByRole('button', { name: 'Import…' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    });

    it('Export downloads the saved settings as pretty-printed JSON under a dated file name, and releases the blob URL', async () => {
      const user = userEvent.setup();
      const { createObjectURL, revokeObjectURL, clicks } = stubDownloads();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      await openSettingsTab(user);
      await user.click(screen.getByRole('button', { name: 'Export' }));

      // Export first reads storage back (asynchronously), so the download happens later.
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      expect(blob.type).toBe('application/json');
      expect(await blob.text()).toBe(JSON.stringify(await getStoredSettings(), null, 2));

      const link = clicks[0]!;
      expect(link.download).toMatch(/^gcp-console-tint-settings-\d{4}-\d{2}-\d{2}\.json$/);
      // Revocation is deferred to the next tick (see BackupCard.handleExport), hence the wait.
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0]!.value));
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');
    });

    it('Import lists every rule in the file, flags the one that would replace an existing rule, and merges the picked rules on confirm', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      const before = await getStoredSettings();
      const existing = before.projectRules[0]!;

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'x.json', settingsFile(replacementFor(existing, 21), newRule(existing, 'beta')));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('x.json')).toBeTruthy();
      expect(within(dialog).getByRole('checkbox', { name: 'File row 1, exact, alpha' })).toBeTruthy();
      expect(within(dialog).getByRole('checkbox', { name: 'File row 2, exact, beta' })).toBeTruthy();
      expect(within(dialog).getByText('2 of 2 selected')).toBeTruthy();
      expect(within(dialog).getByText('File row 1 → Rule row 1')).toBeTruthy();
      expect(within(dialog).getByText('File row 2 → Add')).toBeTruthy();
      // Only the rule matching an existing match type + pattern is marked as a replacement.
      expect(within(dialog).getAllByRole('img', { name: 'Replaces an existing rule' })).toHaveLength(1);
      expect(within(dialog).getByText('Replaces 1 existing rule')).toBeTruthy();

      // Unchecking one rule updates the counter, the warning and the confirm label.
      await user.click(within(dialog).getByRole('checkbox', { name: 'File row 1, exact, alpha' }));
      expect(within(dialog).getByText('1 of 2 selected')).toBeTruthy();
      expect(within(dialog).queryByText('Replaces 1 existing rule')).toBeNull();
      expect(within(dialog).getByText('File row 1 → Not selected')).toBeTruthy();
      expect(within(dialog).getByText('File row 2 → Add')).toBeTruthy();
      expect(within(dialog).getByRole('button', { name: 'Import 1 rule' })).toBeTruthy();

      await user.click(within(dialog).getByRole('checkbox', { name: 'File row 1, exact, alpha' }));
      expect(within(dialog).getByText('File row 1 → Rule row 1')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: 'Import 2 rules' }));

      await waitFor(async () => {
        expect((await getStoredSettings()).projectRules).toHaveLength(2);
      });
      const after = await getStoredSettings();
      // The duplicate replaced the existing rule in place: same id, same position, new settings.
      expect(after.projectRules[0]!.id).toBe(existing.id);
      expect(after.projectRules[0]!.settings.topBar.height).toBe(21);
      // The new rule was appended under a fresh id, not the file's.
      expect(after.projectRules[1]!.pattern).toBe('beta');
      expect(after.projectRules[1]!.id).not.toBe('file-beta');

      expect(await screen.findByText('Imported 2 rules')).toBeTruthy();
      expect(screen.getByText('1 added and 1 replaced from x.json')).toBeTruthy();
    });

    it('waits for storage before showing import success and closing the picker', async () => {
      const user = userEvent.setup();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'existing');
      const existing = (await getStoredSettings()).projectRules[0]!;
      let resolveSave!: () => void;
      const save = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      vi.spyOn(store, 'save').mockReturnValueOnce(save);

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'deferred.json', settingsFile(newRule(existing, 'imported')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));

      expect((within(dialog).getByRole('button', { name: 'Importing…' }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.queryByText('Imported 1 rule')).toBeNull();
      expect(screen.getByRole('dialog')).toBeTruthy();

      await act(async () => {
        resolveSave();
        await save;
      });
      const success = await screen.findByRole('status');
      expect(within(success).getByText('Imported 1 rule')).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the original settings after a rejected import and allows a normal edit after cancel', async () => {
      const user = userEvent.setup();
      const store = new SettingsStoreImpl();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'existing');
      const before = await getStoredSettings();
      const existing = before.projectRules[0]!;
      let rejectSave!: (error: Error) => void;
      const save = new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      });
      const observedRejection = save.catch((error: Error) => error);
      vi.spyOn(store, 'save').mockReturnValueOnce(save);

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'failed.json', settingsFile(newRule(existing, 'from-file')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      await act(async () => {
        rejectSave(new Error('quota exceeded'));
        await observedRejection;
      });

      expect(await within(dialog).findByText('Couldn’t save imported rules')).toBeTruthy();
      expect(screen.queryByText('Imported 1 rule')).toBeNull();
      expect(within(dialog).getByRole('checkbox', { name: 'File row 1, exact, from-file' })).toBeTruthy();
      expect(await getStoredSettings()).toEqual(before);
      expect(consoleError).toHaveBeenCalledTimes(1);

      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await user.click(screen.getByRole('tab', { name: 'Rules' }));
      await addRule(user, 'normal-edit');

      expect((await getStoredSettings()).projectRules.map((rule) => rule.pattern)).toEqual(['existing', 'normal-edit']);
    });

    it('Select all clears every row, which disables the Import button', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'x.json', settingsFile(existing, newRule(existing, 'beta')));

      const dialog = await screen.findByRole('dialog');
      const selectAll = within(dialog).getByRole('checkbox', { name: 'Select all' });
      expect((selectAll as HTMLInputElement).checked).toBe(true);

      await user.click(selectAll);

      expect(within(dialog).getByText('0 of 2 selected')).toBeTruthy();
      expect((within(dialog).getByRole('button', { name: 'Import 0 rules' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('a file that is not JSON is refused with the reason, a copyable detail block and a console.error', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      // user-event installs a Clipboard stub on navigator; spy on that rather than replacing it.
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'broken.json', '{ not json');

      const alert = await screen.findByRole('alert');
      expect(within(alert).getByText('Couldn’t import this file')).toBeTruthy();
      expect(within(alert).getByText('broken.json could not be parsed as JSON.')).toBeTruthy();
      const detail = within(alert).getByText(/^SyntaxError: /);

      await user.click(screen.getByRole('button', { name: 'Copy details' }));
      expect(writeText).toHaveBeenCalledWith(detail.textContent);
      expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] import failed', expect.anything());

      expect(screen.queryByRole('dialog')).toBeNull();
      consoleError.mockRestore();
    });

    it('logs copy failures without changing the import notice or stored settings', async () => {
      const user = userEvent.setup();
      const store = new SettingsStoreImpl();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'existing');
      const before = await getStoredSettings();
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'broken.json', '{ not json');

      expect(await screen.findByText('Couldn’t import this file')).toBeTruthy();
      const copyError = new Error('clipboard denied');
      writeText.mockRejectedValueOnce(copyError);
      consoleError.mockClear();
      await user.click(screen.getByRole('button', { name: 'Copy details' }));

      await waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
      expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] clipboard copy failed', copyError);
      expect(screen.getByText('Couldn’t import this file')).toBeTruthy();
      expect(screen.getByText('broken.json could not be parsed as JSON.')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy();
      expect(await getStoredSettings()).toEqual(before);
      const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      try {
        await user.click(screen.getByRole('button', { name: 'Copy details' }));
        expect(screen.getByText('Couldn’t import this file')).toBeTruthy();
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(await getStoredSettings()).toEqual(before);
      } finally {
        if (clipboardDescriptor) {
          Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
        } else {
          Reflect.deleteProperty(navigator, 'clipboard');
        }
      }
    });

    it('a file stamped by a newer release than this build is refused, telling the user to update', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      const before = await getStoredSettings();
      // The manifest here is CURRENT_VERSION ('0.1.0'); a file this build could not have written.
      const fromTheFuture = JSON.parse(settingsFile(existing));
      fromTheFuture.schemaVersion = '9.9.9';

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'newer.json', JSON.stringify(fromTheFuture));

      expect(
        await screen.findByText(
          'newer.json was written by a newer version of GCP Console Tint (9.9.9). Update the extension, then import it again.',
        ),
      ).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(await getStoredSettings()).toEqual(before);
      consoleError.mockRestore();
    });

    it('a file whose fields are missing or invalid is refused, listing each offending field path', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      const before = await getStoredSettings();
      // Structurally wrong: height is a string where the format requires a number. Nothing is
      // repaired, so the whole file is refused rather than silently importing a default height.
      const broken = JSON.parse(settingsFile(existing));
      broken.projectRules[0].settings.topBar.height = '4';

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'broken-fields.json', JSON.stringify(broken));

      expect(await screen.findByText('broken-fields.json has missing or invalid fields.')).toBeTruthy();
      expect(screen.getByText(/projectRules\[0\]\.settings\.topBar\.height/)).toBeTruthy();
      // Refused outright: no rule picker, and storage is exactly what it was before the upload.
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(await getStoredSettings()).toEqual(before);
      consoleError.mockRestore();
    });

    it('JSON that is not a settings file is refused with the reason only, without a detail block', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });

      await openSettingsTab(user);
      await uploadSettingsFile(user, 'other.json', '[]');

      expect(await screen.findByText('other.json isn’t a GCP Console Tint settings file.')).toBeTruthy();
      // No underlying error to show, so no detail block and nothing to copy.
      expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
      consoleError.mockRestore();
    });

    it.each([
      ['nothing was ever saved', false],
      ['the only rule failed to save', true],
    ])(
      'Export with no saved rules makes no file and says so, replacing the previous notice (%s)',
      async (_case, failFirstSave) => {
        const user = userEvent.setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createObjectURL, clicks } = stubDownloads();
        const store = new SettingsStoreImpl();
        render(<App settingsStore={store} />);
        await screen.findByRole('button', { name: 'Add rule' });
        if (failFirstSave) {
          vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('quota exceeded'));
          const dialog = await openAddRuleModal(user);
          fireEvent.change(within(dialog).getByLabelText('Project ID'), { target: { value: 'unsaved' } });
          await user.click(within(dialog).getByRole('button', { name: 'Add' }));
          await waitFor(() =>
            expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] settings save failed', expect.any(Error)),
          );
          // The panel shows the rule; storage does not have it.
          expect(getAllRuleRows()).toHaveLength(1);
        }

        await openSettingsTab(user);
        await uploadSettingsFile(user, 'broken.json', '{ not json');
        expect(await screen.findByText('Couldn’t import this file')).toBeTruthy();

        const load = vi.spyOn(store, 'load');
        await user.click(screen.getByRole('button', { name: 'Export' }));

        // The notice is the signal that the (asynchronous) export has finished.
        await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
        expect(screen.getByRole('status').textContent).toBe(
          'No saved rules to exportAdd and save a rule, then try again.',
        );
        expect(screen.queryByText('Couldn’t import this file')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(clicks).toHaveLength(0);
        expect(document.querySelector('a[download]')).toBeNull();

        // The card is idle again in this same mount: a second Export is accepted and reads again.
        const first = screen.getByRole('status');
        expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false);
        await user.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(screen.getByRole('status')).not.toBe(first));
        expect(load).toHaveBeenCalledTimes(2);
        expect(createObjectURL).not.toHaveBeenCalled();
      },
    );
  });

  describe('Settings backup: operations', () => {
    // A File whose read is held until the test settles it.
    function heldFile(name: string) {
      const read = deferred<string>();
      const file = new File([''], name, { type: 'application/json' });
      const text = vi.fn(() => read.promise);
      Object.defineProperty(file, 'text', { value: text });
      return { file, read, text };
    }

    function fileInput() {
      return screen.getByLabelText('Import settings file') as HTMLInputElement;
    }

    // Fires the input's change handler even though the card has disabled the input, the way a
    // stale or synthetic event could, to prove the handler refuses on its own.
    async function forceUpload(user: ReturnType<typeof userEvent.setup>, file: File) {
      const input = fileInput();
      input.disabled = false;
      await user.upload(input, file);
      return input;
    }

    // Same, for while the import modal is open. user.upload would press the input first, and a
    // press outside the modal dismisses it (in the real panel the backdrop covers the input), so
    // the pick is simulated directly: a selection that, as in a browser, clearing the value empties.
    function forceChange(file: File) {
      const input = fileInput();
      input.disabled = false;
      let files: File[] = [file];
      Object.defineProperty(input, 'files', { configurable: true, get: () => files });
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => (files.length > 0 ? `C:\\fakepath\\${file.name}` : ''),
        set: (value: string) => {
          if (value === '') files = [];
        },
      });
      fireEvent.change(input);
      return input;
    }

    it('starts one read for two Export presses dispatched before a re-render', async () => {
      const user = userEvent.setup();
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      await openSettingsTab(user);
      const load = vi.spyOn(store, 'load');

      const exportButton = screen.getByRole('button', { name: 'Export' });
      act(() => {
        exportButton.click();
        exportButton.click();
      });

      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(load).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');
    });

    it('refuses an Import press dispatched before a re-render after an accepted Export', async () => {
      const user = userEvent.setup();
      stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      const pick = vi.spyOn(fileInput(), 'click');

      // Export has not re-rendered yet, so the Import button is still enabled: only its own
      // handler's check can refuse the press.
      const exportButton = screen.getByRole('button', { name: 'Export' });
      const importButton = screen.getByRole('button', { name: 'Import…' });
      act(() => {
        exportButton.click();
        importButton.click();
      });

      expect(pick).not.toHaveBeenCalled();
      expect((await screen.findByRole('status')).textContent).toBe(
        'No saved rules to exportAdd and save a rule, then try again.',
      );
      // Once idle the same press opens the picker, so the spy above would have seen one.
      await user.click(screen.getByRole('button', { name: 'Import…' }));
      expect(pick).toHaveBeenCalledTimes(1);
    });

    it('clears the previous notice as soon as an Export is accepted, before the read finishes', async () => {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'broken.json', '{ not json');
      expect(await screen.findByText('Couldn’t import this file')).toBeTruthy();
      const read = deferred<TintSettings>();
      vi.spyOn(store, 'load').mockReturnValueOnce(read.promise);

      await user.click(screen.getByRole('button', { name: 'Export' }));

      expect(screen.queryByText('Couldn’t import this file')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => {
        read.resolve(new TintSettings([]));
        await read.promise;
      });
      expect(await screen.findByText('No saved rules to export')).toBeTruthy();
    });

    it('clears the previous notice as soon as a file is accepted, before it has been read', async () => {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'broken.json', '{ not json');
      expect(await screen.findByText('broken.json could not be parsed as JSON.')).toBeTruthy();
      const held = heldFile('slow.json');

      await user.upload(fileInput(), held.file);

      expect(screen.queryByText('Couldn’t import this file')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      await act(async () => {
        held.read.resolve('{ not json');
        await held.read.promise;
      });
      expect(await screen.findByText('slow.json could not be parsed as JSON.')).toBeTruthy();
    });

    // The refusal here is the disabled button. React re-renders synchronously at the end of a
    // change event, so no Export press can reach the handler between a file being accepted and
    // the button being disabled; the handler's own check for this phase is defensive only.
    it('keeps Export disabled, and Import usable, while a file is being read', async () => {
      const user = userEvent.setup();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      const load = vi.spyOn(store, 'load');
      const held = heldFile('slow.json');

      await user.upload(fileInput(), held.file);
      const exportButton = screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;
      expect(exportButton.disabled).toBe(true);
      act(() => exportButton.click());
      // Still readable: picking another file replaces the one being read. The Import button is the
      // only way a user reaches the hidden input, so it must stay enabled and open the picker.
      expect(fileInput().disabled).toBe(false);
      const pick = vi.spyOn(fileInput(), 'click');
      const importButton = screen.getByRole('button', { name: 'Import…' }) as HTMLButtonElement;
      expect(importButton.disabled).toBe(false);
      await user.click(importButton);
      expect(pick).toHaveBeenCalledTimes(1);

      await act(async () => {
        held.read.resolve('{ not json');
        await held.read.promise;
      });
      expect(await screen.findByText('slow.json could not be parsed as JSON.')).toBeTruthy();
      expect(load).not.toHaveBeenCalled();
    });

    it('refuses a file picked while an export is running, without reading it or touching the notice', async () => {
      const user = userEvent.setup();
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      await openSettingsTab(user);
      const read = deferred<TintSettings>();
      const realLoad = store.load.bind(store);
      vi.spyOn(store, 'load').mockImplementationOnce(() => read.promise.then(() => realLoad()));
      const importJson = vi.spyOn(store, 'importJson');

      await user.click(screen.getByRole('button', { name: 'Export' }));
      expect(fileInput().tabIndex).toBe(-1);
      expect(fileInput().disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Import…' }) as HTMLButtonElement).disabled).toBe(true);
      const held = heldFile('during-export.json');
      const input = await forceUpload(user, held.file);

      expect(held.text).not.toHaveBeenCalled();
      expect(importJson).not.toHaveBeenCalled();
      expect(input.value).toBe('');
      expect(input.files).toHaveLength(0);
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      // Still exporting.
      expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);

      await act(async () => {
        read.resolve(new TintSettings([]));
        await read.promise;
      });
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');
      expect(held.text).not.toHaveBeenCalled();
    });

    it('refuses a file picked while the import modal is open, keeping the modal and its file', async () => {
      const user = userEvent.setup();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'first.json', settingsFile(newRule(existing, 'beta')));
      const dialog = await screen.findByRole('dialog');
      const importJson = vi.spyOn(store, 'importJson');

      expect(fileInput().disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Export', hidden: true }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Import…', hidden: true }) as HTMLButtonElement).disabled).toBe(true);
      const held = heldFile('second.json');
      const input = forceChange(held.file);

      expect(held.text).not.toHaveBeenCalled();
      expect(importJson).not.toHaveBeenCalled();
      expect(input.value).toBe('');
      expect(input.files).toHaveLength(0);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(within(dialog).getByText('first.json')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it.each(['resolves', 'rejects'] as const)(
      'keeps a later read busy when an earlier one %s first, then opens the later file',
      async (outcome) => {
        const user = userEvent.setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = new SettingsStoreImpl();
        render(<App settingsStore={store} />);
        await screen.findByRole('button', { name: 'Add rule' });
        await addRule(user, 'alpha');
        const existing = (await getStoredSettings()).projectRules[0]!;
        await openSettingsTab(user);
        const a = heldFile('a.json');
        const b = heldFile('b.json');

        await user.upload(fileInput(), a.file);
        await user.upload(fileInput(), b.file);
        await act(async () => {
          if (outcome === 'resolves') a.read.resolve(settingsFile(newRule(existing, 'from-a')));
          else a.read.reject(new Error('a vanished'));
          await a.read.promise.catch(() => {});
        });

        // B is still being read: Export stays refused and nothing from A shows up.
        expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(consoleError).not.toHaveBeenCalled();

        await act(async () => {
          b.read.resolve(settingsFile(newRule(existing, 'from-b')));
          await b.read.promise;
        });
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('b.json')).toBeTruthy();
        expect(within(dialog).getByText('from-b')).toBeTruthy();
      },
    );

    it.each(['resolves', 'rejects'] as const)(
      'leaves the later file’s modal open and input disabled when an earlier read %s afterwards',
      async (outcome) => {
        const user = userEvent.setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = new SettingsStoreImpl();
        render(<App settingsStore={store} />);
        await screen.findByRole('button', { name: 'Add rule' });
        await addRule(user, 'alpha');
        const existing = (await getStoredSettings()).projectRules[0]!;
        await openSettingsTab(user);
        const importJson = vi.spyOn(store, 'importJson');
        const a = heldFile('a.json');
        const b = heldFile('b.json');

        await user.upload(fileInput(), a.file);
        await user.upload(fileInput(), b.file);
        await act(async () => {
          b.read.resolve(settingsFile(newRule(existing, 'from-b')));
          await b.read.promise;
        });
        const dialog = await screen.findByRole('dialog');
        await act(async () => {
          if (outcome === 'resolves') a.read.resolve(settingsFile(newRule(existing, 'from-a')));
          else a.read.reject(new Error('a vanished'));
          await a.read.promise.catch(() => {});
        });

        expect(screen.getByRole('dialog')).toBe(dialog);
        expect(within(dialog).getByText('b.json')).toBeTruthy();
        expect(importJson).toHaveBeenCalledTimes(1);
        expect(fileInput().disabled).toBe(true);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(consoleError).not.toHaveBeenCalled();

        // The modal still blocks a new file the same way it did before A settled.
        const c = heldFile('c.json');
        const input = forceChange(c.file);
        expect(input.files).toHaveLength(0);
        expect(c.text).not.toHaveBeenCalled();
        expect(within(screen.getByRole('dialog')).getByText('b.json')).toBeTruthy();
      },
    );

    it('accepts the next operation after each way one ends: failed export, cancelled import, finished import', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      await openSettingsTab(user);
      const readError = new Error('storage unavailable');
      const load = vi.spyOn(store, 'load').mockRejectedValueOnce(readError);
      const text = vi.spyOn(File.prototype, 'text');

      // A failed export: its own alert, with no detail block and nothing to copy.
      await user.click(screen.getByRole('button', { name: 'Export' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(
        'Couldn’t create a backupSaved settings could not be read or exported. Try again.',
      );
      expect(screen.queryByRole('region', { name: 'Error details' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] export failed', readError);

      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(load).toHaveBeenCalledTimes(2);

      await uploadSettingsFile(user, 'x.json', settingsFile(newRule(existing, 'beta')));
      await screen.findByRole('dialog');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await uploadSettingsFile(user, 'x.json', settingsFile(newRule(existing, 'beta')));
      const dialog = await screen.findByRole('dialog');
      expect(text).toHaveBeenCalledTimes(2);

      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      expect(await screen.findByText('Imported 1 rule')).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
      expect(load).toHaveBeenCalledTimes(3);
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 2 saved rules.');
    });

    it('exports what storage holds, not the screen, after an ordinary save failed', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      await addRule(user, 'beta');
      const saved = await getStoredSettings();
      vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('quota exceeded'));

      await confirmDelete(user, within(getRuleRow('beta')).getByRole('button', { name: 'Delete' }), 'Delete');
      await waitFor(() =>
        expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] settings save failed', expect.any(Error)),
      );
      expect(getAllRuleRows()).toHaveLength(1);

      await openSettingsTab(user);
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      const blob = createObjectURL.mock.calls[0]![0] as Blob;
      expect(JSON.parse(await blob.text()).projectRules).toEqual(saved.projectRules);
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 2 saved rules.');
    });
  });

  describe('Settings backup: leaving the tab and unmounting', () => {
    async function leaveAndReturn(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole('tab', { name: 'Rules' }));
      await screen.findByRole('button', { name: 'Add rule' });
      expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
      await openSettingsTab(user);
    }

    it.each(['resolves', 'rejects'] as const)(
      'drops an export started before leaving Settings when its read %s after a newer export finished',
      async (outcome) => {
        const user = userEvent.setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { createObjectURL } = stubDownloads();
        const store = new SettingsStoreImpl();
        render(<App settingsStore={store} />);
        await screen.findByRole('button', { name: 'Add rule' });
        await addRule(user, 'alpha');
        await openSettingsTab(user);
        const staleRead = deferred<TintSettings>();
        const load = vi.spyOn(store, 'load').mockReturnValueOnce(staleRead.promise);

        await user.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        await leaveAndReturn(user);
        // The new card starts idle even though the old read is still out.
        await user.click(screen.getByRole('button', { name: 'Export' }));
        await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');

        await act(async () => {
          // A different value than the newer export wrote, so a leak would show in the Blob.
          if (outcome === 'resolves')
            staleRead.resolve(
              new TintSettings([DomainProjectRule.create('exact', 'stale'), DomainProjectRule.create('exact', 'old')]),
            );
          else staleRead.reject(new Error('stale read failed'));
          await staleRead.promise.catch(() => {});
        });
        await flush();

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        const blob = createObjectURL.mock.calls[0]![0] as Blob;
        expect(await blob.text()).toBe(JSON.stringify(await getStoredSettings(), null, 2));
        expect(screen.getByRole('status')).toBe(status);
        expect(status.textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');
        expect(screen.queryByRole('alert')).toBeNull();
        expect((screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement).disabled).toBe(false);
        expect(consoleError).not.toHaveBeenCalled();
      },
    );

    it.each(['resolves', 'rejects'] as const)(
      'drops a file read started before leaving Settings when it %s after a newer import finished',
      async (outcome) => {
        const user = userEvent.setup();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const store = new SettingsStoreImpl();
        render(<App settingsStore={store} />);
        await screen.findByRole('button', { name: 'Add rule' });
        await addRule(user, 'alpha');
        const existing = (await getStoredSettings()).projectRules[0]!;
        await openSettingsTab(user);
        const importJson = vi.spyOn(store, 'importJson');
        const staleRead = deferred<string>();
        const staleFile = new File([''], 'stale.json', { type: 'application/json' });
        Object.defineProperty(staleFile, 'text', { value: () => staleRead.promise });

        await user.upload(screen.getByLabelText('Import settings file') as HTMLInputElement, staleFile);
        await leaveAndReturn(user);
        await uploadSettingsFile(user, 'new.json', settingsFile(newRule(existing, 'from-new')));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('Imported 1 rule1 added from new.json');

        await act(async () => {
          if (outcome === 'resolves') staleRead.resolve(settingsFile(newRule(existing, 'from-stale')));
          else staleRead.reject(new Error('stale file vanished'));
          await staleRead.promise.catch(() => {});
        });
        await flush();

        expect(importJson).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('status')).toBe(status);
        expect(status.textContent).toBe('Imported 1 rule1 added from new.json');
        expect(screen.queryByRole('alert')).toBeNull();
        expect(consoleError).not.toHaveBeenCalled();
        expect((await getStoredSettings()).projectRules.map((rule) => rule.pattern)).toEqual(['alpha', 'from-new']);
      },
    );

    it('still releases a created blob URL when the card unmounts before the deferred revoke', async () => {
      const user = userEvent.setup();
      const { createObjectURL, revokeObjectURL, clicks } = stubDownloads();
      const store = new SettingsStoreImpl();
      const { unmount } = render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      await openSettingsTab(user);
      const read = deferred<void>();
      const realLoad = store.load.bind(store);
      const load = vi.spyOn(store, 'load').mockImplementationOnce(() => read.promise.then(() => realLoad()));
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

      // Only setTimeout is faked, so the revoke stays queued until the test advances it.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await act(async () => {
          read.resolve();
          for (let i = 0; i < 20 && createObjectURL.mock.calls.length === 0; i++) await Promise.resolve();
        });
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(clicks).toHaveLength(1);
        expect(revokeObjectURL).not.toHaveBeenCalled();

        unmount();
        vi.runOnlyPendingTimers();
      } finally {
        vi.useRealTimers();
      }
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith(createObjectURL.mock.results[0]!.value);
      expect(document.querySelector('a[download]')).toBeNull();
    });

    it('runs its mount effects twice under StrictMode and still exports and imports normally', async () => {
      const user = userEvent.setup();
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      const load = vi.spyOn(store, 'load');
      render(<App settingsStore={store} />, { reactStrictMode: true });
      // StrictMode replays the mount effect: the initial read runs twice.
      expect(load).toHaveBeenCalledTimes(2);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      await openSettingsTab(user);

      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('status').textContent).toBe('Backup readyPrepared a backup of 1 saved rule.');

      await uploadSettingsFile(user, 'x.json', settingsFile(newRule(existing, 'beta')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('status').textContent).toBe('Imported 1 rule1 added from x.json');
      expect((await getStoredSettings()).projectRules.map((rule) => rule.pattern)).toEqual(['alpha', 'beta']);
    });

    it('counts a single initial read without StrictMode', async () => {
      const store = new SettingsStoreImpl();
      const load = vi.spyOn(store, 'load');
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('finishes nothing visible once App unmounts during an export', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { createObjectURL } = stubDownloads();
      const store = new SettingsStoreImpl();
      const { unmount } = render(<App settingsStore={store} />, { reactStrictMode: true });
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      await openSettingsTab(user);
      const read = deferred<TintSettings>();
      const load = vi.spyOn(store, 'load').mockReturnValueOnce(read.promise);
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

      unmount();
      await act(async () => {
        read.resolve(new TintSettings([DomainProjectRule.create('exact', 'late')]));
        await read.promise;
      });
      await flush();

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(document.querySelector('a[download]')).toBeNull();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('keeps saving a queued import, in order, after App unmounts', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = new SettingsStoreImpl();
      const { unmount } = render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'existing');
      const existing = (await getStoredSettings()).projectRules[0]!;
      const gate = deferred<void>();
      const realSave = store.save.bind(store);
      const save = vi.spyOn(store, 'save').mockImplementationOnce(async (next) => {
        await gate.promise;
        await realSave(next);
      });

      // An ordinary edit whose save is held, so the import's save queues behind it.
      const addDialog = await openAddRuleModal(user);
      fireEvent.change(within(addDialog).getByLabelText('Project ID'), { target: { value: 'edit' } });
      await user.click(within(addDialog).getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'x.json', settingsFile(newRule(existing, 'imported')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      expect(save).toHaveBeenCalledTimes(1);

      unmount();
      await act(async () => {
        gate.resolve();
        await gate.promise;
      });

      await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
      const imported = save.mock.calls[1]![0];
      expect(imported.projectRules.map((rule) => rule.pattern)).toEqual(['existing', 'edit', 'imported']);
      await waitFor(async () =>
        expect((await getStoredSettings()).projectRules.map((rule) => rule.pattern)).toEqual([
          'existing',
          'edit',
          'imported',
        ]),
      );
      // Notice/modal suppression after unmount is covered by BackupCard.test.tsx ('reports nothing when an import it started finishes saving after the card is gone').
      expect(document.body.textContent).toBe('');
      expect(consoleError).not.toHaveBeenCalled();
    });
  });

  describe('Settings backup: notices', () => {
    const LIVE = '[role="alert"], [role="status"], [aria-live]';

    // Watches `target` for anything that could make an assistive technology announce: a role or
    // aria-live attribute being set or removed anywhere below it, or an inserted subtree carrying a
    // live role. Must be attached before the change it is meant to catch.
    function watchLiveRegions(target: Node) {
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((batch) => records.push(...batch));
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['role', 'aria-live'],
        attributeOldValue: true,
      });
      return () => {
        records.push(...observer.takeRecords());
        observer.disconnect();
        return records;
      };
    }

    function expectNoLiveRegionActivity(records: MutationRecord[]) {
      // The observer only reports role and aria-live. Inside a notice any such change counts;
      // elsewhere only live values do (switching tabs legitimately drops the old panel's tabpanel).
      const isLive = (value: string | null) => value === 'alert' || value === 'status';
      const attributeChanges = records
        .filter((record) => {
          if (record.type !== 'attributes') return false;
          const target = record.target as Element;
          const value = target.getAttribute(record.attributeName!);
          return (
            target.closest('[data-slot="alert-root"]') !== null ||
            record.attributeName === 'aria-live' ||
            isLive(record.oldValue) ||
            isLive(value)
          );
        })
        .map(
          (record) =>
            `${record.attributeName}: ${record.oldValue} -> ${(record.target as Element).getAttribute(record.attributeName!)}`,
        );
      const addedLive = records.flatMap((record) =>
        Array.from(record.addedNodes).filter(
          (node): node is Element =>
            node instanceof Element && (node.matches(LIVE) || node.querySelector(LIVE) !== null),
        ),
      );
      expect(attributeChanges).toEqual([]);
      expect(addedLive).toEqual([]);
    }

    // The way not to do it: a past notice rendered with a live role that an effect strips right
    // after the first commit. The role existed in the DOM, however briefly.
    function RoleRemovedAfterCommit() {
      const ref = useRef<HTMLDivElement>(null);
      useLayoutEffect(() => {
        ref.current?.removeAttribute('role');
      }, []);
      return (
        <div ref={ref} role="status">
          past notice
        </div>
      );
    }

    async function showImportFailure(user: ReturnType<typeof userEvent.setup>) {
      await uploadSettingsFile(user, 'broken.json', '{ not json');
      return screen.findByRole('alert');
    }

    it('puts only the title and description in the live region, and the detail with its copy button outside it', async () => {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);

      const alert = await showImportFailure(user);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.queryByRole('status')).toBeNull();
      expect(alert.textContent).toBe('Couldn’t import this filebroken.json could not be parsed as JSON.');
      expect(within(alert).queryByRole('button', { name: 'Copy details' })).toBeNull();
      const details = screen.getByRole('region', { name: 'Error details' });
      expect(details.textContent).toMatch(/^SyntaxError: /);
      expect(alert.contains(details)).toBe(false);
      expect(details.contains(alert)).toBe(false);
      const copy = screen.getByRole('button', { name: 'Copy details' });
      expect(details.contains(copy)).toBe(false);
      expect(alert.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(details.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // A refusal without an underlying error has neither.
      await uploadSettingsFile(user, 'other.json', '[]');
      await screen.findByText('other.json isn’t a GCP Console Tint settings file.');
      expect(screen.queryByRole('region', { name: 'Error details' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
    });

    it('renders a success notice with one status region and no detail', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      await openSettingsTab(user);
      await uploadSettingsFile(user, 'x.json', settingsFile(newRule(existing, 'beta')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(screen.getByRole('status').textContent).toBe('Imported 1 rule1 added from x.json');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('region', { name: 'Error details' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
    });

    it('shows a notice raised before leaving Settings without any live role when coming back, from the first commit', async () => {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      await showImportFailure(user);
      await user.click(screen.getByRole('tab', { name: 'Rules' }));
      await screen.findByRole('button', { name: 'Add rule' });

      const stop = watchLiveRegions(container);
      await openSettingsTab(user);
      expect(await screen.findByText('broken.json could not be parsed as JSON.')).toBeTruthy();
      expectNoLiveRegionActivity(stop());
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('region', { name: 'Error details' })).toBeTruthy();

      // The same operation again is a new notice, announced once.
      await uploadSettingsFile(user, 'broken.json', '{ not json');
      await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(1));
      expect(screen.getByRole('alert').textContent).toBe(
        'Couldn’t import this filebroken.json could not be parsed as JSON.',
      );
    });

    it('announces the same kind of status notice again after leaving and coming back', async () => {
      const user = userEvent.setup();
      stubDownloads();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      await user.click(screen.getByRole('button', { name: 'Export' }));
      await screen.findByRole('status');
      await user.click(screen.getByRole('tab', { name: 'Rules' }));
      await openSettingsTab(user);
      expect(screen.getByText('No saved rules to export')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Export' }));
      await waitFor(() => expect(screen.getAllByRole('status')).toHaveLength(1));
      expect(screen.getByRole('status').textContent).toBe(
        'No saved rules to exportAdd and save a rule, then try again.',
      );
    });

    it('catches a live role that is removed after the first commit (negative control for the check above)', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      try {
        const stop = watchLiveRegions(host);
        render(<RoleRemovedAfterCommit />, { container: host });
        const records = stop();
        expect(host.querySelector(LIVE)).toBeNull();
        expect(() => expectNoLiveRegionActivity(records)).toThrow();
      } finally {
        host.remove();
      }
    });

    it('replaces the live region element even when the next notice has the same text', async () => {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);

      const first = await showImportFailure(user);
      await uploadSettingsFile(user, 'broken.json', '{ not json');
      await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first));
      const second = screen.getByRole('alert');
      expect(second.textContent).toBe(first.textContent);
      expect(first.isConnected).toBe(false);
    });
  });

  describe('Settings backup: long failure text', () => {
    const MARKER = '\nDetails truncated.';
    const FOOTER = '\nValidation stopped after 100 issues; fix these and import again.';

    // Lines of exactly 199 units ("projectRules[NNN].pattern: " is 27 units, the message the rest).
    const issueLines = (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const path = `projectRules[${String(index).padStart(3, '0')}].pattern`;
        return { path, message: `${'m'.repeat(199 - path.length - 2)}` };
      });
    const asLines = (issues: { path: string; message: string }[]) =>
      issues.map((issue) => `${issue.path}: ${issue.message}`);

    async function importRefusedWith(error: unknown, fileName = 'big.json') {
      const user = userEvent.setup();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const store = new SettingsStoreImpl();
      render(<App settingsStore={store} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await openSettingsTab(user);
      vi.spyOn(store, 'importJson').mockImplementation(() => {
        throw error;
      });
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');
      await uploadSettingsFile(user, fileName, '{}');
      const alert = await screen.findByRole('alert');
      return { user, alert, writeText };
    }

    async function expectDetail(expected: string, opened: Awaited<ReturnType<typeof importRefusedWith>>) {
      const details = screen.getByRole('region', { name: 'Error details' });
      expect(details.textContent).toBe(expected);
      expect(expected.length).toBeLessThanOrEqual(16_384);
      await opened.user.click(screen.getByRole('button', { name: 'Copy details' }));
      expect(opened.writeText).toHaveBeenCalledWith(expected);
    }

    it('cuts 100 long issues at a line, then marks the cut and keeps the stop footer', async () => {
      const issues = issueLines(100);
      const error = new SettingsImportError({ reason: 'invalid-fields', issues, validationStopped: true });
      const opened = await importRefusedWith(error);
      // 16,384 - 19 (marker) - 65 (footer) leaves 16,300 units: 81 lines of 199 plus newlines.
      await expectDetail(`${asLines(issues).slice(0, 81).join('\n')}${MARKER}${FOOTER}`, opened);
      expect(error.failure).toEqual({ reason: 'invalid-fields', issues, validationStopped: true });
      expect((error.failure as { issues: unknown }).issues).toBe(issues);
      expect(issues).toHaveLength(100);
    });

    it('cuts 100 long issues without a footer when validation did not stop', async () => {
      const issues = issueLines(100);
      const opened = await importRefusedWith(new SettingsImportError({ reason: 'invalid-fields', issues }));
      await expectDetail(`${asLines(issues).slice(0, 81).join('\n')}${MARKER}`, opened);
    });

    it('adds the stop footer without a truncation marker when everything fits', async () => {
      const issues = issueLines(3);
      const opened = await importRefusedWith(
        new SettingsImportError({ reason: 'invalid-fields', issues, validationStopped: true }),
      );
      await expectDetail(`${asLines(issues).join('\n')}${FOOTER}`, opened);
    });

    it('names the file root "Settings file" for an issue with an empty path', async () => {
      const issues = [{ path: '', message: 'Invalid input: expected object, received string' }];
      const error = new SettingsImportError({ reason: 'invalid-fields', issues });
      const opened = await importRefusedWith(error);
      await expectDetail('Settings file: Invalid input: expected object, received string', opened);
      expect(error.failure).toEqual({
        reason: 'invalid-fields',
        issues: [{ path: '', message: 'Invalid input: expected object, received string' }],
      });
    });

    it('cuts a 20,000-character migration cause inside its single line, with no footer', async () => {
      const cause = new Error('c'.repeat(20_000));
      const error = new SettingsImportError({ reason: 'migration-failed', version: '0.1.0' }, { cause });
      const opened = await importRefusedWith(error);
      expect(opened.alert.textContent).toBe(
        'Couldn’t import this filebig.json could not be migrated from version 0.1.0.',
      );
      await expectDetail(`Error: ${'c'.repeat(16_365 - 7)}${MARKER}`, opened);
      expect(error.cause).toBe(cause);
      expect(cause.message).toHaveLength(20_000);
    });

    it('cuts a 20,000-character plain error the same way', async () => {
      const opened = await importRefusedWith(new RangeError('r'.repeat(20_000)));
      expect(opened.alert.textContent).toBe('Couldn’t import this filebig.json could not be read.');
      await expectDetail(`RangeError: ${'r'.repeat(16_365 - 12)}${MARKER}`, opened);
    });

    it.each([
      // "Error: " is 7 units; the cut is at 16,365.
      ['splits the pair', 16_365 - 7 - 1, `Error: ${'e'.repeat(16_357)}${MARKER}`],
      ['ends right after the pair', 16_365 - 7 - 2, `Error: ${'e'.repeat(16_356)}😀${MARKER}`],
    ])('never leaves half an emoji where the cut %s', async (_case, padding, expected) => {
      await expectDetail(expected, await importRefusedWith(new Error(`${'e'.repeat(padding)}${'😀'.repeat(3000)}`)));
    });

    it('shortens a long file name in the failure sentence, without splitting an emoji', async () => {
      const name = `${'n'.repeat(254)}😀${'n'.repeat(60)}.json`;
      const opened = await importRefusedWith(new SyntaxError('bad'), name);
      expect(opened.alert.textContent).toBe(`Couldn’t import this file${'n'.repeat(254)}… could not be read.`);
    });

    it.each([
      ['unsupported-version', (version: string) => `big.json was written by an unsupported version (${version}).`],
      [
        'newer-version',
        (version: string) =>
          `big.json was written by a newer version of GCP Console Tint (${version}). Update the extension, then import it again.`,
      ],
      ['migration-failed', (version: string) => `big.json could not be migrated from version ${version}.`],
    ] as const)('shortens a long %s version for display only', async (reason, sentence) => {
      const version = `0.1.0${'.0'.repeat(150)}`;
      const error = new SettingsImportError({ reason, version });
      const opened = await importRefusedWith(error);
      expect(opened.alert.textContent).toBe(`Couldn’t import this file${sentence(`${version.slice(0, 255)}…`)}`);
      expect((error.failure as { version: string }).version).toBe(version);
      expect(version).toHaveLength(305);
    });

    it.each([
      // The pair occupies units 254-255, so a 255-unit cut would keep only its high half.
      ['straddles the cut', `${'9'.repeat(254)}😀${'9'.repeat(40)}`, `${'9'.repeat(254)}…`],
      ['ends right at the cut', `${'9'.repeat(253)}😀${'9'.repeat(40)}`, `${'9'.repeat(253)}😀…`],
    ])('shortens a long version without splitting an emoji that %s', async (_case, version, shown) => {
      const opened = await importRefusedWith(new SettingsImportError({ reason: 'unsupported-version', version }));
      expect(opened.alert.textContent).toBe(
        `Couldn’t import this filebig.json was written by an unsupported version (${shown}).`,
      );
    });

    it('shortens a long file name in the success description', async () => {
      const user = userEvent.setup();
      render(<App settingsStore={new SettingsStoreImpl()} />);
      await screen.findByRole('button', { name: 'Add rule' });
      await addRule(user, 'alpha');
      const existing = (await getStoredSettings()).projectRules[0]!;
      await openSettingsTab(user);
      const name = `${'s'.repeat(300)}.json`;
      await uploadSettingsFile(user, name, settingsFile(newRule(existing, 'beta')));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Import 1 rule' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByRole('status').textContent).toBe(`Imported 1 rule1 added from ${'s'.repeat(255)}…`);
    });
  });
});
