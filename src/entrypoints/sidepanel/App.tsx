import { useEffect, useRef, useState } from 'react';
import { Button, Card, Input, Switch, Tooltip } from '@heroui/react';
import type { PaletteEntry, ProjectRule, ProjectSettings, TintSettings } from '../../types';
import { contrastTextColor } from '../../utils/color';
import { DEFAULT_SETTINGS, DEFAULT_PROJECT_SETTINGS, loadSettings, cloneProjectSettings } from '../../utils/settings';
import PaletteColorPicker from '../../components/PaletteColorPicker';
import ColorSwatchField from '../../components/ColorSwatchField';

const nameInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

// The sidepanel is a single-page app with two views: the project rule list (the default
// landing page) and a detail page for editing one rule's settings.
type View = { type: 'list' } | { type: 'detail'; ruleId: string };

const resolveColor = (
  paletteEnabled: boolean,
  palette: PaletteEntry[],
  paletteId: string | null,
  ownColor: string,
): string => {
  if (paletteEnabled && paletteId) {
    const entry = palette.find((e) => e.id === paletteId);
    if (entry) return entry.color;
  }
  return ownColor;
};

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
  const [newRulePattern, setNewRulePattern] = useState('');
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
    const stamped: TintSettings = { ...next, schemaVersion: browser.runtime.getManifest().version };
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

  const handleAddRule = () => {
    const pattern = newRulePattern.trim();
    if (!pattern) return;
    const rule: ProjectRule = { id: crypto.randomUUID(), pattern, settings: cloneProjectSettings(DEFAULT_PROJECT_SETTINGS) };
    save({ ...settings, projectRules: [...settings.projectRules, rule] });
    setNewRulePattern('');
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

  const handleDuplicateRule = (id: string) => {
    const index = settings.projectRules.findIndex((r) => r.id === id);
    if (index === -1) return;
    const original = settings.projectRules[index];
    const copy: ProjectRule = {
      id: crypto.randomUUID(),
      pattern: original.pattern,
      settings: cloneProjectSettings(original.settings),
    };
    const next = [...settings.projectRules];
    next.splice(index + 1, 0, copy);
    save({ ...settings, projectRules: next });
  };

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

  const handlePaletteEnabledChange = (isSelected: boolean) => {
    updateCurrentSettings({ paletteEnabled: isSelected });
  };

  const handleAddColor = () => {
    const entry: PaletteEntry = {
      id: crypto.randomUUID(),
      name: `Color ${currentSettings.palette.length + 1}`,
      color: DEFAULT_PROJECT_SETTINGS.topBarColor,
    };
    updateCurrentSettings({ palette: [...currentSettings.palette, entry] });
  };

  const handlePaletteNameChange = (id: string, name: string) => {
    updateCurrentSettings({ palette: currentSettings.palette.map((e) => (e.id === id ? { ...e, name } : e)) });
  };

  const handlePaletteColorChange = (id: string, color: string) => {
    updateCurrentSettings({ palette: currentSettings.palette.map((e) => (e.id === id ? { ...e, color } : e)) });
  };

  // Palette entries and their references are scoped to the currently-edited rule only;
  // removing an entry here does not touch any other rule's palette/references.
  const handleRemoveColor = (id: string) => {
    updateCurrentSettings({
      palette: currentSettings.palette.filter((e) => e.id !== id),
      topBarPaletteId: currentSettings.topBarPaletteId === id ? null : currentSettings.topBarPaletteId,
      platformBarPaletteId:
        currentSettings.platformBarPaletteId === id ? null : currentSettings.platformBarPaletteId,
      platformBarTextPaletteId:
        currentSettings.platformBarTextPaletteId === id ? null : currentSettings.platformBarTextPaletteId,
    });
  };

  const handleTopBarEnabledChange = (isSelected: boolean) => {
    updateCurrentSettings({ topBarEnabled: isSelected });
  };

  const handlePlatformBarEnabledChange = (isSelected: boolean) => {
    updateCurrentSettings({ platformBarEnabled: isSelected });
  };

  const handleTopBarHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.valueAsNumber;
    if (!Number.isFinite(value)) return;
    updateCurrentSettings({ topBarHeight: value });
  };

  const handleTopBarStripesChange = (isSelected: boolean) => {
    updateCurrentSettings({ topBarStripes: isSelected });
  };

  const handlePlatformBarStripesChange = (isSelected: boolean) => {
    updateCurrentSettings({ platformBarStripes: isSelected });
  };

  const handlePlatformBarTextEnabledChange = (isSelected: boolean) => {
    updateCurrentSettings({ platformBarTextEnabled: isSelected });
  };

  const handleTopBarPaletteSelect = (id: string) => {
    updateCurrentSettings({ topBarPaletteId: id });
  };

  const handleTopBarCustomColorChange = (color: string) => {
    updateCurrentSettings({ topBarPaletteId: null, topBarColor: color });
  };

  const handlePlatformBarPaletteSelect = (id: string) => {
    updateCurrentSettings({ platformBarPaletteId: id });
  };

  const handlePlatformBarCustomColorChange = (color: string) => {
    updateCurrentSettings({ platformBarPaletteId: null, platformBarColor: color });
  };

  const handlePlatformBarTextPaletteSelect = (id: string) => {
    updateCurrentSettings({ platformBarTextPaletteId: id, platformBarTextAuto: false });
  };

  const handlePlatformBarTextCustomColorChange = (color: string) => {
    updateCurrentSettings({ platformBarTextPaletteId: null, platformBarTextColor: color, platformBarTextAuto: false });
  };

  const handlePlatformBarTextAutoSelect = () => {
    updateCurrentSettings({ platformBarTextAuto: true });
  };

  const currentRule =
    view.type === 'detail' ? settings.projectRules.find((r) => r.id === view.ruleId) : undefined;
  // Falls back to the built-in defaults only for the transient frame before the "rule
  // disappeared" effect above navigates back to the list.
  const currentSettings: ProjectSettings = currentRule ? currentRule.settings : DEFAULT_PROJECT_SETTINGS;

  const topBarEffectiveColor = resolveColor(
    currentSettings.paletteEnabled,
    currentSettings.palette,
    currentSettings.topBarPaletteId,
    currentSettings.topBarColor,
  );
  const platformBarEffectiveColor = resolveColor(
    currentSettings.paletteEnabled,
    currentSettings.palette,
    currentSettings.platformBarPaletteId,
    currentSettings.platformBarColor,
  );
  const platformBarTextEffectiveColor = currentSettings.platformBarTextAuto
    ? contrastTextColor(platformBarEffectiveColor)
    : resolveColor(
        currentSettings.paletteEnabled,
        currentSettings.palette,
        currentSettings.platformBarTextPaletteId,
        currentSettings.platformBarTextColor,
      );

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
                <span className="text-sm">Pattern</span>
                <Input
                  aria-label="Pattern"
                  value={currentRule.pattern}
                  onChange={handlePatternChange}
                  className={nameInputClassName}
                />
              </div>
              {!isValidPattern(currentRule.pattern) && (
                <span className="text-sm text-danger">Invalid regular expression</span>
              )}
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.paletteEnabled}
              onChange={handlePaletteEnabledChange}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Color palette
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.paletteEnabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                {currentSettings.palette.map((entry) => (
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
                    <IconButtonTooltip label="Remove color">
                      <Button
                        isIconOnly
                        variant="outline"
                        size="sm"
                        aria-label="Remove color"
                        className="shrink-0"
                        onPress={() => handleRemoveColor(entry.id)}
                      >
                        <TrashIcon />
                      </Button>
                    </IconButtonTooltip>
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
              isSelected={currentSettings.topBarEnabled}
              onChange={handleTopBarEnabledChange}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Top bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.topBarEnabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Top bar color"
                    paletteEnabled={currentSettings.paletteEnabled}
                    palette={currentSettings.palette}
                    paletteId={currentSettings.topBarPaletteId}
                    customColor={currentSettings.topBarColor}
                    effectiveColor={topBarEffectiveColor}
                    onSelectPaletteEntry={handleTopBarPaletteSelect}
                    onSelectCustomColor={handleTopBarCustomColorChange}
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
                      value={currentSettings.topBarHeight}
                      onChange={handleTopBarHeightChange}
                      className="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                    />
                    <span className="text-sm text-muted">px</span>
                  </div>
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.topBarStripes}
                  onChange={handleTopBarStripesChange}
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
              isSelected={currentSettings.platformBarEnabled}
              onChange={handlePlatformBarEnabledChange}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.platformBarEnabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Platform Bar color"
                    paletteEnabled={currentSettings.paletteEnabled}
                    palette={currentSettings.palette}
                    paletteId={currentSettings.platformBarPaletteId}
                    customColor={currentSettings.platformBarColor}
                    effectiveColor={platformBarEffectiveColor}
                    onSelectPaletteEntry={handlePlatformBarPaletteSelect}
                    onSelectCustomColor={handlePlatformBarCustomColorChange}
                  />
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.platformBarStripes}
                  onChange={handlePlatformBarStripesChange}
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
              isSelected={currentSettings.platformBarTextEnabled}
              onChange={handlePlatformBarTextEnabledChange}
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar text color
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {currentSettings.platformBarTextEnabled && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-h-8 items-center justify-between">
                  <span className="text-sm">Color</span>
                  <PaletteColorPicker
                    ariaLabel="Platform Bar text color"
                    paletteEnabled={currentSettings.paletteEnabled}
                    palette={currentSettings.palette}
                    paletteId={currentSettings.platformBarTextPaletteId}
                    customColor={currentSettings.platformBarTextColor}
                    effectiveColor={platformBarTextEffectiveColor}
                    onSelectPaletteEntry={handlePlatformBarTextPaletteSelect}
                    onSelectCustomColor={handlePlatformBarTextCustomColorChange}
                    supportsAuto
                    autoSelected={currentSettings.platformBarTextAuto}
                    onSelectAuto={handlePlatformBarTextAutoSelect}
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
          <div className="text-sm font-medium">Projects</div>

          <div className="flex items-center gap-2">
            <Input
              aria-label="New rule pattern"
              placeholder="project id or regex"
              value={newRulePattern}
              onChange={(e) => setNewRulePattern(e.target.value)}
              className={nameInputClassName}
            />
            <IconButtonTooltip label="Add rule">
              <Button isIconOnly variant="outline" aria-label="Add rule" className="shrink-0" onPress={handleAddRule}>
                <PlusIcon />
              </Button>
            </IconButtonTooltip>
          </div>

          {settings.projectRules.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              {settings.projectRules.map((rule, index) => (
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
                  <IconButtonTooltip label="Delete">
                    <Button
                      isIconOnly
                      variant="outline"
                      size="sm"
                      aria-label="Delete"
                      className="shrink-0"
                      onPress={() => handleDeleteRule(rule.id)}
                    >
                      <TrashIcon />
                    </Button>
                  </IconButtonTooltip>
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
