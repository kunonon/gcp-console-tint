import type { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsStoreImpl } from '../../out/browser-settings-store';
import { FILL_IMAGE, FILL_PROPERTIES, FILL_PROPERTY_RULES, fillProperties } from '../fill-css';

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main(ctx) {
    // Crossfade colors when the settings for the current page change (e.g. switching GCP
    // projects). Honors the user's reduced-motion preference. Optional-chained because
    // jsdom has no matchMedia.
    const animate = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    // The fill's colors live in registered custom properties (see fill-css.ts), so they are what
    // crossfades a gradient or stripes. background-color steps to the first knot only once that fade
    // is over: until then the previous color stays underneath (the console's own when a rule first
    // tints the platform bar), so knots fading in from transparent crossfade from it instead of the
    // first knot tinting the whole bar mid-fade. At rest the image is opaque and covers it.
    const colorTransitions = [
      'background-color 0s linear 300ms',
      ...FILL_PROPERTIES.map((name) => `${name} 300ms ease`),
    ].join(', ');

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
    bar.style.backgroundImage = FILL_IMAGE;
    if (animate) bar.style.transition = `${colorTransitions}, height 200ms ease`;
    document.documentElement.appendChild(bar);

    const platformBarStyle = document.createElement('style');
    document.documentElement.appendChild(platformBarStyle);

    // The @property registrations, in their own element because platformBarStyle is emptied when no
    // rule matches, while the top bar's inline properties need the registrations all the time.
    const fillPropertyStyle = document.createElement('style');
    fillPropertyStyle.textContent = FILL_PROPERTY_RULES;
    document.documentElement.appendChild(fillPropertyStyle);

    const applyProjectSettings = (project: ProjectSettings) => {
      const { palette } = project;
      if (project.topBar.enabled) {
        bar.style.display = '';
        bar.style.height = `${project.topBar.height.toPixels()}px`;
        const { color, properties } = fillProperties(palette.resolve(project.topBar.color), project.topBar.stripes);
        for (const [name, value] of properties) bar.style.setProperty(name, value);
        bar.style.backgroundColor = color;
      } else {
        bar.style.display = 'none';
      }

      const rules: string[] = [];
      if (project.platformBar.enabled) {
        const { color, properties } = fillProperties(
          palette.resolve(project.platformBar.color),
          project.platformBar.stripes,
        );
        // The same fixed image template and viewport box as the top bar, so both bars show the same
        // color at the same x and only the properties change between projects.
        const declarations = [
          `background-color: ${color} !important;`,
          ...properties.map(([name, value]) => `${name}: ${value} !important;`),
          `background-image: ${FILL_IMAGE} !important;`,
          'background-attachment: fixed !important;',
          'background-position: 0 0 !important;',
          'background-size: auto !important;',
        ];
        if (animate) {
          declarations.push(`transition: ${colorTransitions} !important;`);
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
