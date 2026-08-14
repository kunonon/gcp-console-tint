import { CURRENT_SCHEMA_VERSION } from '../../../domain/migrations';
import { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsStoreImpl } from '../../out/browser-settings-store';
import { stripeGradient } from '../stripes';

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main(ctx) {
    const clampTopBarHeight = (height: number): number => {
      if (!Number.isFinite(height)) return ProjectSettings.DEFAULT.topBar.height;
      const rounded = Math.round(height);
      if (rounded < 1 || rounded > 40) return ProjectSettings.DEFAULT.topBar.height;
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

    const applyProjectSettings = (project: ProjectSettings) => {
      const { palette } = project;
      if (project.topBar.enabled) {
        bar.style.display = '';
        bar.style.height = `${clampTopBarHeight(project.topBar.height)}px`;
        const topBarColor = palette.resolve(project.topBar.color);
        bar.style.backgroundColor = topBarColor.toHex();
        bar.style.backgroundImage = project.topBar.stripes ? stripeGradient(topBarColor) : '';
      } else {
        bar.style.display = 'none';
      }

      const rules: string[] = [];
      if (project.platformBar.enabled) {
        const platformBarColor = palette.resolve(project.platformBar.color);
        const declarations = [`background-color: ${platformBarColor.toHex()} !important;`];
        if (project.platformBar.stripes) {
          declarations.push(`background-image: ${stripeGradient(platformBarColor)} !important;`);
        }
        if (animate) {
          declarations.push('transition: background-color 300ms ease !important;');
        }
        rules.push(`#ocb-platform-bar { ${declarations.join(' ')} }`);
      }
      if (project.platformBarText.enabled) {
        const textColor = project.platformBarText.auto
          ? palette.resolve(project.platformBar.color).contrastingTextColor()
          : palette.resolve(project.platformBarText.color);
        const textDeclarations = [`color: ${textColor.toHex()} !important;`];
        if (animate) {
          textDeclarations.push('transition: color 300ms ease !important;');
        }
        rules.push(
          `.cfc-platform-bar-left *, .cfc-platform-bar-right *, .pcc-platform-bar-button * { ${textDeclarations.join(' ')} }`,
        );
      }
      platformBarStyle.textContent = rules.join('\n');
    };

    // Empty settings until the store's load() resolves: no rules, so nothing is tinted.
    // Seeded from CURRENT_SCHEMA_VERSION rather than the manifest version because this value
    // is never written back — only its (empty) rule list is read.
    const emptySettings = TintSettings.fromStored(null, CURRENT_SCHEMA_VERSION);
    let lastSettings: TintSettings = emptySettings;

    const applySettings = (settings: TintSettings, url: URL = new URL(location.href)) => {
      lastSettings = settings;
      const projectId = url.searchParams.get('project');
      const project = settings.resolveProjectSettings(projectId);
      if (project === null) {
        bar.style.display = 'none';
        platformBarStyle.textContent = '';
        return;
      }
      applyProjectSettings(project);
    };

    applySettings(emptySettings);

    // Composition root for this entrypoint: the content script owns its store instance.
    const settingsStore = new SettingsStoreImpl();

    settingsStore.load().then((settings) => {
      applySettings(settings);
    });

    settingsStore.watch((settings) => {
      applySettings(settings);
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
