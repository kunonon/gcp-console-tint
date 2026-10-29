import type { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsStoreImpl } from '../../out/browser-settings-store';
import { fillBackground } from '../fill-css';

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main(ctx) {
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
    // Shared viewport coordinates keep stripes aligned as the overlay height animates, and make
    // the viewport the gradient box, so the top bar and the platform bar show the same color at
    // the same x. Single values apply to every image layer.
    bar.style.backgroundAttachment = 'fixed';
    bar.style.backgroundPosition = '0 0';
    bar.style.backgroundSize = 'auto';
    if (animate) bar.style.transition = 'background-color 300ms ease, height 200ms ease';
    document.documentElement.appendChild(bar);

    const platformBarStyle = document.createElement('style');
    document.documentElement.appendChild(platformBarStyle);

    const applyProjectSettings = (project: ProjectSettings) => {
      const { palette } = project;
      if (project.topBar.enabled) {
        bar.style.display = '';
        bar.style.height = `${project.topBar.height.toPixels()}px`;
        const { color, image } = fillBackground(palette.resolve(project.topBar.color), project.topBar.stripes);
        bar.style.backgroundColor = color;
        bar.style.backgroundImage = image;
      } else {
        bar.style.display = 'none';
      }

      const rules: string[] = [];
      if (project.platformBar.enabled) {
        const { color, image } = fillBackground(
          palette.resolve(project.platformBar.color),
          project.platformBar.stripes,
        );
        const declarations = [`background-color: ${color} !important;`];
        // background-image is discrete, so a gradient change snaps while the color underneath
        // (a gradient's first stop) still crossfades.
        if (image !== '') {
          declarations.push(`background-image: ${image} !important;`);
          declarations.push('background-attachment: fixed !important;');
          declarations.push('background-position: 0 0 !important;');
          declarations.push('background-size: auto !important;');
        }
        if (animate) {
          declarations.push('transition: background-color 300ms ease !important;');
        }
        rules.push(`#ocb-platform-bar { ${declarations.join(' ')} }`);
      }
      if (project.platformBarText.enabled) {
        const textColor = project.platformBarText.auto
          ? palette.resolve(project.platformBar.color).contrastingTextColor()
          : palette.resolveSolid(project.platformBarText.color);
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
    const emptySettings = new TintSettings([], TintSettings.DEFAULT_THEME);
    let lastSettings: TintSettings = emptySettings;

    const applySettings = (settings: TintSettings, url: URL = new URL(location.href)) => {
      lastSettings = settings;
      const projectId = url.searchParams.get('project');
      const project = settings.resolveProjectSettings(projectId ?? undefined);
      if (project === undefined) {
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
