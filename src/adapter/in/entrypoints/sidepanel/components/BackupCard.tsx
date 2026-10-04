import { Alert, Button, Card } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import type { ProjectRule } from '../../../../../domain/project-rule';
import type { TintSettings } from '../../../../../domain/tint-settings';
import { SettingsImportError, type SettingsStore } from '../../../../../port/settings-store';
import { assertNever } from '../../../../../utils/assert';
import { fitDetail, shortenForDisplay } from '../text';
import ImportRulesModal from './ImportRulesModal';

interface BackupCardProps {
  settingsStore: SettingsStore;
  settings: TintSettings;
  /** Reads the persisted settings once queued saves have settled; Export writes these out. */
  loadSaved: () => Promise<TintSettings>;
  /** Merges the picked rules into the current settings and reports what that did, so this card
   * can name the outcome ("1 added and 1 replaced"). */
  onImport: (selected: readonly ProjectRule[]) => Promise<{ added: number; replaced: number }>;
  /** The last export/import outcome. App holds it so it survives this card being unmounted when
   * the Rules tab is picked; it is shown here, below the card, until the next action replaces it. */
  notice: Notice | null;
  onNotice: (notice: NoticeInput) => void;
  onClearNotice: () => void;
}

// A finished export/import attempt, already worded. `detail` is the underlying error (name +
// message) or the offending fields when there are any; it exists so a user filing a support
// request can copy something diagnosable, not to be read in passing.
export type NoticeInput = {
  tone: 'success' | 'info' | 'danger';
  title: string;
  description: string;
  detail?: string;
};

// `id` is assigned by App, one per notice and never reused, so this card can tell a notice it
// raised itself from one it finds already showing when it mounts.
export type Notice = NoticeInput & { id: number };

const ALERT_STATUS = { success: 'success', info: 'accent', danger: 'danger' } as const;

const VALIDATION_STOPPED_FOOTER = 'Validation stopped after 100 issues; fix these and import again.';

