import { Alert, Button, Card, Input, Switch, Tabs, Tooltip } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';
import type { Color } from '../../../../domain/color';
import { PaletteEntry, type PaletteEntryId } from '../../../../domain/palette';
import { type MatchType, ProjectRule, type ProjectRuleId } from '../../../../domain/project-rule';
import { ProjectSettings } from '../../../../domain/project-settings';
import { TopBarHeight } from '../../../../domain/top-bar-height';
import type { SettingsStore } from '../../../../port/settings-store';
import { useRowReorder } from '../../hooks/useRowReorder';
import { useTheme } from '../../hooks/useTheme';
import { useTintSettings } from '../../hooks/useTintSettings';
import AddRuleModal from './components/AddRuleModal';
import AppearanceCard from './components/AppearanceCard';
import BackupCard, { type Notice, type NoticeInput } from './components/BackupCard';
import ColorSwatchField from './components/ColorSwatchField';
import DeleteConfirmPopover from './components/DeleteConfirmPopover';
import MatchTypeSelect from './components/MatchTypeSelect';
import PaletteColorPicker from './components/PaletteColorPicker';
import { Presence } from './components/Presence';

const nameInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

// The sidepanel is a single-page app with two views: the project rule list (the default
// landing page) and a detail page for editing one rule's settings. `back` is set only by the
// detail page's Back button and makes the list enter from the left, mirroring the detail page,
// which enters from the right (style.css, `[data-view-enter]`). The initial state and the
// fallback for a rule that disappeared leave it out, so the list does not animate there.
type View = { type: 'list'; back?: true } | { type: 'detail'; ruleId: ProjectRuleId };

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
  const { settings, status, save, saveThenApply, loadSaved } = useTintSettings(settingsStore);
  // Applied before the loading/failed early returns, so those screens follow the theme too. Theme
  // changes fade only once the stored settings are in place.
  useTheme(settings.theme, status === 'ready');
  const [view, setView] = useState<View>({ type: 'list' });
  // The Backup card's last outcome lives here rather than in the card, which unmounts whenever the
  // Rules tab is picked. Ids only ever grow (clearing does not reset them), so the card can tell a
  // notice raised since it mounted from one that was already showing.
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeIdRef = useRef(0);
  // Rows are dragged by their grip only; the hook moves them on screen and hands the drop here.
  const reorder = useRowReorder({
    keys: settings.projectRules.map((rule) => rule.id.toString()),
    onMove: (from, to) => save(settings.moveRule(from, to)),
  });

  // Defensive: if the rule currently open in detail view disappears (there is no UI path to
  // this today since Delete only acts from the list, but this keeps the view consistent
  // should that change), fall back to the list instead of rendering a phantom rule's page.
  useEffect(() => {
    if (view.type === 'detail' && !settings.projectRules.some((r) => r.id.equals(view.ruleId))) {
      setView({ type: 'list' });
    }
  }, [view, settings.projectRules]);

  if (status === 'loading') {
    return (
      <div role="status" className="p-3 text-sm text-muted">
        Loading settings…
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Couldn’t load settings</Alert.Title>
          <Alert.Description>Reload the side panel and try again.</Alert.Description>
        </Alert.Content>
      </Alert>
    );
  }

  // Applies `update` to the currently-edited rule's settings and saves — every surface handler
  // below funnels through here, so composite updates that must land in a single save (e.g.
  // "pick a palette entry AND clear auto") are just a longer chain in one call.
  const updateCurrent = (update: (ps: ProjectSettings) => ProjectSettings) => {
    if (view.type !== 'detail') return;
    save(settings.updateRule(view.ruleId, (rule) => rule.changeSettings(update(rule.settings))));
  };

  const updateCurrentRule = (update: (rule: ProjectRule) => ProjectRule) => {
    if (view.type !== 'detail') return;
    save(settings.updateRule(view.ruleId, update));
  };

  const handleAddRule = (matchType: MatchType, pattern: string) => {
    save(settings.addRule(ProjectRule.create(matchType, pattern)));
  };

  // Applies the rules picked in the import modal and reports the persisted merge outcome.
  const handleImportRules = async (selected: readonly ProjectRule[]) => {
    const replaced = settings.replacementTargets(selected).filter((target) => target !== undefined).length;
    await saveThenApply(settings.mergeRules(selected));
    return { added: selected.length - replaced, replaced };
  };

  const showNotice = (input: NoticeInput) => {
    noticeIdRef.current += 1;
    setNotice({ ...input, id: noticeIdRef.current });
  };

  const handlePatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pattern = e.target.value;
    updateCurrentRule((rule) => rule.changePattern(pattern));
  };

  const handleMatchTypeChange = (matchType: MatchType) => {
    updateCurrentRule((rule) => rule.changeMatchType(matchType));
  };

  const handleDuplicateRule = (id: ProjectRuleId) => {
    save(settings.duplicateRule(id));
  };

  // Delete is confirm-gated via DeleteConfirmPopover (anchored to the row's Delete button);
  // this handler is only ever invoked from that popover's confirm action.
  const handleDeleteRule = (id: ProjectRuleId) => {
    save(settings.removeRule(id));
  };

  const handleAddColor = () => {
    updateCurrent((ps) =>
      ps.changePalette(
        ps.palette.addEntry(
          PaletteEntry.create(`Color ${ps.palette.entries.length + 1}`, ProjectSettings.DEFAULT.topBar.color.custom),
        ),
      ),
    );
  };

  const handlePaletteNameChange = (id: PaletteEntryId, name: string) => {
    updateCurrent((ps) => ps.changePalette(ps.palette.renameEntry(id, name)));
  };

  // The colour editors validate at their boundary (Color.fromHex) and only ever hand over a Color.
  const handlePaletteColorChange = (id: PaletteEntryId, color: Color) => {
    updateCurrent((ps) => ps.changePalette(ps.palette.changeEntryColor(id, color)));
  };

  // Palette entries and their references are scoped to the currently-edited rule only;
  // removing an entry here does not touch any other rule's palette/references. Clearing the
  // surfaces' now-dangling references happens inside withPaletteEntryRemoved, in the same save,
  // so storage never passes through an intermediate state with a dangling paletteId.
  const handleRemoveColor = (id: PaletteEntryId) => {
    updateCurrent((ps) => ps.removePaletteEntry(id));
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
      // The two view roots carry different keys, so every navigation mounts a new element and the
      // enter animation of `[data-view-enter]` plays. Without them React would reuse one div for
      // both views, and an animation that is already applied does not replay when only the
      // attribute's value changes.
      <div key="detail" data-view-enter="forward" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <IconButtonTooltip label="Back">
            <Button
              isIconOnly
              variant="outline"
              size="sm"
              aria-label="Back"
              className="shrink-0"
              onPress={() => setView({ type: 'list', back: true })}
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
              {/* `gap` is this card's gap-1. The span is `block` so that its own line height sets
                  the height of the line: inline, it would sit in a line box of Presence's wrapper,
                  which inherits the page's larger line height. */}
              <Presence gap="0.25rem">
                {currentRule.matchType === 'regex' && !isValidPattern(currentRule.pattern) && (
                  <span key="invalid" className="block text-sm text-danger">
                    Invalid regular expression
                  </span>
                )}
              </Presence>
            </Card.Content>
          </Card>
        )}

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.palette.enabled}
              onChange={(isSelected) =>
                updateCurrent((ps) => ps.changePalette(isSelected ? ps.palette.enable() : ps.palette.disable()))
              }
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Color palette
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            {/* Presence opens and closes a section with its switch (style.css, `.reveal`), here and
                in the three surface cards below. The palette rows have a Presence of their own, so
                a single colour is added or removed the same way; the Add button stays outside it
                and is pushed along. */}
            <Presence>
              {currentSettings.palette.enabled && (
                <div key="section" className="flex flex-col gap-2 border-t border-border pt-2">
                  <Presence>
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
                          onChange={(color) => handlePaletteColorChange(entry.id, color)}
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
                  </Presence>
                  <IconButtonTooltip label="Add color">
                    <Button isIconOnly variant="outline" aria-label="Add color" onPress={handleAddColor}>
                      <PlusIcon />
                    </Button>
                  </IconButtonTooltip>
                </div>
              )}
            </Presence>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.topBar.enabled}
              onChange={(isSelected) =>
                updateCurrent((ps) => ps.changeTopBar(isSelected ? ps.topBar.enable() : ps.topBar.disable()))
              }
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Top bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <Presence>
              {currentSettings.topBar.enabled && (
                <div key="section" className="flex flex-col gap-2 border-t border-border pt-2">
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
                        updateCurrent((ps) => ps.changeTopBar(ps.topBar.changeColor(ps.topBar.color.setPalette(id))))
                      }
                      onSelectCustomColor={(color) =>
                        updateCurrent((ps) =>
                          ps.changeTopBar(ps.topBar.changeColor(ps.topBar.color.setCustomColor(color))),
                        )
                      }
                    />
                  </div>
                  <div className="flex min-h-8 items-center justify-between">
                    <span className="text-sm">Height</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        aria-label="Top bar height"
                        min={TopBarHeight.MIN.toPixels()}
                        max={TopBarHeight.MAX.toPixels()}
                        value={currentSettings.topBar.height.toPixels()}
                        onChange={(e) => {
                          // Anything the domain refuses is ignored rather than corrected: an empty
                          // input (valueAsNumber is NaN) or a value outside the range simply leaves
                          // the last valid height in place.
                          const height = TopBarHeight.fromPixels(e.target.valueAsNumber);
                          if (height) updateCurrent((ps) => ps.changeTopBar(ps.topBar.changeHeight(height)));
                        }}
                        className="outlined-control h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                      />
                      <span className="text-sm text-muted">px</span>
                    </div>
                  </div>
                  <Switch
                    className="min-h-8 w-full"
                    isSelected={currentSettings.topBar.stripes}
                    onChange={(isSelected) =>
                      updateCurrent((ps) =>
                        ps.changeTopBar(isSelected ? ps.topBar.enableStripes() : ps.topBar.disableStripes()),
                      )
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
            </Presence>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.platformBar.enabled}
              onChange={(isSelected) =>
                updateCurrent((ps) =>
                  ps.changePlatformBar(isSelected ? ps.platformBar.enable() : ps.platformBar.disable()),
                )
              }
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <Presence>
              {currentSettings.platformBar.enabled && (
                <div key="section" className="flex flex-col gap-2 border-t border-border pt-2">
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
                          ps.changePlatformBar(ps.platformBar.changeColor(ps.platformBar.color.setPalette(id))),
                        )
                      }
                      onSelectCustomColor={(color) =>
                        updateCurrent((ps) =>
                          ps.changePlatformBar(ps.platformBar.changeColor(ps.platformBar.color.setCustomColor(color))),
                        )
                      }
                    />
                  </div>
                  <Switch
                    className="min-h-8 w-full"
                    isSelected={currentSettings.platformBar.stripes}
                    onChange={(isSelected) =>
                      updateCurrent((ps) =>
                        ps.changePlatformBar(
                          isSelected ? ps.platformBar.enableStripes() : ps.platformBar.disableStripes(),
                        ),
                      )
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
            </Presence>
          </Card.Content>
        </Card>

        <Card>
          <Card.Content className="flex flex-col gap-2">
            <Switch
              className="w-full"
              isSelected={currentSettings.platformBarText.enabled}
              onChange={(isSelected) =>
                updateCurrent((ps) =>
                  ps.changePlatformBarText(isSelected ? ps.platformBarText.enable() : ps.platformBarText.disable()),
                )
              }
            >
              <Switch.Content className="flex w-full items-center justify-between">
                Platform Bar text color
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch.Content>
            </Switch>
            <Presence>
              {currentSettings.platformBarText.enabled && (
                <div key="section" className="flex flex-col gap-2 border-t border-border pt-2">
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
                          ps.changePlatformBarText(
                            ps.platformBarText.changeColor(ps.platformBarText.color.setPalette(id)).disableAuto(),
                          ),
                        )
                      }
                      onSelectCustomColor={(color) =>
                        updateCurrent((ps) =>
                          ps.changePlatformBarText(
                            ps.platformBarText
                              .changeColor(ps.platformBarText.color.setCustomColor(color))
                              .disableAuto(),
                          ),
                        )
                      }
                      supportsAuto
                      autoSelected={currentSettings.platformBarText.auto}
                      autoColor={platformBarEffectiveColor.contrastingTextColor().toHex()}
                      onSelectAuto={() =>
                        updateCurrent((ps) => ps.changePlatformBarText(ps.platformBarText.enableAuto()))
                      }
                    />
                  </div>
                </div>
              )}
            </Presence>
          </Card.Content>
        </Card>
      </div>
    );
  }

  return (
    // Keyed for the same reason as the detail root. The attribute is there only after Back.
    <div key="list" data-view-enter={view.back ? 'back' : undefined} className="flex flex-col gap-3">
      <h1 className="text-base font-semibold">GCP Console Tint</h1>

      {/* Uncontrolled: returning from the detail view remounts the list and lands on Rules again,
          which is where a user coming back from editing a rule wants to be anyway.
          The pill track behind the tabs is `.tabs__list-container`, which HeroUI only renders
          when Tabs.List is wrapped in Tabs.ListContainer; the selected pill is the
          Tabs.Indicator inside each tab. The className overrides re-space the component to this
          page's 12px column gap: HeroUI ships gap-2 on the root and `p-2 mt-4` on each panel, and
          Tailwind utilities win over its @layer components rules property by property. */}
      <Tabs defaultSelectedKey="rules" className="gap-3">
        <Tabs.ListContainer>
          <Tabs.List aria-label="Side panel sections">
            <Tabs.Tab id="rules">
              <Tabs.Indicator />
              Rules
            </Tabs.Tab>
            <Tabs.Tab id="settings">
              <Tabs.Indicator />
              Settings
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>

        {/* A positioned box for the panels. While a panel leaves, HeroUI makes it
            `position: absolute; top: 0`, and no ancestor up to here is positioned: without this
            box it would jump to the top of the page, over the title and the tab list.
            `tab-panel-start` / `tab-panel-end` name the side each panel slides to and from
            (style.css): the first tab's panel to the left, the last one's to the right. */}
        <div className="tab-panels">
          <Tabs.Panel id="rules" className="tab-panel-start mt-0 p-0">
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

                {/* Two levels of Presence: the outer one brings the divider and the list in with
                    the first rule and takes them out with the last, the inner one opens and closes
                    single rows. */}
                <Presence>
                  {settings.projectRules.length > 0 && (
                    <div key="rules" ref={reorder.listRef} className="flex flex-col gap-2 border-t border-border pt-2">
                      <Presence>
                        {settings.projectRules.map((rule, index) => (
                          <div
                            key={rule.id.toString()}
                            ref={reorder.rowRef(rule.id.toString())}
                            data-rule-row
                            className="flex min-h-8 items-center gap-2"
                          >
                            {/* Pointer only: a keyboard and screen reader way to reorder is not built
                                yet. The hit area is 24x36 while the layout keeps the icon's 16px:
                                the padding is taken back by an equal negative margin. */}
                            <span
                              aria-hidden="true"
                              className="-mx-1 -my-2.5 flex shrink-0 cursor-grab touch-none px-1 py-2.5 text-muted hover:text-foreground"
                              {...reorder.gripProps(index)}
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
                      </Presence>
                    </div>
                  )}
                </Presence>
              </Card.Content>
            </Card>
          </Tabs.Panel>

          {/* BackupCard returns a fragment (card + an optional result Alert), so both land directly
              in this panel and pick up the page column's spacing. */}
          <Tabs.Panel id="settings" className="tab-panel-end mt-0 flex flex-col gap-3 p-0">
            <AppearanceCard theme={settings.theme} onChange={(theme) => save(settings.changeTheme(theme))} />
            <BackupCard
              settingsStore={settingsStore}
              settings={settings}
              loadSaved={loadSaved}
              onImport={handleImportRules}
              notice={notice}
              onNotice={showNotice}
              onClearNotice={() => setNotice(null)}
            />
          </Tabs.Panel>
        </div>
      </Tabs>
    </div>
  );
}

export default App;
