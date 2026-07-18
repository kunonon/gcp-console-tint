import { useEffect, useState } from 'react';
import { Button, Card, Input, Switch } from '@heroui/react';
import type { PaletteEntry } from '../../types';
import { contrastTextColor } from '../../utils/color';
import PaletteColorPicker from '../../components/PaletteColorPicker';
import ColorSwatchField from '../../components/ColorSwatchField';

interface TintSettings {
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

const DEFAULT_COLOR = '#ff6d00';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_SETTINGS: TintSettings = {
  paletteEnabled: true,
  palette: [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }],
  topBarEnabled: true,
  topBarColor: DEFAULT_COLOR,
  topBarPaletteId: 'default',
  topBarHeight: 4,
  topBarStripes: false,
  platformBarEnabled: true,
  platformBarColor: DEFAULT_COLOR,
  platformBarPaletteId: 'default',
  platformBarStripes: false,
  platformBarTextEnabled: true,
  platformBarTextColor: DEFAULT_TEXT_COLOR,
  platformBarTextPaletteId: null,
  platformBarTextAuto: false,
};

const nameInputClassName = 'h-8 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

const resolveColor = (settings: TintSettings, paletteId: string | null, ownColor: string): string => {
  if (settings.paletteEnabled && paletteId) {
    const entry = settings.palette.find((e) => e.id === paletteId);
    if (entry) return entry.color;
  }
  return ownColor;
};

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

