import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SettingsImportError,
  type SettingsImportIssue,
  StoredSettingsError,
  type StoredSettingsFailure,
} from '../../../../../../port/settings-store';
import StoredSettingsRecovery from '../StoredSettingsRecovery';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Built the way the reader builds it: the StoredSettingsError's cause is the reader's
// SettingsImportError, whose own cause (for migration-failed) is the step's error.
function storedError(failure: StoredSettingsFailure, raw: unknown = { schemaVersion: '0.5.0' }, cause?: unknown) {
  return new StoredSettingsError(failure, raw, { cause: new SettingsImportError(failure, { cause }) });
}

const invalidFields = (issues: SettingsImportIssue[], validationStopped?: true) =>
  storedError(
    validationStopped ? { reason: 'invalid-fields', issues, validationStopped } : { reason: 'invalid-fields', issues },
  );

function renderRecovery(error: StoredSettingsError, onReset: () => Promise<void> = async () => {}) {
  return render(<StoredSettingsRecovery error={error} onReset={onReset} />);
}

// jsdom performs no real download: the Blob and the clicked anchor are captured instead.
function stubDownloads() {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((_blob) => 'blob:saved');
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const clicks: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureClick(this: HTMLAnchorElement) {
    clicks.push(this);
  });
  return { createObjectURL, revokeObjectURL, clicks };
}

// The Reset button itself. The tooltip and popover triggers wrapped around it are role="button"
// too, out of the Tab order, and take its text as their name.
function getResetButton(): HTMLElement {
  const button = screen.getAllByRole('button', { name: 'Reset to defaults' }).find((el) => el.tagName === 'BUTTON');
  if (!button) throw new Error('Reset to defaults button not found');
  return button;
}

async function openReset(user: ReturnType<typeof userEvent.setup>) {
  await user.click(getResetButton());
  return screen.findByRole('dialog');
}

