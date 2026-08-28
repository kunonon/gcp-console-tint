import { Button, Card, Input, Switch, Tooltip } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import { Color } from '../../../../domain/color';
import { PaletteEntry, type PaletteEntryId } from '../../../../domain/palette';
import { type MatchType, ProjectRule, type ProjectRuleId } from '../../../../domain/project-rule';
import { ProjectSettings } from '../../../../domain/project-settings';
import type { SettingsStore } from '../../../../port/settings-store';
import { useTintSettings } from '../../hooks/useTintSettings';
import AddRuleModal from './components/AddRuleModal';
import ColorSwatchField from './components/ColorSwatchField';
import DeleteConfirmPopover from './components/DeleteConfirmPopover';
import MatchTypeSelect from './components/MatchTypeSelect';
import PaletteColorPicker from './components/PaletteColorPicker';

const nameInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

// The sidepanel is a single-page app with two views: the project rule list (the default
// landing page) and a detail page for editing one rule's settings.
type View = { type: 'list' } | { type: 'detail'; ruleId: ProjectRuleId };

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

function App({ settingsStore }: { settingsStore: SettingsStore }) {
  const { settings, save } = useTintSettings(settingsStore);
  const [view, setView] = useState<View>({ type: 'list' });
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  // Native HTML5 drag-and-drop only lets an element itself be `draggable`; to restrict drag
  // initiation to the grip handle (rather than the whole row, e.g. its icon buttons or text)
  // we track whether the most recent mousedown landed on the grip, and cancel dragstart
  // otherwise.
  const dragHandleActiveRef = useRef(false);

  // Defensive: if the rule currently open in detail view disappears (there is no UI path to
  // this today since Delete only acts from the list, but this keeps the view consistent
  // should that change), fall back to the list instead of rendering a phantom rule's page.
  useEffect(() => {
    if (view.type === 'detail' && !settings.projectRules.some((r) => r.id.equals(view.ruleId))) {
      setView({ type: 'list' });
    }
  }, [view, settings.projectRules]);

  // Applies `update` to the currently-edited rule's settings and saves — every surface handler
  // below funnels through here, so composite updates that must land in a single save (e.g.
  // "pick a palette entry AND clear auto") are just a longer chain in one call.
  const updateCurrent = (update: (ps: ProjectSettings) => ProjectSettings) => {
    if (view.type !== 'detail') return;
    save(settings.withRuleUpdated(view.ruleId, (rule) => rule.withSettings(update(rule.settings))));
  };

  const updateCurrentRule = (update: (rule: ProjectRule) => ProjectRule) => {
    if (view.type !== 'detail') return;
    save(settings.withRuleUpdated(view.ruleId, update));
  };

  const handleAddRule = (matchType: MatchType, pattern: string) => {
    save(settings.withRuleAdded(ProjectRule.create(matchType, pattern)));
  };

  const handlePatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pattern = e.target.value;
    updateCurrentRule((rule) => rule.withPattern(pattern));
  };

  const handleMatchTypeChange = (matchType: MatchType) => {
    updateCurrentRule((rule) => rule.withMatchType(matchType));
  };

  const handleDuplicateRule = (id: ProjectRuleId) => {
    save(settings.withRuleDuplicated(id));
  };

  // Delete is confirm-gated via DeleteConfirmPopover (anchored to the row's Delete button);
  // this handler is only ever invoked from that popover's confirm action.
  const handleDeleteRule = (id: ProjectRuleId) => {
    save(settings.withRuleRemoved(id));
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
    save(settings.withRuleMoved(draggingIndex, index));
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
    updateCurrent((ps) =>
      ps.withPalette(
        ps.palette.addEntry(
          PaletteEntry.create(`Color ${ps.palette.entries.length + 1}`, ProjectSettings.DEFAULT.topBar.color.custom),
        ),
      ),
    );
  };

  const handlePaletteNameChange = (id: PaletteEntryId, name: string) => {
    updateCurrent((ps) => ps.withPalette(ps.palette.renameEntry(id, name)));
  };

  const handlePaletteColorChange = (id: PaletteEntryId, color: string) => {
    // input[type=color] can only ever emit '#rrggbb', so fromHex never returns undefined here.
    const parsed = Color.fromHex(color);
    if (parsed) updateCurrent((ps) => ps.withPalette(ps.palette.recolorEntry(id, parsed)));
  };

  // Palette entries and their references are scoped to the currently-edited rule only;
  // removing an entry here does not touch any other rule's palette/references. Clearing the
  // surfaces' now-dangling references happens inside withPaletteEntryRemoved, in the same save,
  // so storage never passes through an intermediate state with a dangling paletteId.
  const handleRemoveColor = (id: PaletteEntryId) => {
    updateCurrent((ps) => ps.withPaletteEntryRemoved(id));
  };

  const currentRule = view.type === 'detail' ? settings.projectRules.find((r) => r.id.equals(view.ruleId)) : undefined;
  // Falls back to the built-in defaults only for the transient frame before the "rule
  // disappeared" effect above navigates back to the list.
  const currentSettings: ProjectSettings = currentRule ? currentRule.settings : ProjectSettings.DEFAULT;

  const topBarEffectiveColor = currentSettings.palette.resolve(currentSettings.topBar.color);
  const platformBarEffectiveColor = currentSettings.palette.resolve(currentSettings.platformBar.color);
  const platformBarTextEffectiveColor = currentSettings.platformBarText.auto
    ? platformBarEffectiveColor.contrastingTextColor()
    : currentSettings.palette.resolve(currentSettings.platformBarText.color);

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
              onChange={(isSelected) => updateCurrent((ps) => ps.withPalette(ps.palette.withEnabled(isSelected)))}
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
                  <div key={entry.id.toString()} className="@container flex items-center justify-between gap-2">
                    <Input
                      aria-label="Color name"
                      placeholder="Name"
                      value={entry.name}
                      onChange={(e) => handlePaletteNameChange(entry.id, e.target.value)}
                      className={nameInputClassName}
                    />
                    <ColorSwatchField
                      ariaLabel={`${entry.name || '(unnamed)'} color`}
                      value={entry.color.toHex()}
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
              onChange={(isSelected) => updateCurrent((ps) => ps.withTopBar(ps.topBar.withEnabled(isSelected)))}
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
                    customColor={currentSettings.topBar.color.custom.toHex()}
                    effectiveColor={topBarEffectiveColor.toHex()}
                    onSelectPaletteEntry={(id) =>
                      updateCurrent((ps) => ps.withTopBar(ps.topBar.withColor(ps.topBar.color.setPalette(id))))
                    }
                    onSelectCustomColor={(color) =>
                      updateCurrent((ps) => ps.withTopBar(ps.topBar.withColor(ps.topBar.color.setCustomColor(color))))
                    }
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
                        if (Number.isFinite(value)) updateCurrent((ps) => ps.withTopBar(ps.topBar.withHeight(value)));
                      }}
                      className="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                    />
                    <span className="text-sm text-muted">px</span>
                  </div>
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.topBar.stripes}
                  onChange={(isSelected) => updateCurrent((ps) => ps.withTopBar(ps.topBar.withStripes(isSelected)))}
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
              onChange={(isSelected) =>
                updateCurrent((ps) => ps.withPlatformBar(ps.platformBar.withEnabled(isSelected)))
              }
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
                    customColor={currentSettings.platformBar.color.custom.toHex()}
                    effectiveColor={platformBarEffectiveColor.toHex()}
                    onSelectPaletteEntry={(id) =>
                      updateCurrent((ps) =>
                        ps.withPlatformBar(ps.platformBar.withColor(ps.platformBar.color.setPalette(id))),
                      )
                    }
                    onSelectCustomColor={(color) =>
                      updateCurrent((ps) =>
                        ps.withPlatformBar(ps.platformBar.withColor(ps.platformBar.color.setCustomColor(color))),
                      )
                    }
                  />
                </div>
                <Switch
                  className="min-h-8 w-full"
                  isSelected={currentSettings.platformBar.stripes}
                  onChange={(isSelected) =>
                    updateCurrent((ps) => ps.withPlatformBar(ps.platformBar.withStripes(isSelected)))
                  }
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
              onChange={(isSelected) =>
                updateCurrent((ps) => ps.withPlatformBarText(ps.platformBarText.withEnabled(isSelected)))
              }
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
                    customColor={currentSettings.platformBarText.color.custom.toHex()}
                    effectiveColor={platformBarTextEffectiveColor.toHex()}
                    // Picking any explicit color also leaves Auto, in the same save: the two
                    // are mutually exclusive states of this surface.
                    onSelectPaletteEntry={(id) =>
                      updateCurrent((ps) =>
                        ps.withPlatformBarText(
                          ps.platformBarText.withColor(ps.platformBarText.color.setPalette(id)).withAuto(false),
                        ),
                      )
                    }
                    onSelectCustomColor={(color) =>
                      updateCurrent((ps) =>
                        ps.withPlatformBarText(
                          ps.platformBarText.withColor(ps.platformBarText.color.setCustomColor(color)).withAuto(false),
                        ),
                      )
                    }
                    supportsAuto
                    autoSelected={currentSettings.platformBarText.auto}
                    onSelectAuto={() =>
                      updateCurrent((ps) => ps.withPlatformBarText(ps.platformBarText.withAuto(true)))
                    }
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
                  key={rule.id.toString()}
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