function App() {
  const [settings, setSettings] = useState<TintSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    browser.storage.local.get(['tintSettings', 'tintColor']).then((result) => {
      if (result.tintSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...(result.tintSettings as Partial<TintSettings>) });
      } else if (typeof result.tintColor === 'string') {
        setSettings({
          ...DEFAULT_SETTINGS,
          palette: [{ id: 'default', name: 'Primary', color: result.tintColor }],
          topBarColor: result.tintColor,
          platformBarColor: result.tintColor,
        });
      }
    });
  }, []);

  const save = (next: TintSettings) => {
    setSettings(next);
    browser.storage.local.set({ tintSettings: next });
  };

  const handlePaletteEnabledChange = (isSelected: boolean) => {
    save({ ...settings, paletteEnabled: isSelected });
  };

  const handleAddColor = () => {
    const entry: PaletteEntry = {
      id: crypto.randomUUID(),
      name: `Color ${settings.palette.length + 1}`,
      color: DEFAULT_COLOR,
    };
    save({ ...settings, palette: [...settings.palette, entry] });
  };

  const handlePaletteNameChange = (id: string, name: string) => {
    save({ ...settings, palette: settings.palette.map((e) => (e.id === id ? { ...e, name } : e)) });
  };

  const handlePaletteColorChange = (id: string, color: string) => {
    save({ ...settings, palette: settings.palette.map((e) => (e.id === id ? { ...e, color } : e)) });
  };

  const handleRemoveColor = (id: string) => {
    save({
      ...settings,
      palette: settings.palette.filter((e) => e.id !== id),
      topBarPaletteId: settings.topBarPaletteId === id ? null : settings.topBarPaletteId,
      platformBarPaletteId: settings.platformBarPaletteId === id ? null : settings.platformBarPaletteId,
      platformBarTextPaletteId:
        settings.platformBarTextPaletteId === id ? null : settings.platformBarTextPaletteId,
    });
  };

  const handleTopBarEnabledChange = (isSelected: boolean) => {
    save({ ...settings, topBarEnabled: isSelected });
  };

  const handlePlatformBarEnabledChange = (isSelected: boolean) => {
    save({ ...settings, platformBarEnabled: isSelected });
  };

  const handleTopBarHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.valueAsNumber;
    if (!Number.isFinite(value)) return;
    save({ ...settings, topBarHeight: value });
  };

  const handleTopBarStripesChange = (isSelected: boolean) => {
    save({ ...settings, topBarStripes: isSelected });
  };

  const handlePlatformBarStripesChange = (isSelected: boolean) => {
    save({ ...settings, platformBarStripes: isSelected });
  };

  const handlePlatformBarTextEnabledChange = (isSelected: boolean) => {
    save({ ...settings, platformBarTextEnabled: isSelected });
  };

  const handleTopBarPaletteSelect = (id: string) => {
    save({ ...settings, topBarPaletteId: id });
  };

  const handleTopBarCustomColorChange = (color: string) => {
    save({ ...settings, topBarPaletteId: null, topBarColor: color });
  };

  const handlePlatformBarPaletteSelect = (id: string) => {
    save({ ...settings, platformBarPaletteId: id });
  };

  const handlePlatformBarCustomColorChange = (color: string) => {
    save({ ...settings, platformBarPaletteId: null, platformBarColor: color });
  };

  const handlePlatformBarTextPaletteSelect = (id: string) => {
    save({ ...settings, platformBarTextPaletteId: id, platformBarTextAuto: false });
  };

  const handlePlatformBarTextCustomColorChange = (color: string) => {
    save({ ...settings, platformBarTextPaletteId: null, platformBarTextColor: color, platformBarTextAuto: false });
  };

  const handlePlatformBarTextAutoSelect = () => {
    save({ ...settings, platformBarTextAuto: true });
  };

  const topBarEffectiveColor = resolveColor(settings, settings.topBarPaletteId, settings.topBarColor);
  const platformBarEffectiveColor = resolveColor(settings, settings.platformBarPaletteId, settings.platformBarColor);
  const platformBarTextEffectiveColor = settings.platformBarTextAuto
    ? contrastTextColor(platformBarEffectiveColor)
    : resolveColor(settings, settings.platformBarTextPaletteId, settings.platformBarTextColor);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-base font-semibold">GCP Console Tint</h1>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch className="w-full" isSelected={settings.paletteEnabled} onChange={handlePaletteEnabledChange}>
            <Switch.Content className="flex w-full items-center justify-between">
              Color palette
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {settings.paletteEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              {settings.palette.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2">
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
                  />
                  <Button
                    isIconOnly
                    variant="outline"
                    size="sm"
                    aria-label="Remove color"
                    onPress={() => handleRemoveColor(entry.id)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              ))}
              <Button isIconOnly variant="outline" aria-label="Add color" onPress={handleAddColor}>
                <PlusIcon />
              </Button>
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Content className="flex flex-col gap-2">
          <Switch className="w-full" isSelected={settings.topBarEnabled} onChange={handleTopBarEnabledChange}>
            <Switch.Content className="flex w-full items-center justify-between">
              Top bar
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {settings.topBarEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span>Color</span>
                <PaletteColorPicker
                  ariaLabel="Top bar color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={settings.topBarPaletteId}
                  customColor={settings.topBarColor}
                  effectiveColor={topBarEffectiveColor}
                  onSelectPaletteEntry={handleTopBarPaletteSelect}
                  onSelectCustomColor={handleTopBarCustomColorChange}
                />
              </div>
              <div className="flex min-h-8 items-center justify-between">
                <span>Height</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    aria-label="Top bar height"
                    min={1}
                    max={40}
                    value={settings.topBarHeight}
                    onChange={handleTopBarHeightChange}
                    className="h-8 w-16 rounded-md border border-border bg-transparent px-2 text-sm"
                  />
                  <span className="text-sm text-muted">px</span>
                </div>
              </div>
              <Switch
                className="w-full"
                isSelected={settings.topBarStripes}
                onChange={handleTopBarStripesChange}
              >
                <Switch.Content className="flex w-full items-center justify-between">
                  Stripes
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
            isSelected={settings.platformBarEnabled}
            onChange={handlePlatformBarEnabledChange}
          >
            <Switch.Content className="flex w-full items-center justify-between">
              Platform Bar
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {settings.platformBarEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span>Color</span>
                <PaletteColorPicker
                  ariaLabel="Platform Bar color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={settings.platformBarPaletteId}
                  customColor={settings.platformBarColor}
                  effectiveColor={platformBarEffectiveColor}
                  onSelectPaletteEntry={handlePlatformBarPaletteSelect}
                  onSelectCustomColor={handlePlatformBarCustomColorChange}
                />
              </div>
              <Switch
                className="w-full"
                isSelected={settings.platformBarStripes}
                onChange={handlePlatformBarStripesChange}
              >
                <Switch.Content className="flex w-full items-center justify-between">
                  Stripes
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
            isSelected={settings.platformBarTextEnabled}
            onChange={handlePlatformBarTextEnabledChange}
          >
            <Switch.Content className="flex w-full items-center justify-between">
              Platform Bar text color
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
          {settings.platformBarTextEnabled && (
            <div className="flex flex-col gap-2 border-t border-border pt-2">
              <div className="flex min-h-8 items-center justify-between">
                <span>Color</span>
                <PaletteColorPicker
                  ariaLabel="Platform Bar text color"
                  paletteEnabled={settings.paletteEnabled}
                  palette={settings.palette}
                  paletteId={settings.platformBarTextPaletteId}
                  customColor={settings.platformBarTextColor}
                  effectiveColor={platformBarTextEffectiveColor}
                  onSelectPaletteEntry={handlePlatformBarTextPaletteSelect}
                  onSelectCustomColor={handlePlatformBarTextCustomColorChange}
                  supportsAuto
                  autoSelected={settings.platformBarTextAuto}
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

export default App;