describe('StoredSettingsRecovery', () => {
  it.each<[string, StoredSettingsError, string]>([
    [
      'invalid-fields',
      invalidFields([
        { path: 'projectRules[0].settings.topBar.height', message: 'expected a number' },
        { path: 'theme', message: 'Invalid option' },
      ]),
      'Saved settings have 2 missing or invalid fields. Export the saved data to keep a copy, then reset to defaults.',
    ],
    [
      'invalid-fields (one)',
      invalidFields([{ path: 'theme', message: 'Invalid option' }]),
      'Saved settings have 1 missing or invalid field. Export the saved data to keep a copy, then reset to defaults.',
    ],
    [
      'not-settings',
      storedError({ reason: 'not-settings' }),
      'The saved data isn’t a GCP Console Tint settings record. Export it to keep a copy, then reset to defaults.',
    ],
    [
      'unsupported-version',
      storedError({ reason: 'unsupported-version', version: '0.0.9' }),
      'The saved data was written by an unsupported version (0.0.9). Export it to keep a copy, then reset to defaults.',
    ],
    [
      'newer-version',
      storedError({ reason: 'newer-version', version: '9.9.9' }),
      'The saved data was written by a newer version of GCP Console Tint (9.9.9). Update the extension, or export the data and reset to defaults.',
    ],
    [
      'migration-failed',
      storedError({ reason: 'migration-failed', version: '0.4.1' }),
      'The saved data could not be migrated from version 0.4.1. Export it to keep a copy, then reset to defaults.',
    ],
  ])('announces %s once, with a sentence for its reason', (_reason, error, sentence) => {
    renderRecovery(error);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toBe(`Couldn’t read saved settings${sentence}`);
  });

  it('shortens a long version stamp for display', () => {
    renderRecovery(storedError({ reason: 'newer-version', version: '9'.repeat(300) }));

    expect(screen.getByRole('alert').textContent).toContain(`(${'9'.repeat(255)}…)`);
  });

  it('lists the refused fields outside the live region, naming the root path, and copies them', async () => {
    const user = userEvent.setup();
    // user-event installs a Clipboard stub on navigator; spy on that rather than replacing it.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderRecovery(
      invalidFields([
        { path: '', message: 'expected an object' },
        { path: 'projectRules[1].settings.topBar.color.custom', message: 'expected a color like #rrggbb' },
      ]),
    );

    const details = screen.getByRole('region', { name: 'Error details' });
    expect(details.textContent).toBe(
      'Saved settings: expected an object\nprojectRules[1].settings.topBar.color.custom: expected a color like #rrggbb',
    );
    expect(screen.getByRole('alert').contains(details)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(writeText).toHaveBeenCalledWith(details.textContent);
  });

  it('says when validation stopped at 100 issues', () => {
    const issues = Array.from({ length: 100 }, (_, index) => ({
      path: `projectRules[${index}].settings`,
      message: 'expected an object',
    }));
    renderRecovery(invalidFields(issues, true));

    expect(screen.getByRole('alert').textContent).toContain(
      'Saved settings have 100 missing or invalid fields or more.',
    );
    expect(screen.getByRole('region', { name: 'Error details' }).textContent).toMatch(
      /\nValidation stopped after 100 issues; more fields may be invalid\.$/,
    );
  });

  it('fits a huge issue list to the detail limit', () => {
    const issues = Array.from({ length: 100 }, (_, index) => ({ path: `p${index}`, message: 'x'.repeat(500) }));
    renderRecovery(invalidFields(issues));

    const text = screen.getByRole('region', { name: 'Error details' }).textContent ?? '';
    expect(text.length).toBeLessThanOrEqual(16_384);
    expect(text.endsWith('\nDetails truncated.')).toBe(true);
  });

  it('shows the error a migration step threw', () => {
    renderRecovery(storedError({ reason: 'migration-failed', version: '0.4.1' }, {}, new TypeError('boom')));

    expect(screen.getByRole('region', { name: 'Error details' }).textContent).toBe('TypeError: boom');
  });

  it('has no detail block for a refusal without fields or an underlying error', () => {
    renderRecovery(storedError({ reason: 'not-settings' }));

    expect(screen.queryByRole('region', { name: 'Error details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull();
  });

  it.each<[string, unknown]>([
    ['a record', { schemaVersion: '0.5.0', projectRules: [{ id: 'r1', settings: null }] }],
    ['a string', 'not-a-settings-record'],
    ['null', null],
  ])('exports %s exactly as stored, pretty-printed, under a name that is not a backup’s', async (_kind, raw) => {
    const user = userEvent.setup();
    const { createObjectURL, revokeObjectURL, clicks } = stubDownloads();
    renderRecovery(storedError({ reason: 'not-settings' }, raw));

    await user.click(screen.getByRole('button', { name: 'Export saved data' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe(JSON.stringify(raw, null, 2));
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.download).toMatch(/^gcp-console-tint-unreadable-settings-\d{4}-\d{2}-\d{2}\.json$/);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:saved'));
    expect(document.querySelector('a[download]')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('reports an export that cannot be serialized', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createObjectURL } = stubDownloads();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    renderRecovery(storedError({ reason: 'not-settings' }, circular));

    await user.click(screen.getByRole('button', { name: 'Export saved data' }));

    expect(createObjectURL).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts[1]!.textContent).toBe('Couldn’t export saved dataTry again.');
    expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] saved settings export failed', expect.any(TypeError));
  });

  it('asks before resetting, naming what goes, and resets only on confirm', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn(async () => {});
    renderRecovery(storedError({ reason: 'unsupported-version', version: '0.0.9' }), onReset);

    let dialog = await openReset(user);
    expect(within(dialog).getByRole('heading', { name: 'Reset to defaults?' })).toBeTruthy();
    expect(within(dialog).getByText('This can’t be undone.')).toBeTruthy();
    expect(within(dialog).getByRole('list', { name: 'Settings to replace' }).textContent).toBe(
      'Saved settingsversion 0.0.9',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await openReset(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onReset).not.toHaveBeenCalled();

    dialog = await openReset(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it.each<[string, StoredSettingsError, string]>([
    ['invalid fields', invalidFields([{ path: 'theme', message: 'Invalid option' }]), '1 invalid field'],
    [
      'stopped validation',
      invalidFields(
        Array.from({ length: 100 }, (_, index) => ({ path: `p${index}`, message: 'x' })),
        true,
      ),
      '100+ invalid fields',
    ],
    ['a value that is not settings', storedError({ reason: 'not-settings' }), 'not a settings record'],
  ])('names %s in the reset confirmation', async (_kind, error, detail) => {
    const user = userEvent.setup();
    renderRecovery(error);

    const dialog = await openReset(user);
    expect(within(dialog).getByRole('list', { name: 'Settings to replace' }).textContent).toBe(
      `Saved settings${detail}`,
    );
  });

  // The pending button still opens the popover, so a second confirm must not start another reset.
  it('starts no second reset while one is pending', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn(() => new Promise<void>(() => {}));
    renderRecovery(storedError({ reason: 'not-settings' }), onReset);

    let dialog = await openReset(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(getResetButton().hasAttribute('data-pending')).toBe(true));
    dialog = await openReset(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('reports a reset that could not be written and allows another try', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeError = new Error('write failed');
    const onReset = vi.fn().mockRejectedValueOnce(writeError).mockResolvedValueOnce(undefined);
    renderRecovery(storedError({ reason: 'not-settings' }), onReset);

    let dialog = await openReset(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));

    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(screen.getAllByRole('alert')[1]!.textContent).toBe(
      'Couldn’t reset settingsStorage could not be written. Try again.',
    );
    expect(consoleError).toHaveBeenCalledWith('[gcp-console-tint] settings reset failed', writeError);
    await waitFor(() => expect(getResetButton().hasAttribute('data-pending')).toBe(false));

    dialog = await openReset(user);
    await user.click(within(dialog).getByRole('button', { name: 'Reset to defaults' }));
    expect(onReset).toHaveBeenCalledTimes(2);
    // The failure notice goes when the next attempt starts.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