// What the card is doing. Buttons render from the state copy; handlers check the ref, which
// updates synchronously, so two events dispatched before React re-renders cannot both start.
// read: a file is being read and parsed (picking another file replaces it); modal: the picked
// file's rules are on screen.
type Phase = 'idle' | 'export' | 'read' | 'modal';

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
  return `${counts} from ${shortenForDisplay(fileName)}`;
}

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`;

// One sentence per refusal reason, naming the file so it is clear which one was rejected. The
// file name and version come from the user's file, so both are shortened for display.
function failureSentence(file: string, error: unknown): string {
  const fileName = shortenForDisplay(file);
  if (error instanceof SettingsImportError) {
    switch (error.failure.reason) {
      case 'invalid-json':
        return `${fileName} could not be parsed as JSON.`;
      case 'not-settings':
        return `${fileName} isn’t a GCP Console Tint settings file.`;
      case 'unsupported-version':
        return `${fileName} was written by an unsupported version (${shortenForDisplay(error.failure.version)}).`;
      case 'newer-version':
        return `${fileName} was written by a newer version of GCP Console Tint (${shortenForDisplay(error.failure.version)}). Update the extension, then import it again.`;
      case 'migration-failed':
        return `${fileName} could not be migrated from version ${shortenForDisplay(error.failure.version)}.`;
      case 'invalid-fields':
        return `${fileName} has missing or invalid fields.`;
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
// since SettingsImportError's own message is already spelled out as the sentence above. Fitted to
// a bounded length (see fitDetail) so a huge cause or issue list cannot flood the panel.
function failureDetail(error: unknown): string | undefined {
  // A field-level refusal has no underlying error — the offending fields ARE the detail, one per
  // line, so the user can see exactly what to fix in the file. The file's root has an empty path,
  // which would read as a bare ": message" line, so it is named instead.
  if (error instanceof SettingsImportError && error.failure.reason === 'invalid-fields') {
    const lines = error.failure.issues.map(
      (issue) => `${issue.path === '' ? 'Settings file' : issue.path}: ${issue.message}`,
    );
    return fitDetail(lines.join('\n'), error.failure.validationStopped ? VALIDATION_STOPPED_FOOTER : undefined);
  }
  const underlying = error instanceof SettingsImportError ? error.cause : error;
  return underlying instanceof Error ? fitDetail(`${underlying.name}: ${underlying.message}`) : undefined;
}

// The Settings tab's only card: writing the saved rules out to a JSON file and reading one back
// in. Export writes what storage holds once queued saves have settled, not the rules on screen:
// after a failed (optimistic) save the two differ, and the file has the saved ones. It downloads
// straight from a blob URL (no downloads permission needed). Import routes the picked file through
// the SettingsStore port and, when it parses, through ImportRulesModal so the user chooses which
// rules to take before anything is saved.
//
// Export and import are asynchronous and owned by this mounted instance. `generationRef` changes
// when the instance is unmounted, so work it started finishes silently afterwards: no download,
// notice or modal from a card that is gone. Saves are not cancelled (they belong to App), and a
// blob URL already created is still released.
export default function BackupCard({
  settingsStore,
  settings,
  loadSaved,
  onImport,
  notice,
  onNotice,
  onClearNotice,
}: BackupCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const refocusExportRef = useRef(false);
  const fileReadSequenceRef = useRef(0);
  const generationRef = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const [phase, setPhaseState] = useState<Phase>('idle');
  // A notice already showing when this card mounts was announced when it was raised; rendering it
  // again (the user came back to the Settings tab) must not put it in a live region a second time.
  const mountNoticeIdRef = useRef(notice?.id ?? null);
  const [pending, setPending] = useState<{ fileName: string; rules: readonly ProjectRule[] } | null>(null);

  useEffect(() => {
    generationRef.current += 1;
    return () => {
      generationRef.current += 1;
    };
  }, []);

  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };

  // Export is disabled while it runs, and a browser moves focus off a disabled button to <body>.
  // Once it is enabled again, focus goes back to it, unless the user has moved focus elsewhere.
  useEffect(() => {
    if (phase !== 'idle' || !refocusExportRef.current) return;
    refocusExportRef.current = false;
    if (document.activeElement === document.body) exportButtonRef.current?.focus();
  }, [phase]);

  const handleExport = async () => {
    if (phaseRef.current !== 'idle') return;
    refocusExportRef.current = document.activeElement === exportButtonRef.current;
    setPhase('export');
    const generation = generationRef.current;
    onClearNotice();
    try {
      const saved = await loadSaved();
      if (generation !== generationRef.current) return;
      const count = saved.projectRules.length;
      // An empty file would only be refused on import ("contains no rules"), so none is made.
      if (count === 0) {
        setPhase('idle');
        onNotice({
          tone: 'info',
          title: 'No saved rules to export',
          description: 'Add and save a rule, then try again.',
        });
        return;
      }
      const url = URL.createObjectURL(new Blob([settingsStore.exportJson(saved)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `gcp-console-tint-settings-${today()}.json`;
      // Attached for the click and released on the next tick: Firefox only honors `download` on an
      // anchor that is in the document, and revoking the blob URL synchronously can cut off a
      // download that has not started yet. Released even if this card is gone by then.
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setPhase('idle');
      onNotice({
        tone: 'success',
        title: 'Backup ready',
        description: `Prepared a backup of ${plural(count, 'saved rule')}.`,
      });
    } catch (error) {
      if (generation !== generationRef.current) return;
      console.error('[gcp-console-tint] export failed', error);
      setPhase('idle');
      onNotice({
        tone: 'danger',
        title: 'Couldn’t create a backup',
        description: 'Saved settings could not be read or exported. Try again.',
      });
    }
  };

  // Export and an open import modal both block a new file; a file still being read does not, so
  // picking another one replaces it.
  const isFileRefused = () => phaseRef.current === 'export' || phaseRef.current === 'modal';

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Read off the event before the first await: `event.currentTarget` is only valid while the
    // handler is on the stack. Cleared even when refused, so picking the same file again fires.
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || isFileRefused()) return;
    const generation = generationRef.current;
    const sequence = ++fileReadSequenceRef.current;
    const isCurrent = () => generation === generationRef.current && sequence === fileReadSequenceRef.current;
    setPhase('read');
    onClearNotice();
    try {
      const contents = await file.text();
      if (!isCurrent()) return;
      const settingsFromFile = settingsStore.importJson(contents);
      setPending({ fileName: file.name, rules: settingsFromFile.projectRules });
      setPhase('modal');
    } catch (error) {
      if (!isCurrent()) return;
      // Logged as well as shown: the alert carries the name and message, DevTools keeps the stack.
      console.error('[gcp-console-tint] import failed', error);
      setPhase('idle');
      onNotice({
        tone: 'danger',
        title: 'Couldn’t import this file',
        description: failureSentence(file.name, error),
        detail: failureDetail(error),
      });
    }
  };

  const handleImportOpenChange = (isOpen: boolean) => {
    if (!isOpen) setPhase('idle');
  };

  // A rejected onImport propagates to ImportRulesModal, which keeps itself open for a retry.
  const handleImport = async (selected: readonly ProjectRule[]) => {
    const generation = generationRef.current;
    const fileName = pending?.fileName ?? '';
    const { added, replaced } = await onImport(selected);
    if (generation !== generationRef.current) return;
    setPhase('idle');
    onNotice({
      tone: 'success',
      title: `Imported ${plural(added + replaced, 'rule')}`,
      description: successDescription(fileName, added, replaced),
    });
  };

  const isBlockingFile = phase === 'export' || phase === 'modal';
  // Only a notice raised while this card is mounted is announced: its title and description sit in
  // a live region keyed by the notice id, so a repeat of the same text is still a new region.
  const liveRole =
    notice === null || notice.id === mountNoticeIdRef.current
      ? undefined
      : notice.tone === 'danger'
        ? 'alert'
        : 'status';
  const detail = notice?.detail;

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
              <Button
                ref={exportButtonRef}
                variant="outline"
                size="sm"
                className="shrink-0"
                isDisabled={phase !== 'idle'}
                onPress={() => void handleExport()}
              >
                <DownloadIcon />
                Export
              </Button>
            </div>

            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm">Import</span>
                <span className="text-xs text-muted">Add rules from a JSON file</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                isDisabled={isBlockingFile}
                onPress={() => {
                  if (!isFileRefused()) fileInputRef.current?.click();
                }}
              >
                <UploadIcon />
                Import…
              </Button>
            </div>
            {/* The native file picker can only be opened from a real file input, so one is kept
                visually hidden (not `hidden`, which would make it unreachable) behind the button
                above, and out of the tab order so keyboard users reach the button instead. */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              aria-label="Import settings file"
              className="sr-only"
              tabIndex={-1}
              disabled={isBlockingFile}
              onChange={handleFileChange}
            />
          </div>
        </Card.Content>
      </Card>

      {notice !== null && (
        <Alert status={ALERT_STATUS[notice.tone]}>
          <Alert.Indicator />
          <Alert.Content>
            <div key={notice.id} role={liveRole}>
              <Alert.Title>{notice.title}</Alert.Title>
              <Alert.Description>{notice.description}</Alert.Description>
            </div>
            {/* Outside the live region: a long detail is for copying, not for being read out. */}
            {detail !== undefined && (
              <>
                <section aria-label="Error details" className="mt-2 w-full">
                  <div className="w-full rounded-xl bg-surface-secondary p-2 font-mono text-xs break-all whitespace-pre-wrap">
                    {detail}
                  </div>
                </section>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 self-end"
                  onPress={() => {
                    void navigator.clipboard?.writeText(detail).catch((error) => {
                      console.error('[gcp-console-tint] clipboard copy failed', error);
                    });
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
        isOpen={phase === 'modal'}
        onOpenChange={handleImportOpenChange}
        fileName={pending?.fileName ?? ''}
        incoming={pending?.rules ?? []}
        current={settings}
        onImport={handleImport}
      />
    </>
  );
}
