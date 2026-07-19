import type { PaletteEntry, ProjectSettings, TintSettings } from '../types';
import { contrastTextColor, stripeGradient } from '../utils/color';
import { DEFAULT_PROJECT_SETTINGS, DEFAULT_SETTINGS, loadSettings, resolveProjectSettings } from '../utils/settings';

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main(ctx) {
    const clampTopBarHeight = (height: number): number => {
      if (!Number.isFinite(height)) return DEFAULT_PROJECT_SETTINGS.topBarHeight;
      const rounded = Math.round(height);
      if (rounded < 1 || rounded > 40) return DEFAULT_PROJECT_SETTINGS.topBarHeight;
      return rounded;
    };

    // Crossfade colors when the settings for the current page change (e.g. switching GCP
    // projects). Honors the user's reduced-motion preference. Optional-chained because
    // jsdom has no matchMedia.
    const animate = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

    const bar = document.createElement('div');
    bar.style.position = 'fixed';
    bar.style.top = '0';
    bar.style.left = '0';
    bar.style.right = '0';
    bar.style.zIndex = '2147483647';
    bar.style.pointerEvents = 'none';
    if (animate) bar.style.transition = 'background-color 300ms ease, height 200ms ease';
    document.documentElement.appendChild(bar);

    const platformBarStyle = document.createElement('style');
    document.documentElement.appendChild(platformBarStyle);

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

    const applyProjectSettings = (project: ProjectSettings) => {
      const { paletteEnabled, palette } = project;
      if (project.topBarEnabled) {
        bar.style.display = '';
        bar.style.height = `${clampTopBarHeight(project.topBarHeight)}px`;
        const topBarColor = resolveColor(paletteEnabled, palette, project.topBarPaletteId, project.topBarColor);
        bar.style.backgroundColor = topBarColor;
        bar.style.backgroundImage = project.topBarStripes ? stripeGradient(topBarColor) : '';
      } else {
        bar.style.display = 'none';
      }

      const rules: string[] = [];
      if (project.platformBarEnabled) {
        const platformBarColor = resolveColor(
          paletteEnabled,
          palette,
          project.platformBarPaletteId,
          project.platformBarColor,
        );
        const declarations = [`background-color: ${platformBarColor} !important;`];
        if (project.platformBarStripes) {
          declarations.push(`background-image: ${stripeGradient(platformBarColor)} !important;`);
        }
        if (animate) {
          declarations.push('transition: background-color 300ms ease !important;');
        }
        rules.push(`#ocb-platform-bar { ${declarations.join(' ')} }`);
      }
      if (project.platformBarTextEnabled) {
        const textColor = project.platformBarTextAuto
          ? contrastTextColor(
              resolveColor(paletteEnabled, palette, project.platformBarPaletteId, project.platformBarColor),
            )
          : resolveColor(paletteEnabled, palette, project.platformBarTextPaletteId, project.platformBarTextColor);
        const textDeclarations = [`color: ${textColor} !important;`];
        if (animate) {
          textDeclarations.push('transition: color 300ms ease !important;');
        }
        rules.push(
          `.cfc-platform-bar-left *, .cfc-platform-bar-right *, .pcc-platform-bar-button * { ${textDeclarations.join(' ')} }`,
        );
      }
      platformBarStyle.textContent = rules.join('\n');
    };

    let lastSettings: TintSettings = DEFAULT_SETTINGS;

    const applySettings = (settings: TintSettings, url: URL = new URL(location.href)) => {
      lastSettings = settings;
      const projectId = url.searchParams.get('project');
      const project = resolveProjectSettings(settings, projectId);
      if (project === null) {
        bar.style.display = 'none';
        platformBarStyle.textContent = '';
        return;
      }
      applyProjectSettings(project);
    };

    applySettings(DEFAULT_SETTINGS);

    const currentVersion = browser.runtime.getManifest().version;

    browser.storage.local.get('tintSettings').then((result) => {
      applySettings(loadSettings(result.tintSettings, currentVersion));
    });

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes.tintSettings) return;
      const newValue = changes.tintSettings.newValue;
      if (newValue) {
        applySettings(loadSettings(newValue, currentVersion));
      }
    });

    // GCP Console is an SPA: the `?project=` query param can change without a full page
    // reload. Re-resolve and re-apply against the last known settings whenever that happens.
    // Resolve against the event's newUrl, NOT window.location: WXT dispatches this from the
    // Navigation API's `navigate` event, which fires before the navigation commits, so
    // window.location still points at the old URL at that moment.
    ctx.addEventListener(window, 'wxt:locationchange', (event) => {
      applySettings(lastSettings, event.newUrl);
    });
  },
});
