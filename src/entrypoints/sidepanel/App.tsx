import { Button, Card, Input, Switch, Tooltip } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import AddRuleModal from '../../components/AddRuleModal';
import ColorSwatchField from '../../components/ColorSwatchField';
import DeleteConfirmPopover from '../../components/DeleteConfirmPopover';
import MatchTypeSelect from '../../components/MatchTypeSelect';
import PaletteColorPicker from '../../components/PaletteColorPicker';
import type { ColorSelection, MatchType, PaletteEntry, ProjectRule, ProjectSettings, TintSettings } from '../../types';
import { contrastTextColor } from '../../utils/color';
import {
  cloneProjectSettings,
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_SETTINGS,
  effectiveSchemaVersion,
  loadSettings,
  resolveSelectedColor,
} from '../../utils/settings';

const nameInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

// The sidepanel is a single-page app with two views: the project rule list (the default
// landing page) and a detail page for editing one rule's settings.
type View = { type: 'list' } | { type: 'detail'; ruleId: string };

// The three tinted surfaces that share the {enabled, color, ...} shape (ColorSelection plus
// surface-specific fields). Palette is deliberately excluded: it has no `color` field and its
// entries array needs its own update path (see handleAddColor/handlePaletteNameChange/etc.).
type ColorSurfaceKey = 'topBar' | 'platformBar' | 'platformBarText';

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function PlusIcon() {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden="true">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

function PencilIcon() {
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
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function DuplicateIcon() {
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
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ArrowLeftIcon() {
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
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </svg>
  );
}

// Wraps an icon-only Button in a HeroUI Tooltip that shows `label` on hover. Tooltip.Trigger
// always renders a focusable wrapper element (via react-aria's useFocusable) around its
// child, since it also needs to support non-interactive children; our children are always
// already-focusable Buttons, so that wrapper would add a redundant Tab stop right next to the
// real button. Passing tabIndex={-1} to Tooltip.Trigger removes the wrapper from the Tab
// order (Tooltip.Trigger spreads extra props onto the wrapper via
// mergeProps(focusableProps, props), with our props last, so tabIndex={-1} wins there) while
// leaving the Button's own tabIndex, and hover display, unaffected. Accepted tradeoff:
// tabbing to the button no longer opens the tooltip via keyboard, since keyboard-focus
// triggering is wired to the wrapper's focus event, not the inner button's.
function IconButtonTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip delay={500}>
      <Tooltip.Trigger tabIndex={-1}>{children}</Tooltip.Trigger>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}

function App() {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ type: 'list' });
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Native HTML5 drag-and-drop only lets an element itself be `draggable`; to restrict drag
  // initiation to the grip handle (rather than the whole row, e.g. its icon buttons or text)
  // we track whether the most recent mousedown landed on the grip, and cancel dragstart
  // otherwise.
  const dragHandleActiveRef = useRef(false);

  useEffect(() => {
    const currentVersion = browser.runtime.getManifest().version;
    browser.storage.local.get('tintSettings').then((result) => {
      setSettings(loadSettings(result.tintSettings, currentVersion));
    });
  }, []);

  // Defensive: if the rule currently open in detail view disappears (there is no UI path to
  // this today since Delete only acts from the list, but this keeps the view consistent
  // should that change), fall back to the list instead of rendering a phantom rule's page.
  useEffect(() => {
    if (view.type === 'detail' && !settings.projectRules.some((r) => r.id === view.ruleId)) {
      setView({ type: 'list' });
    }
  }, [view, settings.projectRules]);

  const save = (next: TintSettings) => {
    // Floor at CURRENT_SCHEMA_VERSION (see effectiveSchemaVersion): stamping the raw manifest
    // version here could label current-shape nested data with an older schemaVersion, causing
    // the next load to re-run the flat->nested migration against already-nested data and
    // silently reset the user's values to defaults.
    const stamped: TintSettings = {
      ...next,
      schemaVersion: effectiveSchemaVersion(browser.runtime.getManifest().version),
    };
    setSettings(stamped);
    browser.storage.local.set({ tintSettings: stamped });
  };

  const updateCurrentSettings = (patch: Partial<ProjectSettings>) => {
    if (view.type !== 'detail') return;
    const ruleId = view.ruleId;
    save({
      ...settings,
      projectRules: settings.projectRules.map((r) =>
        r.id === ruleId ? { ...r, settings: { ...r.settings, ...patch } } : r,
      ),
    });
  };

  // Merges `patch` over the current rule's surface object (topBar/platformBar/platformBarText)
  // and saves it — the generic replacement for the old per-field handler zoo
  // (handleTopBarEnabledChange, handleTopBarStripesChange, ...). `patch` may itself include a
  // full replacement `color`, so composite updates that must land in a single save (e.g.
  // "pick a palette entry AND clear auto") go through this directly rather than
  // updateSurfaceColor.
  function updateSurface<K extends ColorSurfaceKey>(key: K, patch: Partial<ProjectSettings[K]>) {
    updateCurrentSettings({ [key]: { ...currentSettings[key], ...patch } } as Partial<ProjectSettings>);
  }

  // Merges `patch` over the current rule's surface.color (ColorSelection) — the common case of
  // updateSurface where only the color changes.
  function updateSurfaceColor(key: ColorSurfaceKey, patch: Partial<ColorSelection>) {
    const surface = currentSettings[key];
    updateCurrentSettings({ [key]: { ...surface, color: { ...surface.color, ...patch } } } as Partial<ProjectSettings>);
  }

  const handleAddRule = (matchType: MatchType, pattern: string) => {
    const rule: ProjectRule = {
      id: crypto.randomUUID(),
      matchType,
      pattern,
      settings: cloneProjectSettings(DEFAULT_PROJECT_SETTINGS),
    };
    save({ ...settings, projectRules: [...settings.projectRules, rule] });
  };

  const handlePatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (view.type !== 'detail') return;
    const pattern = e.target.value;
    const ruleId = view.ruleId;
    save({
      ...settings,
      projectRules: settings.projectRules.map((r) => (r.id === ruleId ? { ...r, pattern } : r)),
    });
  };

  const handleMatchTypeChange = (matchType: MatchType) => {
    if (view.type !== 'detail') return;
    const ruleId = view.ruleId;
    save({
      ...settings,
      projectRules: settings.projectRules.map((r) => (r.id === ruleId ? { ...r, matchType } : r)),
    });
  };

  const handleDuplicateRule = (id: string) => {
    const index = settings.projectRules.findIndex((r) => r.id === id);
    if (index === -1) return;
    const original = settings.projectRules[index];
    const copy: ProjectRule = {
      id: crypto.randomUUID(),
      matchType: original.matchType,
      pattern: original.pattern,
      settings: cloneProjectSettings(original.settings),
    };
    const next = [...settings.projectRules];
    next.splice(index + 1, 0, copy);
    save({ ...settings, projectRules: next });
  };

  // Delete is confirm-gated via DeleteConfirmPopover (anchored to the row's Delete button);
  // this handler is only ever invoked from that popover's confirm action.
  const handleDeleteRule = (id: string) => {
    save({ ...settings, projectRules: settings.projectRules.filter((r) => r.id !== id) });
  };

  const handleGripMouseDown = () => {
    dragHandleActiveRef.current = true;
  };

  const handleGripMouseUp = () => {
    dragHandleActiveRef.current = false;
  };

  const handleRowDragStart = (index: number) => (e: React.DragEvent) => {
    if (!dragHandleActiveRef.current) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    setDraggingIndex(index);
  };

  const handleRowDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleRowDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    dragHandleActiveRef.current = false;
    setDragOverIndex(null);
    if (draggingIndex === null || draggingIndex === index) {
      setDraggingIndex(null);
      return;
    }
    const reordered = [...settings.projectRules];
    const [moved] = reordered.splice(draggingIndex, 1);
    reordered.splice(index, 0, moved);
    save({ ...settings, projectRules: reordered });
    setDraggingIndex(null);
  };

  const handleRowDragEnd = () => {
    dragHandleActiveRef.current = false;
    setDraggingIndex(null);
    setDragOverIndex(null);
  };

  // Shows a 2px inset accent line at the edge of `index` marking where the dragged row would
  // land if dropped there right now (matches the splice-based reorder in handleRowDrop:
  // dropping on a row before the dragged one inserts above it, after inserts below). Uses an
  // inset box-shadow rather than a border so it never shifts layout/row height.
  const dropIndicatorClassName = (index: number): string => {
    if (draggingIndex === null || dragOverIndex !== index || index === draggingIndex) return '';
    return dragOverIndex < draggingIndex
      ? 'shadow-[inset_0_2px_0_0_var(--focus)]'
      : 'shadow-[inset_0_-2px_0_0_var(--focus)]';
  };

  const handleAddColor = () => {
    const entry: PaletteEntry = {
      id: crypto.randomUUID(),
      name: `Color ${currentSettings.palette.entries.length + 1}`,
      color: DEFAULT_PROJECT_SETTINGS.topBar.color.custom,
    };
    updateCurrentSettings({
      palette: { ...currentSettings.palette, entries: [...currentSettings.palette.entries, entry] },
    });
  };

  const handlePaletteNameChange = (id: string, name: string) => {
    updateCurrentSettings({
      palette: {
        ...currentSettings.palette,
        entries: currentSettings.palette.entries.map((e) => (e.id === id ? { ...e, name } : e)),
      },
    });
  };

  const handlePaletteColorChange = (id: string, color: string) => {
    updateCurrentSettings({
      palette: {
        ...currentSettings.palette,
        entries: currentSettings.palette.entries.map((e) => (e.id === id ? { ...e, color } : e)),
      },
    });
  };

  // Palette entries and their references are scoped to the currently-edited rule only;
  // removing an entry here does not touch any other rule's palette/references. All three
  // surfaces' color references are cleared atomically alongside the entry removal, in the
  // same save, so storage never passes through an intermediate state with a dangling paletteId.
  const handleRemoveColor = (id: string) => {
    const clearRef = (color: ColorSelection): ColorSelection =>
      color.paletteId === id ? { ...color, paletteId: null } : color;
    updateCurrentSettings({
      palette: { ...currentSettings.palette, entries: currentSettings.palette.entries.filter((e) => e.id !== id) },
      topBar: { ...currentSettings.topBar, color: clearRef(currentSettings.topBar.color) },
      platformBar: { ...currentSettings.platformBar, color: clearRef(currentSettings.platformBar.color) },
      platformBarText: { ...currentSettings.platformBarText, color: clearRef(currentSettings.platformBarText.color) },
    });
  };

  const currentRule = view.type === 'detail' ? settings.projectRules.find((r) => r.id === view.ruleId) : undefined;
  // Falls back to the built-in defaults only for the transient frame before the "rule
  // disappeared" effect above navigates back to the list.
  const currentSettings: ProjectSettings = currentRule ? currentRule.settings : DEFAULT_PROJECT_SETTINGS;

  const topBarEffectiveColor = resolveSelectedColor(currentSettings.palette, currentSettings.topBar.color);
  const platformBarEffectiveColor = resolveSelectedColor(currentSettings.palette, currentSettings.platformBar.color);
  const platformBarTextEffectiveColor = currentSettings.platformBarText.auto
    ? contrastTextColor(platformBarEffectiveColor)
    : resolveSelectedColor(currentSettings.palette, currentSettings.platformBarText.color);

  if (view.type === 'detail') {
    const detailTitle = currentRule?.pattern ?? '';

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <IconButtonTooltip label="Back">
            <Button
              isIconOnly
              variant="outline"
              size="sm"
              aria-label="Back"
              className="shrink-0"
              onPress={() => setView({ type: 'list' })}
            >
              <ArrowLeftIcon />
            </Button>
          </IconButtonTooltip>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{detailTitle}</h1>
        </div>

        {currentRule && (
          <Card>
            <Card.Content className="flex flex-col gap-1">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <span className="text-sm">Match type</span>
                <MatchTypeSelect value={currentRule.matchType} onChange={handleMatchTypeChange} />
              </div>
              <div className="flex min-h-8 items-center justify-between gap-2">
                <span className="text-sm">{currentRule.matchType === 'regex' ? 'Pattern' : 'Project ID'}</span>
                <Input
                  aria-label={currentRule.matchType === 'regex' ? 'Pattern' : 'Project ID'}
                  value={currentRule.pattern}
                  onChange={handlePatternChange}
                  className={nameInputClassName}
                />
              </div>
              {currentRule.matchType === 'regex' && !isValidPattern(currentRule.pattern) && (
                <span className="text-sm text-danger">Invalid regular expression</span>
              )}
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.palette.enabled}
              onChange={(isSelected) =>
                updateCurrentSettings({ palette: { ...currentSettings.palette, enabled: isSelected } })
              }
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Color palette
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.palette.enabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                {currentSettings.palette.entries.map((entry) => (
                  <div key={entry.id} className="@container flex items-center justify-between gap-2">
                    <Input
                      aria-label="Color name"
                      placeholder="Name"
                      value={entry.name}
                      onChange={(e) => handlePaletteNameChange(entry.id, e.target.value)}
                      className={nameInputClassName}
                    />
                    <ColorSwatchField
                      ariaLabel={`${entry.name || '(unnamed)'} color`}
                      value={entry.color}
                      onChange={(e) => handlePaletteColorChange(entry.id, e.target.value)}
                      hexHidableOnNarrow
                    />
                    <DeleteConfirmPopover
                      question="Remove this color?"
                      target={entry.name || '(unnamed)'}
                      confirmLabel="Remove"
                      tooltipLabel="Remove color"
                      onConfirm={() => handleRemoveColor(entry.id)}
                    >
                      <Button isIconOnly variant="outline" size="sm" aria-label="Remove color" className="shrink-0">
                        <TrashIcon />
                      </Button>
                    </DeleteConfirmPopover>
                  </div>
                ))}
                <IconButtonTooltip label="Add color">
                  <Button isIconOnly variant="outline" aria-label="Add color" onPress={handleAddColor}>
                    <PlusIcon />
                  </Button>
                </IconButtonTooltip>
              </div>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.topBar.enabled}
              onChange={(isSelected) => updateSurface('topBar', { enabled: isSelected })}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Top bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.topBar.enabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Top bar color"
                    paletteEnabled={currentSettings.palette.enabled}
                    palette={currentSettings.palette.entries}
                    paletteId={currentSettings.topBar.color.paletteId}
                    customColor={currentSettings.topBar.color.custom}
                    effectiveColor={topBarEffectiveColor}
                    onSelectPaletteEntry={(id) => updateSurfaceColor('topBar', { paletteId: id })}
                    onSelectCustomColor={(color) => updateSurfaceColor('topBar', { paletteId: null, custom: color })}
                  />
                </div>
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Height</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      aria-label="Top bar height"
                      min={1}
                      max={40}
                      value={currentSettings.topBar.height}
                      onChange={(e) => {
                        const value = e.target.valueAsNumber;
                        if (Number.isFinite(value)) updateSurface('topBar', { height: value });
                      }}
                      className="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                    />
                    <span className="text-sm text-muted">px</span>
                  </div>
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.topBar.stripes}
                  onChange={(isSelected) => updateSurface('topBar', { stripes: isSelected })}
                >
                  <Switch.Content className="flex w-full items-center justify-between">
                    <span className="text-sm font-normal">Stripes</span>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.platformBar.enabled}
              onChange={(isSelected) => updateSurface('platformBar', { enabled: isSelected })}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.platformBar.enabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Platform Bar color"
                    paletteEnabled={currentSettings.palette.enabled}
                    palette={currentSettings.palette.entries}
                    paletteId={currentSettings.platformBar.color.paletteId}
                    customColor={currentSettings.platformBar.color.custom}
                    effectiveColor={platformBarEffectiveColor}
                    onSelectPaletteEntry={(id) => updateSurfaceColor('platformBar', { paletteId: id })}
                    onSelectCustomColor={(color) =>
                      updateSurfaceColor('platformBar', { paletteId: null, custom: color })
                    }
                  />
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.platformBar.stripes}
                  onChange={(isSelected) => updateSurface('platformBar', { stripes: isSelected })}
                >
                  <Switch.Content className="flex w-full items-center justify-between">
                    <span className="text-sm font-normal">Stripes</span>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
            )}
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.platformBarText.enabled}
              onChange={(isSelected) => updateSurface('platformBarText', { enabled: isSelected })}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar text color
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.platformBarText.enabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Platform Bar text color"
                    paletteEnabled={currentSettings.palette.enabled}
                    palette={currentSettings.palette.entries}
                    paletteId={currentSettings.platformBarText.color.paletteId}
                    customColor={currentSettings.platformBarText.color.custom}
                    effectiveColor={platformBarTextEffectiveColor}
                    onSelectPaletteEntry={(id) =>
                      updateSurface('platformBarText', {
                        color: { ...currentSettings.platformBarText.color, paletteId: id },
                        auto: false,
                      })
                    }
                    onSelectCustomColor={(color) =>
                      updateSurface('platformBarText', {
                        color: { ...currentSettings.platformBarText.color, paletteId: null, custom: color },
                        auto: false,
                      })
                    }
                    supportsAuto
                    autoSelected={currentSettings.platformBarText.auto}
                    onSelectAuto={() => updateSurface('platformBarText', { auto: true })}
                  />
                </div>
              </div>
            )}
          </Card.Content>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold">GCP Console Tint</h1>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Projects</div>
            <AddRuleModal onAdd={handleAddRule}>
              <Button isIconOnly variant="outline" aria-label="Add rule" className="shrink-0">
                <PlusIcon />
              </Button>
            </AddRuleModal>
          </div>

          {settings.projectRules.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              {settings.projectRules.map((rule, index) => (
                // biome-ignore lint/a11y/noStaticElementInteractions: native HTML5 drag-and-drop row reordering; no keyboard-accessible equivalent yet
                <div
                  key={rule.id}
                  draggable
                  onDragStart={handleRowDragStart(index)}
                  onDragOver={handleRowDragOver(index)}
                  onDrop={handleRowDrop(index)}
                  onDragEnd={handleRowDragEnd}
                  className={`flex min-h-8 items-center gap-2 ${draggingIndex === index ? 'opacity-50' : ''} ${dropIndicatorClassName(index)}`}
                >
                  <span
                    aria-hidden="true"
                    className="cursor-grab text-muted"
                    onMouseDown={handleGripMouseDown}
                    onMouseUp={handleGripMouseUp}
                  >
                    <GripIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{rule.pattern}</span>
                  <span className="shrink-0 text-xs text-muted">{rule.matchType}</span>
                  <IconButtonTooltip label="Edit">
                    <Button
                      isIconOnly
                      variant="outline"
                      size="sm"
                      aria-label="Edit"
                      className="shrink-0"
                      onPress={() => setView({ type: 'detail', ruleId: rule.id })}
                    >
                      <PencilIcon />
                    </Button>
                  </IconButtonTooltip>
                  <IconButtonTooltip label="Duplicate">
                    <Button
                      isIconOnly
                      variant="outline"
                      size="sm"
                      aria-label="Duplicate"
                      className="shrink-0"
                      onPress={() => handleDuplicateRule(rule.id)}
                    >
                      <DuplicateIcon />
                    </Button>
                  </IconButtonTooltip>
                  <DeleteConfirmPopover
                    question="Delete this rule?"
                    target={rule.pattern}
                    confirmLabel="Delete"
                    tooltipLabel="Delete"
                    onConfirm={() => handleDeleteRule(rule.id)}
                  >
                    <Button isIconOnly variant="outline" size="sm" aria-label="Delete" className="shrink-0">
                      <TrashIcon />
                    </Button>
                  </DeleteConfirmPopover>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}

export default App;
