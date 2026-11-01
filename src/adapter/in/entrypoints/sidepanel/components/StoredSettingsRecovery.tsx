import { Alert, Button } from '@heroui/react';
import { useRef, useState } from 'react';
import { SettingsImportError, type StoredSettingsError } from '../../../../../port/settings-store';
import { assertNever } from '../../../../../utils/assert';
import { downloadJson, today } from '../download';
import { fitDetail, issueLines, plural, shortenForDisplay } from '../text';
import { DownloadIcon } from './BackupCard';
import DeleteConfirmPopover from './DeleteConfirmPopover';
import ErrorDetails from './ErrorDetails';

const VALIDATION_STOPPED_FOOTER = 'Validation stopped after 100 issues; more fields may be invalid.';

// One sentence per reason. Versions come from the stored value, so they are shortened for display.
function description(error: StoredSettingsError): string {
  const { failure } = error;
  switch (failure.reason) {
    case 'invalid-fields':
      return `Saved settings have ${plural(failure.issues.length, 'missing or invalid field')}${failure.validationStopped ? ' or more' : ''}. Export the saved data to keep a copy, then reset to defaults.`;
    case 'not-settings':
      return 'The saved data isn’t a GCP Console Tint settings record. Export it to keep a copy, then reset to defaults.';
    case 'unsupported-version':
      return `The saved data was written by an unsupported version (${shortenForDisplay(failure.version)}). Export it to keep a copy, then reset to defaults.`;
    case 'newer-version':
      return `The saved data was written by a newer version of GCP Console Tint (${shortenForDisplay(failure.version)}). Update the extension, or export the data and reset to defaults.`;
    case 'migration-failed':
      return `The saved data could not be migrated from version ${shortenForDisplay(failure.version)}. Export it to keep a copy, then reset to defaults.`;
    default:
      return assertNever(failure);
  }
}

// The fields that were refused, or the error a migration step threw (the StoredSettingsError's
// cause is the reader's SettingsImportError, whose own cause is that error).
function detail(error: StoredSettingsError): string | undefined {
  const { failure } = error;
  if (failure.reason === 'invalid-fields') {
    return fitDetail(
      issueLines(failure.issues, 'Saved settings'),
      failure.validationStopped ? VALIDATION_STOPPED_FOOTER : undefined,
    );
  }
  const underlying = error.cause instanceof SettingsImportError ? error.cause.cause : error.cause;
  return underlying instanceof Error ? fitDetail(`${underlying.name}: ${underlying.message}`) : undefined;
}

// What Reset replaces, as the confirmation lists it.
function confirmDetail(error: StoredSettingsError): string {
  const { failure } = error;
  switch (failure.reason) {
    case 'invalid-fields':
      return failure.validationStopped
        ? `${failure.issues.length}+ invalid fields`
        : plural(failure.issues.length, 'invalid field');
    case 'not-settings':
      return 'not a settings record';
    case 'unsupported-version':
    case 'newer-version':
    case 'migration-failed':
      return `version ${shortenForDisplay(failure.version)}`;
    default:
      return assertNever(failure);
  }
}

interface StoredSettingsRecoveryProps {
  error: StoredSettingsError;
  /** Saves empty settings in place of the stored value; App then shows the normal screen. */
  onReset: () => Promise<void>;
}

// Shown instead of the rules when the stored settings cannot be read: nothing is repaired with a
// default, so the user sees which fields are wrong, can export the stored value exactly as it is,
// and can replace it with empty settings after confirming. There is no import here: an import
// merges into the current settings and saves, which would be a reset by another name.
//
// The side panel does not watch storage, so a reset made in another open side panel shows here
// only after a reload.
export default function StoredSettingsRecovery({ error, onReset }: StoredSettingsRecoveryProps) {
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<{ id: number; title: string; description: string } | null>(null);
  // Never reused, so a repeated failure is a new live region and is announced again.
  const noticeIdRef = useRef(0);
  const errorDetail = detail(error);

  const showNotice = (title: string, noticeDescription: string) => {
    noticeIdRef.current += 1;
    setNotice({ id: noticeIdRef.current, title, description: noticeDescription });
  };

  // A different name from a backup (gcp-console-tint-settings-…), so this file is not taken for one.
  const handleExport = () => {
    setNotice(null);
    try {
      const text: string | undefined = JSON.stringify(error.raw, null, 2);
      if (text === undefined) throw new TypeError('The saved data has no JSON form');
      downloadJson(`gcp-console-tint-unreadable-settings-${today()}.json`, text);
    } catch (exportError) {
      console.error('[gcp-console-tint] saved settings export failed', exportError);
      showNotice('Couldn’t export saved data', 'Try again.');
    }
  };

  const handleReset = () => {
    // The pending button still opens the confirmation, so a second confirm lands here too.
    if (resetting) return;
    setNotice(null);
    setResetting(true);
    // On success App replaces this screen, so only a failure comes back here.
    onReset().catch((resetError) => {
      console.error('[gcp-console-tint] settings reset failed', resetError);
      setResetting(false);
      showNotice('Couldn’t reset settings', 'Storage could not be written. Try again.');
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          {/* Announced once: the screen appears after an asynchronous load. */}
          <div key="load-error" role="alert">
            <Alert.Title>Couldn’t read saved settings</Alert.Title>
            <Alert.Description>{description(error)}</Alert.Description>
          </div>
          {errorDetail !== undefined && <ErrorDetails detail={errorDetail} />}
        </Alert.Content>
      </Alert>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onPress={handleExport}>
          <DownloadIcon />
          Export saved data
        </Button>
        <DeleteConfirmPopover
          question="Reset to defaults?"
          itemsLabel="Settings to replace"
          items={[{ id: 'saved', text: 'Saved settings', detail: confirmDetail(error) }]}
          confirmLabel="Reset to defaults"
          tooltipLabel="Reset to defaults"
          monospace={false}
          onConfirm={handleReset}
        >
          <Button variant="danger" size="sm" isPending={resetting}>
            Reset to defaults
          </Button>
        </DeleteConfirmPopover>
      </div>

      {notice !== null && (
        <Alert status="danger" className="notice-enter">
          <Alert.Indicator />
          <Alert.Content>
            <div key={notice.id} role="alert">
              <Alert.Title>{notice.title}</Alert.Title>
              <Alert.Description>{notice.description}</Alert.Description>
            </div>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}
