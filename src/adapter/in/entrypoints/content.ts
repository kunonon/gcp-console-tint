import type { Fill } from '../../../domain/gradient';
import type { ProjectSettings } from '../../../domain/project-settings';
import { TintSettings } from '../../../domain/tint-settings';
import { SettingsStoreImpl } from '../../out/browser-settings-store';
import {
  FADE_PROPERTY,
  FILL_IMAGE,
  FILL_PROPERTY_RULES,
  FILL_TRANSITION_PROPERTIES,
  fillKnots,
  fillProperties,
  KNOT_PROPERTIES,
} from '../fill-css';

export default defineContentScript({
  matches: ['https://console.cloud.google.com/*'],
  main(ctx) {
    // Crossfade colors when the settings for the current page change (e.g. switching GCP
    // projects). Honors the user's reduced-motion preference. Optional-chained because
    // jsdom has no matchMedia.
    const animate = !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    // The fill's colors live in registered custom properties (see fill-css.ts): the knots fade
    // through FADE_PROPERTY, the stripes by transition. background-color steps to the first knot only
    // once that fade is over: until then the previous color stays underneath (the console's own when
    // a rule first tints the platform bar), so knots fading in from transparent crossfade from it
    // instead of the first knot tinting the whole bar mid-fade. At rest the image is opaque and
    // covers it.
    const colorTransitions = [
      'background-color 0s linear 300ms',
      ...FILL_TRANSITION_PROPERTIES.map((name) => `${name} 300ms ease`),
    ].join(', ');

    // The knots as painted right now, or undefined when there is nothing to fade from (reduced motion,
    // no element, or jsdom, which has no animate()). jsdom lacking animate() keeps unit tests
    // deterministic.
    const paintedKnots = (element: Element | null): string[] | undefined => {
      if (!animate || element === null || typeof element.animate !== 'function') return undefined;
      const style = getComputedStyle(element);
      return KNOT_PROPERTIES.map((name) => style.getPropertyValue(name));
    };
    // WAAPI rather than a CSS animation: a platform bar the console re-creates mid-session would
    // replay a CSS animation from 0, while a finished WAAPI animation leaves FADE_PROPERTY at its
    // initial 1. An earlier fade still running is left alone: the later animation wins, and cancelling
    // every animation would also stop the stripes' and height's transitions.
    const fade = (element: Element) => element.animate({ [FADE_PROPERTY]: [0, 1] }, { duration: 300, easing: 'ease' });
    // The knots each bar last faded from and to. Applying the same fill again (a storage write for
    // another rule, a second locationchange for the same project) keeps that fade running instead of
    // restarting it from the knots it has reached, as a <color> transition to an unchanged value
    // would.
    type Fade = { to: string; from: string[] | undefined };
    let topBarFade: Fade | undefined;
    let platformBarFade: Fade | undefined;
    // `from` for a bar about to paint `fill`: the last fade's when the target is unchanged, else the
    // knots on screen. `fresh` says whether a new fade starts.
    const fadeFrom = (last: Fade | undefined, fill: Fill, painted: () => string[] | undefined) => {
      const to = fillKnots(fill).join();
      if (last?.to === to) return { next: last, fresh: false };
      return { next: { to, from: painted() }, fresh: true };
    };

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
        // Read before the bar is shown: a hidden bar has nothing on screen, so it appears at once
        // (display: none starts no transition either).
        const fill = palette.resolve(project.topBar.color);
        const shown = bar.style.display !== 'none';
        const { next, fresh } = fadeFrom(topBarFade, fill, () => (shown ? paintedKnots(bar) : undefined));
        topBarFade = next;
        bar.style.display = '';
        bar.style.height = `${project.topBar.height.toPixels()}px`;
        const { color, properties } = fillProperties(fill, project.topBar.stripes, next.from);
        for (const [name, value] of properties) bar.style.setProperty(name, value);
        bar.style.backgroundColor = color;
        if (fresh && next.from) fade(bar);
      } else {
        bar.style.display = 'none';
        topBarFade = undefined;
      }

      const rules: string[] = [];
      // Read before the rule changes. Without a rule yet the knots read as transparent (their
      // registered initial value), so the first tint fades in from the console's own color.
      const platformBar = document.querySelector('#ocb-platform-bar');
      let platformFade = false;
      if (project.platformBar.enabled) {
        const fill = palette.resolve(project.platformBar.color);
        const { next, fresh } = fadeFrom(platformBarFade, fill, () => paintedKnots(platformBar));
        platformBarFade = next;
        platformFade = fresh && next.from !== undefined;
        const { color, properties } = fillProperties(fill, project.platformBar.stripes, next.from);
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
      } else {
        platformBarFade = undefined;
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
      if (platformFade && platformBar) fade(platformBar);
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
        topBarFade = undefined;
        platformBarFade = undefined;
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
