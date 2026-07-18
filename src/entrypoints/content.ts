import type { PaletteEntry } from '../types';
import { contrastTextColor, stripeGradient } from '../utils/color';

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

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main() {
    const DEFAULT_COLOR = '#ff6d00';
    const DEFAULT_TEXT_COLOR = '#ffffff';
    const DEFAULT_TOP_BAR_HEIGHT = 4;
    const DEFAULT_SETTINGS: TintSettings = {
      paletteEnabled: true,
      palette: [{ id: 'default', name: 'Primary', color: DEFAULT_COLOR }],
      topBarEnabled: true,
      topBarColor: DEFAULT_COLOR,
      topBarPaletteId: 'default',
      topBarHeight: DEFAULT_TOP_BAR_HEIGHT,
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

    const clampTopBarHeight = (height: number): number => {
      if (!Number.isFinite(height)) return DEFAULT_TOP_BAR_HEIGHT;
      const rounded = Math.round(height);
      if (rounded < 1 || rounded > 40) return DEFAULT_TOP_BAR_HEIGHT;
      return rounded;
    };

    const bar = document.createElement('div');
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '2147483647';
    bar.style.pointerEvents = 'none';
    document.documentElement.appendChild(bar);

    const platformBarStyle = document.createElement('style');
    document.documentElement.appendChild(platformBarStyle);

    const resolveColor = (settings: TintSettings, paletteId: string | null, ownColor: string): string => {
      if (settings.paletteEnabled && paletteId) {
        const entry = settings.palette.find((e) => e.id === paletteId);
        if (entry) return entry.color;
      }
      return ownColor;
    };

    const applySettings = (settings: TintSettings) => {
      if (settings.topBarEnabled) {
        bar.style.display = '';
        bar.style.height = `${clampTopBarHeight(settings.topBarHeight)}px`;
        const topBarColor = resolveColor(settings, settings.topBarPaletteId, settings.topBarColor);
        bar.style.backgroundColor = topBarColor;
        bar.style.backgroundImage = settings.topBarStripes ? stripeGradient(topBarColor) : '';
      } else {
        bar.style.display = 'none';
      }

      const rules: string[] = [];
      if (settings.platformBarEnabled) {
        const platformBarColor = resolveColor(settings, settings.platformBarPaletteId, settings.platformBarColor);
        const declarations = [`background-color: ${platformBarColor} !important;`];
        if (settings.platformBarStripes) {
          declarations.push(`background-image: ${stripeGradient(platformBarColor)} !important;`);
        }
        rules.push(`#ocb-platform-bar { ${declarations.join(' ')} }`);
      }
      if (settings.platformBarTextEnabled) {
        const textColor = settings.platformBarTextAuto
          ? contrastTextColor(resolveColor(settings, settings.platformBarPaletteId, settings.platformBarColor))
          : resolveColor(settings, settings.platformBarTextPaletteId, settings.platformBarTextColor);
        rules.push(
          `.cfc-platform-bar-left *, .cfc-platform-bar-right * { color: ${textColor} !important; }`,
        );
      }
      platformBarStyle.textContent = rules.join('\n');
    };

    applySettings(DEFAULT_SETTINGS);

    browser.storage.local.get(['tintSettings', 'tintColor']).then((result) => {
      if (result.tintSettings) {
        applySettings({ ...DEFAULT_SETTINGS, ...(result.tintSettings as Partial<TintSettings>) });
      } else if (typeof result.tintColor === 'string') {
        applySettings({
          ...DEFAULT_SETTINGS,
          palette: [{ id: 'default', name: 'Primary', color: result.tintColor }],
          topBarColor: result.tintColor,
          platformBarColor: result.tintColor,
        });
      }
    });

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.tintSettings) return;
      const newValue = changes.tintSettings.newValue;
      if (newValue) {
        applySettings({ ...DEFAULT_SETTINGS, ...(newValue as Partial<TintSettings>) });
      }
    });
  },
});
