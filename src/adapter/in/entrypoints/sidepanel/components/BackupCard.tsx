import { Alert, Button, Card } from '@heroui/react';
import { useRef, useState } from 'react';
import type { ProjectRule } from '../../../../../domain/project-rule';
import type { TintSettings } from '../../../../../domain/tint-settings';
import { SettingsImportError, type SettingsStore } from '../../../../../port/settings-store';
import { assertNever } from '../../../../../utils/assert';
import ImportRulesModal from './ImportRulesModal';

interface BackupCardProps {
  settingsStore: SettingsStore;
  settings: TintSettings;
  /** Merges the picked rules into the current settings and reports what that did, so this card
   * can name the outcome ("1 added and 1 replaced"). */
  onImport: (selected: readonly ProjectRule[]) => { added: number; replaced: number };
}

// What the last export/import attempt produced, shown as an Alert below the card until the next
// action replaces it.
type Notice =
  | { status: 'success'; fileName: string; added: number; replaced: number }
  // `detail` is the underlying error (name + message) when there is one; it exists so a user
  // filing a support request can copy something diagnosable, not to be read in passing.
  | { status: 'danger'; sentence: string; detail?: string };

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 21h14" />
    </svg>
  );
}

// Local calendar date, not UTC: the file name should read as the day the user pressed Export.
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function successDescription(fileName: string, added: number, replaced: number): string {
  const counts = [added > 0 ? `${added} added` : '', replaced > 0 ? `${replaced} replaced` : '']
    .filter((part) => part !== '')
    .join(' and ');
  return `${counts} from ${fileName}`;
}

// One sentence per refusal reason, naming the file so it is clear which one was rejected.
function failureSentence(fileName: string, error: unknown): string {
  if (error instanceof SettingsImportError) {
    switch (error.failure.reason) {
      case 'invalid-json':
        return `${fileName} could not be parsed as JSON.`;
      case 'not-settings':
        return `${fileName} isn’t a GCP Console Tint settings file.`;
      case 'unsupported-version':
        return `${fileName} was written by an unsupported version (${error.failure.version}).`;
      case 'no-rules':
        return `${fileName} contains no rules.`;
      default:
        return assertNever(error.failure);
    }
  }
  // Anything that isn't a refusal: reading the file failed (permissions, a vanished file, ...).
  return `${fileName} could not be read.`;
}

// The error worth showing verbatim: for a refusal that's its cause (e.g. the JSON SyntaxError),
// since SettingsImportError's own message is already spelled out as the sentence above.
function failureDetail(error: unknown): string | undefined {
  const underlying = error instanceof SettingsImportError ? error.cause : error;
  return underlying instanceof Error ? `${underlying.name}: ${underlying.message}` : undefined;
}

// The Settings tab's only card: writing the current rules out to a JSON file and reading one back
// in. Export downloads straight from a blob URL (no downloads permission needed); import routes
// the picked file through the SettingsStore port and, when it parses, through ImportRulesModal so
// the user chooses which rules to take before anything is saved.
export default function BackupCard({ settingsStore, settings, onImport }: BackupCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<{ fileName: string; rules: readonly ProjectRule[] } | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const handleExport = () => {
    setNotice(null);
    const url = URL.createObjectURL(new Blob([settingsStore.exportJson(settings)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `gcp-console-tint-settings-${today()}.json`;
    // Attached for the click and released on the next tick: Firefox only honors `download` on an
    // anchor that is in the document, and revoking the blob URL synchronously can cut off a
    // download that has not started yet.
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Read off the event before the first await: `event.currentTarget` is only valid while the
    // handler is on the stack.
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setNotice(null);
    try {
      const settingsFromFile = settingsStore.importJson(await file.text());
      setPending({ fileName: file.name, rules: settingsFromFile.projectRules });
      setIsImportOpen(true);
    } catch (error) {
      // Logged as well as shown: the alert carries the name and message, DevTools keeps the stack.
      console.error('[gcp-console-tint] import failed', error);
      setNotice({ status: 'danger', sentence: failureSentence(file.name, error), detail: failureDetail(error) });
    } finally {
      // Cleared once the file has been read, so picking the same file again still fires a change
      // event — without this, retrying the same path would look like nothing happened.
      input.value = '';
    }
  };

  const handleImport = (selected: readonly ProjectRule[]) => {
    const { added, replaced } = onImport(selected);
    setNotice({ status: 'success', fileName: pending?.fileName ?? '', added, replaced });
  };

  const importedCount = notice?.status === 'success' ? notice.added + notice.replaced : 0;

  return (
    <>
      <Card>
        <Card.Content className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Backup</div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-2">
            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm">Export</span>
                <span className="text-xs text-muted">Save all rules to a JSON file</span>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onPress={handleExport}>
                <DownloadIcon />
                Export
              </Button>
            </div>

            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm">Import</span>
                <span className="text-xs text-muted">Add rules from a JSON file</span>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onPress={() => fileInputRef.current?.click()}>
                <UploadIcon />
                Import…
              </Button>
            </div>
            {/* The native file picker can only be opened from a real file input, so one is kept
                visually hidden (not `hidden`, which would make it unreachable) behind the button
                above. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import settings file"
              className="sr-only"
              onChange={handleFileChange}
            />
          </div>
        </Card.Content>
      </Card>

      {notice?.status === 'success' && (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              Imported {importedCount} {importedCount === 1 ? 'rule' : 'rules'}
            </Alert.Title>
            <Alert.Description>{successDescription(notice.fileName, notice.added, notice.replaced)}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {notice?.status === 'danger' && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Couldn’t import this file</Alert.Title>
            <Alert.Description>{notice.sentence}</Alert.Description>
            {notice.detail !== undefined && (
              <>
                <div className="mt-2 w-full rounded-xl bg-surface-secondary p-2 font-mono text-xs break-all whitespace-pre-wrap">
                  {notice.detail}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 self-end"
                  onPress={() => {
                    void navigator.clipboard?.writeText(notice.detail ?? '');
                  }}
                >
                  Copy details
                </Button>
              </>
            )}
          </Alert.Content>
        </Alert>
      )}

      <ImportRulesModal
        isOpen={isImportOpen}
        onOpenChange={setIsImportOpen}
        fileName={pending?.fileName ?? ''}
        incoming={pending?.rules ?? []}
        current={settings}
        onImport={handleImport}
      />
    </>
  );
}
