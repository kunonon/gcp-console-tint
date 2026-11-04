import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { StoredSettingsError } from '../../../../port/settings-store';
import contentScript from '../content';

// A stored fill: { type: 'solid', color } or { type: 'gradient', stops }.
type StoredFill = { type: 'solid'; color: string } | { type: 'gradient'; stops: { color: string; position: number }[] };

const solid = (color: string): StoredFill => ({ type: 'solid', color });

interface PaletteEntry {
  id: string;
  name: string;
  color: StoredFill;
}

// The platform bar text's selection: its custom stays a plain color string.
interface ColorSelection {
  paletteId: string | null;
  custom: string;
}

// The bars' selection, whose custom may be a gradient.
interface FillSelection {
  paletteId: string | null;
  custom: StoredFill;
}

interface PaletteSettings {
  enabled: boolean;
  entries: PaletteEntry[];
}

interface TopBarSettings {
  enabled: boolean;
  color: FillSelection;
  height: number;
  stripes: boolean;
}

interface PlatformBarSettings {
  enabled: boolean;
  color: FillSelection;
  stripes: boolean;
}

interface PlatformBarTextSettings {
  enabled: boolean;
  color: ColorSelection;
  auto: boolean;
}

interface ProjectSettings {
  palette: PaletteSettings;
  topBar: TopBarSettings;
  platformBar: PlatformBarSettings;
  platformBarText: PlatformBarTextSettings;
}

// Partial, section-by-section override shape for building test fixtures: every section (and
// each section's nested `color`) is independently optional. The storage reader is strict, so
// tintSettings() merges the overrides into a complete rule (DEFAULT_STORED_SETTINGS) before
// storing it.
interface ProjectSettingsOverrides {
  palette?: Partial<PaletteSettings>;
  topBar?: Partial<Omit<TopBarSettings, 'color'>> & { color?: Partial<FillSelection> };
  platformBar?: Partial<Omit<PlatformBarSettings, 'color'>> & { color?: Partial<FillSelection> };
  platformBarText?: Partial<Omit<PlatformBarTextSettings, 'color'>> & { color?: Partial<ColorSelection> };
}

type MatchType = 'prefix' | 'suffix' | 'exact' | 'regex';

interface ProjectRule {
  id: string;
  matchType: MatchType;
  pattern: string;
  settings: ProjectSettings;
}

interface TintSettings {
  schemaVersion: string;
  theme: string;
  projectRules: ProjectRule[];
}

// The manifest version these tests run under: equal to CURRENT_SCHEMA_VERSION, so defaulted
// fixtures are current-schema data that no migration step touches.
const CURRENT_VERSION = '0.5.0';

// Our main() reads `ctx.addEventListener` to subscribe to WXT's `wxt:locationchange` event, and
// `ctx.onInvalidated` to stop watching the page. The real ContentScriptContext is only constructed
// by WXT's entrypoint wrapper (not present when importing content.ts directly in tests), so we
// provide a minimal fake here: addEventListener forwards to the target's native one, and
// onInvalidated keeps the callback, which is all our code relies on. The listeners are removed and
// the invalidation callbacks run after each test, as WXT's context does when a content script is
// invalidated, so an earlier test's script does not react to a later test's location changes or DOM.
const ctxListeners: (() => void)[] = [];
function createFakeCtx() {
  return {
    addEventListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
      target.addEventListener(type, listener as EventListener);
      ctxListeners.push(() => target.removeEventListener(type, listener as EventListener));
    },
    onInvalidated(callback: () => void) {
      ctxListeners.push(callback);
      return () => {};
    },
  };
}

// Runs what WXT runs when the content script is invalidated.
function invalidateContentScripts() {
  for (const remove of ctxListeners.splice(0)) remove();
}

afterEach(() => {
  invalidateContentScripts();
  vi.restoreAllMocks();
});

function runContentScript() {
  const ctx = createFakeCtx();
  (contentScript.main as (ctx: unknown) => void)(ctx);
}

function getElements() {
  const children = Array.from(document.documentElement.children);
  const bar = children.find((el) => el.tagName === 'DIV') as HTMLDivElement | undefined;
  const styleEl = children.find((el) => el.tagName === 'STYLE') as HTMLStyleElement | undefined;
  if (!bar || !styleEl) throw new Error('overlay bar or style element not found');
  return { bar, styleEl };
}

// The fill's registered custom properties (fill-css.ts): 101 target knots (to), the knots the
// fade starts from (from), the painted knots mixing the two (stop), and the stripe pair.
const KNOTS = 101;
const knotNames = (kind: string) => Array.from({ length: KNOTS }, (_, k) => `--gcp-console-tint-${kind}-${k}`);
const TO = knotNames('to');
const FROM = knotNames('from');
const STOPS = knotNames('stop');
const STRIPE_LIGHT = '--gcp-console-tint-stripe-light';
const STRIPE_DARK = '--gcp-console-tint-stripe-dark';
const FADE = '--gcp-console-tint-fade';
// stop-k's mix from from-k to to-k by the fade, on the shorter hue arc unless knotMixes says otherwise.
const stopMix = (k: number) =>
  `color-mix(in oklch shorter hue, var(${FROM[k]}), var(${TO[k]}) calc(var(${FADE}, 1) * 100%))`;
// The fixed image both bars paint: stripes over the 101-knot sRGB gradient, every color a property.
const FILL_IMAGE = `repeating-linear-gradient(-45deg, var(${STRIPE_LIGHT}) 0 8px, var(${STRIPE_DARK}) 8px 16px), linear-gradient(in srgb to right, ${STOPS.map((name) => `var(${name})`).join(', ')})`;
// background-color steps to the first knot after the knots' fade, so the color underneath stays
// the previous one while they fade. The knots fade through FADE, so only the stripes transition.
const COLOR_TRANSITIONS = [
  'background-color 0s linear 300ms',
  ...[STRIPE_LIGHT, STRIPE_DARK].map((name) => `${name} 300ms ease`),
].join(', ');

// The top bar's inline stripe pair.
function stripePair(bar: HTMLElement) {
  return [bar.style.getPropertyValue(STRIPE_LIGHT), bar.style.getPropertyValue(STRIPE_DARK)];
}

// Flushes the microtask queue so the async `browser.storage.local.get(...).then(...)`
// inside main() has a chance to resolve and apply before assertions run.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function hexOrRgb(hex: string): (string | undefined)[] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return [hex, `rgb(${r}, ${g}, ${b})`];
}

function setLocation(url: string) {
  window.history.pushState({}, '', url);
}

// Mirrors WXT's WxtLocationChangeEvent payload: the handler must read the project id from
// event.newUrl (the real event fires before window.location is committed).
function triggerLocationChange(newUrl: string = location.href) {
  const event = new Event('wxt:locationchange') as Event & { newUrl: URL };
  event.newUrl = new URL(newUrl, location.origin);
  window.dispatchEvent(event);
}

// A rule's settings as this build stores ProjectSettings.DEFAULT (settings-repository's toStored).
const DEFAULT_STORED_SETTINGS: ProjectSettings = {
  palette: { enabled: true, entries: [{ id: 'default', name: 'Primary', color: solid('#ff6d00') }] },
  topBar: { enabled: true, color: { paletteId: 'default', custom: solid('#ff6d00') }, height: 4, stripes: false },
  platformBar: { enabled: true, color: { paletteId: 'default', custom: solid('#ff6d00') }, stripes: false },
  platformBarText: { enabled: true, color: { paletteId: null, custom: '#ffffff' }, auto: false },
};

// The overrides merged section by section (and each section's `color` field by field) into
// DEFAULT_STORED_SETTINGS, so the stored rule is complete.
function storedSettings(overrides: ProjectSettingsOverrides = {}): ProjectSettings {
  const d = DEFAULT_STORED_SETTINGS;
  return {
    palette: { ...d.palette, ...overrides.palette },
    topBar: { ...d.topBar, ...overrides.topBar, color: { ...d.topBar.color, ...overrides.topBar?.color } },
    platformBar: {
      ...d.platformBar,
      ...overrides.platformBar,
      color: { ...d.platformBar.color, ...overrides.platformBar?.color },
    },
    platformBarText: {
      ...d.platformBarText,
      ...overrides.platformBarText,
      color: { ...d.platformBarText.color, ...overrides.platformBarText?.color },
    },
  };
}

// Current-schema storage: stamped with this build's version under theme auto, every rule
// completed by storedSettings(). Tests that probe unreadable or older data seed storage directly.
function tintSettings(partial: {
  projectRules?: { id: string; matchType: MatchType; pattern: string; settings?: ProjectSettingsOverrides }[];
}): { tintSettings: TintSettings } {
  return {
    tintSettings: {
      schemaVersion: CURRENT_VERSION,
      theme: 'auto',
      projectRules: (partial.projectRules ?? []).map((rule) => ({ ...rule, settings: storedSettings(rule.settings) })),
    },
  };
}

// Schema change: `defaultProject` (the fallback project) has been removed entirely — a
// project's settings only ever come from a matching rule. Most content.ts behavior tests
// don't care about rule matching/priority itself, so this helper seeds a single rule that
// matches TEST_PROJECT_PATTERN and pairs with setTestProjectLocation() below.
// Kept as matchType: 'regex' (rather than switching to e.g. 'prefix') so the pattern string
// itself didn't need to change; full-match regex semantics still resolve it to exactly
// "test-project", identical to the old (partial-match) behavior for this already-anchored
// pattern.
const TEST_PROJECT_PATTERN = '^test-project$';

function setTestProjectLocation() {
  setLocation('/?project=test-project');
}

function tintSettingsWithRule(
  settings: ProjectSettingsOverrides,
  pattern: string = TEST_PROJECT_PATTERN,
  matchType: MatchType = 'regex',
) {
  return tintSettings({ projectRules: [{ id: 'r', matchType, pattern, settings }] });
}

// A complete rule as 0.1.x-0.4.x stored it: '#rrggbb' strings in every fill slot, the top bar's
// custom `color` selected.
function legacyRule(pattern: string, color: string, height = 4) {
  return {
    id: 'legacy',
    matchType: 'regex',
    pattern,
    settings: {
      palette: { enabled: true, entries: [{ id: 'default', name: 'Primary', color: '#ff6d00' }] },
      topBar: { enabled: true, color: { paletteId: null, custom: color }, height, stripes: false },
      platformBar: { enabled: true, color: { paletteId: 'default', custom: '#ff6d00' }, stripes: false },
      platformBarText: { enabled: true, color: { paletteId: null, custom: '#ffffff' }, auto: false },
    },
  };
}

// Nothing painted: the bar hidden and no generated CSS.
function expectUntinted() {
  const { bar, styleEl } = getElements();
  expect(bar.style.display).toBe('none');
  expect(styleEl.textContent).toBe('');
}

// The content script's log for storage it refused to read, once, with the reader's error.
function expectUnreadableLogged(consoleError: { mock: { calls: unknown[][] } }) {
  expect(consoleError.mock.calls).toEqual([
    ['[gcp-console-tint] saved settings could not be read', expect.any(StoredSettingsError)],
  ]);
}

beforeEach(() => {
  fakeBrowser.reset();
  // @webext-core/fake-browser leaves runtime.getManifest() as an unimplemented stub that
  // throws; content.ts calls it unconditionally to stamp/compare schemaVersion, so tests
  // shim it here to return a fixed current version.
  (fakeBrowser.runtime as { getManifest: () => { version: string } }).getManifest = () => ({
    version: CURRENT_VERSION,
  });
  document.documentElement.innerHTML = '<head></head><body></body>';
  window.history.pushState({}, '', '/');
});

describe('content script', () => {
  it('shows nothing immediately on load, before storage has been read', () => {
    runContentScript();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('shows nothing when storage has no rules and there is no project param (no fallback project)', async () => {
    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('applies a stored topBarHeight value', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { height: 12 } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('12px');
  });

  // No current build stores these: the reader refuses them, and nothing is painted.
  it.each([0, 41, Number.NaN, -5, 2.5])('tints nothing and logs when the stored height is %s', async (invalid) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { height: invalid } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    expectUntinted();
    expectUnreadableLogged(consoleError);
  });

  // 0.1.x saved any finite height and painted it rounded; the 0.2.0 step reads it the same way.
  it('paints a v0.1.3 fractional height rounded, as v0.1.3 did', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: { schemaVersion: '0.1.3', projectRules: [legacyRule(TEST_PROJECT_PATTERN, '#334455', 2.5)] },
    });
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('3px');
    expect(hexOrRgb('#334455')).toContain(bar.style.backgroundColor);
  });

  it.each([1, 4, 12, 40])('sets shared viewport background properties at top bar height %i px', async (height) => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBar: { height, stripes: true }, platformBar: { stripes: true } }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.height).toBe(`${height}px`);
    expect(bar.style.backgroundAttachment).toBe('fixed');
    expect(bar.style.backgroundPosition).toBe('0px 0px');
    expect(bar.style.backgroundSize).toBe('auto');
    expect(styleEl.textContent).toContain('background-attachment: fixed !important;');
    expect(styleEl.textContent).toContain('background-position: 0 0 !important;');
    expect(styleEl.textContent).toContain('background-size: auto !important;');
  });

  it('keeps viewport background properties after a live height change and makes disabled stripes transparent', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBar: { height: 1, stripes: true }, platformBar: { stripes: true } }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBar: { height: 40, stripes: true }, platformBar: { stripes: true } }),
    );
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.height).toBe('40px');
    expect(bar.style.backgroundAttachment).toBe('fixed');
    expect(bar.style.backgroundPosition).toBe('0px 0px');
    expect(bar.style.backgroundSize).toBe('auto');
    expect(styleEl.textContent).toContain('background-attachment: fixed !important;');
    expect(styleEl.textContent).toContain('background-position: 0 0 !important;');
    expect(styleEl.textContent).toContain('background-size: auto !important;');

    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBar: { height: 40, stripes: false }, platformBar: { stripes: false } }),
    );
    await flush();

    // Stripes stay a layer with transparent colors, so turning them off fades rather than snaps.
    expect(stripePair(bar)).toEqual(['transparent', 'transparent']);
    expect(bar.style.backgroundImage).toBe(FILL_IMAGE);
    expect(styleEl.textContent).toContain(
      `${STRIPE_LIGHT}: transparent !important; ${STRIPE_DARK}: transparent !important;`,
    );
    expect(styleEl.textContent).toContain(`background-image: ${FILL_IMAGE} !important;`);
    expect(styleEl.textContent).toContain('background-attachment: fixed !important;');
    expect(styleEl.textContent).toContain('background-position: 0 0 !important;');
    expect(styleEl.textContent).toContain('background-size: auto !important;');
  });

  it('applies the Top bar stripe gradient when topBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBar: { stripes: true, color: { paletteId: null, custom: solid('#ffff00') } } }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.backgroundImage).toBe(FILL_IMAGE);
    expect(stripePair(bar)).toEqual(['transparent', 'rgba(0, 0, 0, 0.3)']);
  });

  it('makes the Top bar stripes transparent when topBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { stripes: false } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(stripePair(bar)).toEqual(['transparent', 'transparent']);
  });

  it('applies the Platform Bar stripe gradient to the CSS rule when platformBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ platformBar: { stripes: true, color: { paletteId: null, custom: solid('#000080') } } }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain(`background-image: ${FILL_IMAGE} !important;`);
    expect(styleEl.textContent).toContain(
      `${STRIPE_LIGHT}: rgba(255, 255, 255, 0.3) !important; ${STRIPE_DARK}: transparent !important;`,
    );
  });

  it.each([
    { topBarColor: '#7744ee', platformBarColor: '#ff0000' },
    { topBarColor: '#ff0000', platformBarColor: '#7744ee' },
  ])('aligns bright and dark stripe phases for mixed colors', async ({ topBarColor, platformBarColor }) => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        topBar: { stripes: true, color: { paletteId: null, custom: solid(topBarColor) } },
        platformBar: { stripes: true, color: { paletteId: null, custom: solid(platformBarColor) } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    const brightFirst = ['rgba(255, 255, 255, 0.3)', 'transparent'];
    const darkSecond = ['transparent', 'rgba(0, 0, 0, 0.3)'];
    const topBarPair = topBarColor === '#7744ee' ? brightFirst : darkSecond;
    const [light, dark] = platformBarColor === '#7744ee' ? brightFirst : darkSecond;
    expect(stripePair(bar)).toEqual(topBarPair);
    expect(styleEl.textContent).toContain(`${STRIPE_LIGHT}: ${light} !important; ${STRIPE_DARK}: ${dark} !important;`);
  });

  it('makes the Platform Bar stripes transparent when platformBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBar: { stripes: false } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain(
      `${STRIPE_LIGHT}: transparent !important; ${STRIPE_DARK}: transparent !important;`,
    );
    expect(styleEl.textContent).toContain(`background-image: ${FILL_IMAGE} !important;`);
  });

  it('follows the resolved palette color for stripe tinting on both Top bar and Platform Bar', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [{ id: 'default', name: 'Primary', color: solid('#ffff00') }] },
        topBar: { color: { paletteId: 'default' }, stripes: true },
        platformBar: { color: { paletteId: 'default' }, stripes: true },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // Bright palette color -> black-tinted stripes on both.
    expect(stripePair(bar)).toEqual(['transparent', 'rgba(0, 0, 0, 0.3)']);
    expect(styleEl.textContent).toContain(`${STRIPE_DARK}: rgba(0, 0, 0, 0.3) !important;`);
  });

  it('applies settings already stored before load, including palette reference resolution', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [{ id: 'default', name: 'Primary', color: solid('#123456') }] },
        topBar: { color: { paletteId: 'default' } },
        platformBar: { color: { paletteId: null, custom: solid('#000000') } },
        platformBarText: { color: { paletteId: null, custom: '#abcdef' } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // topBar references the "default" palette entry -> resolves to the palette color.
    expect(hexOrRgb('#123456')).toContain(bar.style.backgroundColor);
    // platformBar has no reference (paletteId: null) -> uses its own raw color. (Not asserting
    // a trailing "}" here: with transitions enabled, content.ts appends a
    // `transition: ...` declaration after this one, inside the same rule.)
    expect(styleEl.textContent).toContain('#ocb-platform-bar { background-color: #000000 !important;');
    expect(styleEl.textContent).toContain('color: #abcdef !important;');
  });

  it('resolves to the palette entry color when paletteId references an existing entry', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [{ id: 'default', name: 'Primary', color: solid('#111111') }] },
        topBar: { color: { paletteId: 'default', custom: solid('#999999') } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#111111')).toContain(bar.style.backgroundColor);
  });

  it('falls back to the item own color when paletteId does not match any palette entry', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [] },
        topBar: { color: { paletteId: 'missing-id', custom: solid('#222222') } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#222222')).toContain(bar.style.backgroundColor);
  });

  it('falls back to the item own color when paletteEnabled is false, even with a valid reference', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { enabled: false, entries: [{ id: 'default', name: 'Primary', color: solid('#111111') }] },
        topBar: { color: { paletteId: 'default', custom: solid('#333333') } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#333333')).toContain(bar.style.backgroundColor);
  });

  it('hides the overlay bar when topBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { enabled: false } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.display).toBe('none');
  });

  it('omits only the background rule when platformBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBar: { enabled: false } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).not.toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('.cfc-platform-bar-left');
    expect(styleEl.textContent).toContain('.pcc-platform-bar-button');
  });

  it('omits only the text color rule when platformBarTextEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBarText: { enabled: false } }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('#ocb-platform-bar');
    expect(styleEl.textContent).not.toContain('.cfc-platform-bar-left');
    expect(styleEl.textContent).not.toContain('.pcc-platform-bar-button');
  });

  it('produces an empty style tag when both platformBarEnabled and platformBarTextEnabled are false', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ platformBar: { enabled: false }, platformBarText: { enabled: false } }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toBe('');
  });

  it('reapplies settings immediately when storage.onChanged fires', async () => {
    setTestProjectLocation();
    runContentScript();
    await flush();

    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [{ id: 'default', name: 'Primary', color: solid('#ff6d00') }] },
        topBar: { color: { paletteId: null, custom: solid('#00ff00') } },
      }),
    );
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#00ff00')).toContain(bar.style.backgroundColor);
  });

  it('computes an auto text color with sufficient contrast against a dark Platform Bar background', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        platformBar: { color: { paletteId: null, custom: solid('#000080') } },
        platformBarText: { auto: true },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('computes an auto text color with sufficient contrast against a bright Platform Bar background', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        platformBar: { color: { paletteId: null, custom: solid('#ffff00') } },
        platformBarText: { auto: true },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #000000 !important;');
  });

  it('auto text color follows the Platform Bar background resolved via a palette reference', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: { entries: [{ id: 'default', name: 'Primary', color: solid('#000080') }] },
        platformBar: { color: { paletteId: 'default' } },
        platformBarText: { auto: true },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('auto text color takes priority over a stored platformBarTextColor/paletteId', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        platformBar: { color: { custom: solid('#ffff00') } },
        platformBarText: { auto: true, color: { paletteId: null, custom: '#ff00ff' } },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #000000 !important;');
    expect(styleEl.textContent).not.toContain('#ff00ff');
  });

  it('computes the auto text color from platformBarColor even when platformBarEnabled is false (documented residual behavior)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        platformBar: { enabled: false, color: { paletteId: null, custom: solid('#000080') } },
        platformBarText: { auto: true },
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    // The background rule itself is omitted (platformBarEnabled: false), but the auto text
    // color is still computed against what platformBarColor would resolve to.
    expect(styleEl.textContent).not.toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  // Storage the reader refuses tints nothing, even where a rule would have matched: no stored
  // #334455, and no default color either.
  it.each([
    ['no schemaVersion (the pre-release shape)', { projectRules: [legacyRule(TEST_PROJECT_PATTERN, '#334455')] }],
    ['a non-string schemaVersion', { schemaVersion: 123, projectRules: [legacyRule(TEST_PROJECT_PATTERN, '#334455')] }],
    [
      'a schemaVersion below SCHEMA_MIN_VERSION',
      { schemaVersion: '0.0.9', projectRules: [legacyRule(TEST_PROJECT_PATTERN, '#334455')] },
    ],
    // A newer build's data is not read at all (its unknown fields would be lost).
    [
      'a schemaVersion newer than this build',
      {
        schemaVersion: '9.9.9',
        theme: 'auto',
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: TEST_PROJECT_PATTERN,
            settings: storedSettings({ topBar: { color: { paletteId: null, custom: solid('#334455') } } }),
          },
        ],
      },
    ],
    // Pre-release: no SCHEMA_MIGRATIONS step reshapes the flat rule settings (the 0.2.0 step finds
    // no topBar).
    [
      'the pre-release flat rule settings at schemaVersion 0.1.0',
      {
        schemaVersion: '0.1.0',
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: TEST_PROJECT_PATTERN,
            settings: { topBarPaletteId: null, topBarColor: '#334455' },
          },
        ],
      },
    ],
    ['a string', 'not-a-settings-record'],
  ])('tints nothing and logs when storage holds %s', async (_label, stored) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fakeBrowser.storage.local.set({ tintSettings: stored });
    setTestProjectLocation();

    runContentScript();
    await flush();

    expectUntinted();
    expectUnreadableLogged(consoleError);
  });

  // Only an absent key is an unconfigured install. Stubbed: fake-browser's set() deletes a key set
  // to null (the cast because the spy's type follows get()'s void-returning callback overload).
  it('tints nothing and logs when storage holds null', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation((async () => ({ tintSettings: null })) as never);
    setTestProjectLocation();

    runContentScript();
    await flush();

    expectUntinted();
    expectUnreadableLogged(consoleError);
  });

  // SCHEMA_MIN_VERSION data goes through the 0.2.0 step (an in-range height is kept), the 0.3.0
  // step, which adds the theme, and the 0.5.0 step, which wraps the plain '#rrggbb' fills as
  // { type: 'solid', color }; the rules are otherwise already in the current nested shape and apply.
  it('applies stored data whose schemaVersion equals SCHEMA_MIN_VERSION (nested shape, plain-string fills)', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: { schemaVersion: '0.1.0', projectRules: [legacyRule(TEST_PROJECT_PATTERN, '#334455')] },
    });
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#334455')).toContain(bar.style.backgroundColor);
  });

  it('applies project-specific settings when the URL "project" param matches a rule pattern', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/?project=my-project');

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#222222')).toContain(bar.style.backgroundColor);
  });

  it('applies the first matching rule when multiple rules match the same "project" param (priority order)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
          {
            id: '2',
            matchType: 'regex',
            pattern: 'project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#333333') } } },
          },
        ],
      }),
    );
    setLocation('/?project=my-project');

    runContentScript();
    await flush();

    const { bar } = getElements();
    // Both rules match "my-project", but the earlier rule in the array wins.
    expect(hexOrRgb('#222222')).toContain(bar.style.backgroundColor);
  });

  it('shows nothing when the URL "project" param does not match any rule (no fallback project)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/?project=unknown-project');

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('shows nothing when there is no "project" param in the URL (no fallback project)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/');

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('applies matching rule settings when the URL "project" param changes to match (wxt:locationchange)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/');

    runContentScript();
    await flush();

    const initial = getElements();
    expect(initial.bar.style.display).toBe('none');
    expect(initial.styleEl.textContent).toBe('');

    setLocation('/?project=my-project');
    triggerLocationChange();

    expect(hexOrRgb('#222222')).toContain(getElements().bar.style.backgroundColor);
  });

  it('clears applied settings when the URL "project" param changes from a match to a non-match (wxt:locationchange)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/?project=my-project');

    runContentScript();
    await flush();

    expect(hexOrRgb('#222222')).toContain(getElements().bar.style.backgroundColor);

    setLocation('/?project=unknown-project');
    triggerLocationChange();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('resolves the project from event.newUrl even when window.location has not been committed yet', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/');

    runContentScript();
    await flush();

    const initial = getElements();
    expect(initial.bar.style.display).toBe('none');
    expect(initial.styleEl.textContent).toBe('');

    // The real Navigation API `navigate` event fires BEFORE the URL is committed, so
    // window.location still points at '/' here. Only event.newUrl carries the target URL.
    triggerLocationChange('/?project=my-project');

    expect(hexOrRgb('#222222')).toContain(getElements().bar.style.backgroundColor);
  });

  it('resolves colors from each rule\'s own palette independently when the "project" param switches between rules', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: 'rule-a',
            matchType: 'regex',
            pattern: '^project-a$',
            settings: {
              palette: { entries: [{ id: 'p', name: 'A Palette', color: solid('#aaaaaa') }] },
              topBar: { color: { paletteId: 'p', custom: solid('#cccccc') } },
            },
          },
          {
            id: 'rule-b',
            matchType: 'regex',
            pattern: '^project-b$',
            settings: {
              palette: { entries: [{ id: 'p', name: 'B Palette', color: solid('#bbbbbb') }] },
              topBar: { color: { paletteId: 'p', custom: solid('#dddddd') } },
            },
          },
        ],
      }),
    );
    setLocation('/?project=project-a');

    runContentScript();
    await flush();

    // rule-a's own palette entry "p" resolves to its own color, not rule-b's.
    expect(hexOrRgb('#aaaaaa')).toContain(getElements().bar.style.backgroundColor);

    setLocation('/?project=project-b');
    triggerLocationChange();

    // Switching to rule-b resolves "p" against rule-b's own palette instead.
    expect(hexOrRgb('#bbbbbb')).toContain(getElements().bar.style.backgroundColor);
  });

  it('applies rule settings end-to-end for a non-regex matchType ("exact") when the project id equals the pattern', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'exact',
            pattern: 'test-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#654321') } } },
          },
        ],
      }),
    );
    setLocation('/?project=test-project');

    runContentScript();
    await flush();

    expect(hexOrRgb('#654321')).toContain(getElements().bar.style.backgroundColor);
  });

  it('does not apply an "exact" matchType rule when the project id is only a superstring of the pattern', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'exact',
            pattern: 'test-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#654321') } } },
          },
        ],
      }),
    );
    setLocation('/?project=test-project-123');

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('applies topBarHeight at the range boundaries (1 and 40) without adjustment', async () => {
    for (const boundary of [1, 40]) {
      document.documentElement.innerHTML = '<head></head><body></body>';
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { height: boundary } }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { bar } = getElements();
      expect(bar.style.height).toBe(`${boundary}px`);
    }
  });

  it('treats an empty "project" param the same as no param at all (nothing applied)', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBar: { color: { paletteId: null, custom: solid('#222222') } } },
          },
        ],
      }),
    );
    setLocation('/?project=');

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('registers the content script only for the GCP Console origin (regression guard against a mis-edited matches array)', () => {
    expect(contentScript.matches).toEqual(['https://console.cloud.google.com/*']);
  });

  describe('storage.onChanged defensive branches', () => {
    it('ignores changes reported for a storage area other than "local"', async () => {
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      // A change in `sync` storage must not trigger a re-apply of `local`'s tintSettings.
      await fakeBrowser.storage.sync.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#999999') } } }),
      );
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });

    it('ignores changes to unrelated keys in local storage', async () => {
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      await fakeBrowser.storage.local.set({ someUnrelatedKey: 'value' });
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });

    it('does not reapply (keeps the last applied state) when the tintSettings key is removed from storage', async () => {
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      // On removal, Chrome and Firefox report changes.tintSettings with an oldValue and no
      // newValue; the store's watch skips it, so the bar keeps showing the last applied color
      // rather than resetting to "nothing". Dispatched by hand: fake-browser's remove() reports
      // newValue: null, which no browser does.
      const { tintSettings: oldValue } = await fakeBrowser.storage.local.get('tintSettings');
      await fakeBrowser.storage.onChanged.trigger({ tintSettings: { oldValue } }, 'local');
      await flush();

      expect(getElements().bar.style.display).not.toBe('none');
      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });

    // A tab already tinted agrees with a newly opened one, whose load() refuses the same value.
    it('removes the tint when an unreadable value is stored, and tints again once a readable one is', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();
      runContentScript();
      await flush();
      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBar: { height: 0 } }));
      await flush();

      expectUntinted();
      expectUnreadableLogged(consoleError);

      // An SPA navigation re-resolves against the last applied settings, which are the empty ones
      // now, not the refused data's predecessor.
      setLocation('/?project=test-project&tab=logs');
      triggerLocationChange();
      await flush();

      expectUntinted();

      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#222222') } } }),
      );
      await flush();

      expect(getElements().bar.style.display).not.toBe('none');
      expect(hexOrRgb('#222222')).toContain(getElements().bar.style.backgroundColor);
    });

    // The storage API's own failure is not unreadable data, but there is nothing to paint either.
    it('tints nothing and logs when storage cannot be read at all', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const storageError = new Error('storage is unavailable');
      vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(storageError);
      setTestProjectLocation();

      runContentScript();
      await flush();

      expectUntinted();
      expect(consoleError.mock.calls).toEqual([['[gcp-console-tint] saved settings could not be read', storageError]]);
    });
  });

  describe('project-switch transitions', () => {
    it('does not throw and treats motion as enabled when window.matchMedia is undefined (plain jsdom)', async () => {
      expect(window.matchMedia).toBeUndefined();

      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      expect(() => runContentScript()).not.toThrow();
      await flush();

      const { bar, styleEl } = getElements();
      expect(bar.style.transition).not.toBe('');
      expect(styleEl.textContent).toContain('transition:');
    });

    it('applies the color and height transitions to the bar element when motion is not reduced', async () => {
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { bar } = getElements();
      expect(bar.style.transition).toBe(`${COLOR_TRANSITIONS}, height 200ms ease`);
    });

    it('adds transition declarations to the generated Platform Bar and text CSS rules', async () => {
      await fakeBrowser.storage.local.set(
        tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
      );
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { styleEl } = getElements();
      expect(styleEl.textContent).toContain(`transition: ${COLOR_TRANSITIONS} !important;`);
      expect(styleEl.textContent).toContain('transition: color 300ms ease !important');
    });

    describe('when the user prefers reduced motion', () => {
      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('omits all transition declarations from both the bar element and the generated CSS rules', async () => {
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

        await fakeBrowser.storage.local.set(
          tintSettingsWithRule({ topBar: { color: { paletteId: null, custom: solid('#111111') } } }),
        );
        setTestProjectLocation();

        runContentScript();
        await flush();

        const { bar, styleEl } = getElements();
        expect(bar.style.transition).toBe('');
        expect(styleEl.textContent).not.toContain('transition');
        // The properties still carry the colors; only the fade is gone.
        expect(bar.style.getPropertyValue(TO[0] ?? '')).toBe('#111111');
      });

      it('paints a switch at once even where animate() exists: from is the target, and nothing animates', async () => {
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
        const animate = vi.fn();
        HTMLElement.prototype.animate = animate;
        try {
          await switchFromOrangeToBlue();
          const { bar } = getElements();
          expect(animate).not.toHaveBeenCalled();
          expect(FROM.map((name) => bar.style.getPropertyValue(name))).toEqual(Array(KNOTS).fill('#1a73e8'));
        } finally {
          delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
        }
      });
    });

    describe('where the browser can animate', () => {
      afterEach(() => {
        delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
        vi.restoreAllMocks();
      });

      // jsdom has no animate() and computes no color-mix(), so both are stubbed: the painted knots
      // read back as an oklch() color, as a browser serializes a mixed knot. `painted.value` is what
      // every knot reads back as; `knotsReadFrom` lists the elements whose knots were read, in order.
      function stubBrowser() {
        const animate = vi.fn();
        HTMLElement.prototype.animate = animate;
        const painted = { value: 'oklch(0.7 0.2 45)' };
        const knotsReadFrom: Element[] = [];
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
          const style = realGetComputedStyle(element);
          const getPropertyValue = style.getPropertyValue.bind(style);
          style.getPropertyValue = (name: string) => {
            if (!STOPS.includes(name)) return getPropertyValue(name);
            if (!knotsReadFrom.includes(element)) knotsReadFrom.push(element);
            return painted.value;
          };
          return style;
        });
        return { animate, painted, knotsReadFrom };
      }

      it('fades from the knots as painted to the next fill through the fade property', async () => {
        const { animate } = stubBrowser();

        await switchFromOrangeToBlue();

        const { bar, styleEl } = getElements();
        expect(FROM.map((name) => bar.style.getPropertyValue(name))).toEqual(Array(KNOTS).fill('oklch(0.7 0.2 45)'));
        expect(TO.map((name) => bar.style.getPropertyValue(name))).toEqual(Array(KNOTS).fill('#1a73e8'));
        expect(STOPS.map((name) => bar.style.getPropertyValue(name))).toEqual(STOPS.map((_, k) => stopMix(k)));
        expect(styleEl.textContent).toContain(`${FROM[0]}: oklch(0.7 0.2 45) !important;`);
        // The platform bar's first tint fades too (the mock paints every knot the same, so the start
        // is not transparent here); the hidden top bar appears at once. The switch then fades both,
        // the top bar first.
        const platformBar = document.querySelector('#ocb-platform-bar');
        expect(animate.mock.contexts).toEqual([platformBar, bar, platformBar]);
        expect(animate.mock.calls).toEqual(Array(3).fill([{ [FADE]: [0, 1] }, { duration: 300, easing: 'ease' }]));
        // Never declared, or the declaration would beat the animation.
        expect(styleEl.textContent).not.toContain(`${FADE}:`);
        expect(bar.style.getPropertyValue(FADE)).toBe('');
      });

      // Mid-fade the knots read back as wherever the fade has got to; restarting from there would
      // slow the fade down and end it late.
      it('keeps a running fade when the same fill is applied again', async () => {
        const { animate, painted } = stubBrowser();
        await switchFromOrangeToBlue();
        painted.value = 'oklch(0.6 0.2 300)';

        triggerLocationChange('/?project=blue');

        const { bar, styleEl } = getElements();
        expect(animate).toHaveBeenCalledTimes(3);
        expect(FROM.map((name) => bar.style.getPropertyValue(name))).toEqual(Array(KNOTS).fill('oklch(0.7 0.2 45)'));
        expect(styleEl.textContent).toContain(`${FROM[0]}: oklch(0.7 0.2 45) !important;`);
      });

      it('fades the shell platform bar with #ocb-platform-bar', async () => {
        const { animate } = stubBrowser();

        await switchFromOrangeToBlue({ shellBar: true });

        const { bar } = getElements();
        const platformBars = [document.querySelector('#ocb-platform-bar'), shellHosts()[0]];
        expect(animate.mock.contexts).toEqual([...platformBars, bar, ...platformBars]);
      });

      it('fades a shell platform bar from its own knots where #ocb-platform-bar is missing', async () => {
        const { animate, knotsReadFrom } = stubBrowser();

        await switchFromOrangeToBlue({ legacyBar: false, shellBar: true });

        const host = shellHosts()[0];
        const { bar } = getElements();
        expect(animate.mock.contexts).toEqual([host, bar, host]);
        expect(knotsReadFrom.filter((element) => element !== bar)).toEqual([host]);
        expect(host?.shadowRoot?.querySelectorAll('style')[1]?.textContent).toContain(
          `${FROM[0]}: oklch(0.7 0.2 45) !important;`,
        );
      });

      // A bar the console inserts during a fade paints the target at once, so the start is read from
      // the bar on screen: here the shell bar, beside a 0px #ocb-platform-bar.
      it('reads the fade start from the platform bar on screen, not from an empty #ocb-platform-bar', async () => {
        const { knotsReadFrom } = stubBrowser();
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
          return { height: this.matches('one-cloud-bar-widget *') ? 48 : 0 } as DOMRect;
        });

        await switchFromOrangeToBlue({ shellBar: true });

        const { bar } = getElements();
        expect(knotsReadFrom.filter((element) => element !== bar)).toEqual([shellHosts()[0]]);
      });

      it('fades again into the same fill after a page no rule matches', async () => {
        const { animate } = stubBrowser();
        await switchFromOrangeToBlue();

        triggerLocationChange('/?project=elsewhere');
        triggerLocationChange('/?project=blue');

        // The top bar was hidden, so it appears at once; the platform bar fades in again.
        const platformBar = document.querySelector('#ocb-platform-bar');
        expect(animate.mock.contexts.slice(3)).toEqual([platformBar]);
      });
    });
  });
});

// An orange project, then a switch to a blue one on the top bar and the platform bar, over a mock
// console platform bar: #ocb-platform-bar, a shell platform bar, or one of each.
async function switchFromOrangeToBlue({ legacyBar = true, shellBar = false } = {}) {
  document.body.innerHTML = legacyBar ? '<div id="ocb-platform-bar"></div>' : '';
  if (shellBar) renderShellBar();
  const bars = (color: string) => ({
    topBar: { color: { paletteId: null, custom: solid(color) } },
    platformBar: { color: { paletteId: null, custom: solid(color) } },
  });
  await fakeBrowser.storage.local.set(
    tintSettings({
      projectRules: [
        { id: 'o', matchType: 'exact', pattern: 'orange', settings: bars('#ff6d00') },
        { id: 'b', matchType: 'exact', pattern: 'blue', settings: bars('#1a73e8') },
      ],
    }),
  );
  setLocation('/?project=orange');
  runContentScript();
  await flush();
  triggerLocationChange('/?project=blue');
}

describe('gradient fills', () => {
  const SUNSET: StoredFill = {
    type: 'gradient',
    stops: [
      { color: '#ff6d00', position: 0 },
      { color: '#1a73e8', position: 100 },
    ],
  };
  // SUNSET sampled at the 101 knots, one per percent: each channel on the straight sRGB line from
  // #ff6d00 to #1a73e8, rounded (fill-css.test.ts pins the sampling itself).
  const SUNSET_CHANNELS = [
    [0xff, 0x1a],
    [0x6d, 0x73],
    [0x00, 0xe8],
  ] as const;
  const SUNSET_KNOTS = TO.map(
    (_, k) =>
      `#${SUNSET_CHANNELS.map(([a, b]) =>
        Math.round(a + ((b - a) * k) / 100)
          .toString(16)
          .padStart(2, '0'),
      ).join('')}`,
  );
  // Painted at once (jsdom has no animate()), so each knot mixes from its own target.
  const SUNSET_DECLARATIONS = [
    ...TO.map((name, k) => `${name}: ${SUNSET_KNOTS[k]} !important;`),
    ...FROM.map((name, k) => `${name}: ${SUNSET_KNOTS[k]} !important;`),
    ...STOPS.map((name, k) => `${name}: ${stopMix(k)} !important;`),
  ].join(' ');

  async function apply(settings: ProjectSettingsOverrides) {
    await fakeBrowser.storage.local.set(tintSettingsWithRule(settings));
    setTestProjectLocation();
    runContentScript();
    await flush();
    return getElements();
  }

  it('paints a gradient top bar over its first stop', async () => {
    const { bar } = await apply({ topBar: { color: { paletteId: null, custom: SUNSET }, stripes: false } });

    expect(hexOrRgb('#ff6d00')).toContain(bar.style.backgroundColor);
    expect(TO.map((name) => bar.style.getPropertyValue(name))).toEqual(SUNSET_KNOTS);
    expect(stripePair(bar)).toEqual(['transparent', 'transparent']);
    expect(bar.style.backgroundImage).toBe(FILL_IMAGE);
  });

  it('lays the stripes over a gradient top bar', async () => {
    const { bar } = await apply({ topBar: { color: { paletteId: null, custom: SUNSET }, stripes: true } });

    // '#ff6d00' to '#1a73e8' keeps black stripes: its worst black contrast beats its worst white one.
    expect(stripePair(bar)).toEqual(['transparent', 'rgba(0, 0, 0, 0.3)']);
    expect(TO.map((name) => bar.style.getPropertyValue(name))).toEqual(SUNSET_KNOTS);
  });

  it('writes a gradient platform bar with the viewport-anchored image declarations, without stripes', async () => {
    const { styleEl } = await apply({
      palette: { entries: [{ id: 'default', name: 'Sunset', color: SUNSET }] },
      platformBar: { color: { paletteId: 'default' }, stripes: false },
    });

    expect(styleEl.textContent).toContain(
      `#ocb-platform-bar { background-color: #ff6d00 !important; ${SUNSET_DECLARATIONS} ${STRIPE_LIGHT}: transparent !important; ${STRIPE_DARK}: transparent !important; background-image: ${FILL_IMAGE} !important; background-attachment: fixed !important; background-position: 0 0 !important; background-size: auto !important; transition: ${COLOR_TRANSITIONS} !important; }`,
    );
  });

  it('tints the platform bar stripes over a gradient', async () => {
    const { styleEl } = await apply({ platformBar: { color: { paletteId: null, custom: SUNSET }, stripes: true } });

    expect(styleEl.textContent).toContain(
      `${SUNSET_DECLARATIONS} ${STRIPE_LIGHT}: transparent !important; ${STRIPE_DARK}: rgba(0, 0, 0, 0.3) !important;`,
    );
    expect(styleEl.textContent).toContain('background-attachment: fixed !important;');
  });

  // Same grid on both sides is what lets the fade mix knot by knot.
  it('moves the knots to the next rule on a project switch, from a gradient to a solid', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: 'g',
            matchType: 'exact',
            pattern: 'sunset',
            settings: { topBar: { color: { paletteId: null, custom: SUNSET } } },
          },
          {
            id: 's',
            matchType: 'exact',
            pattern: 'navy',
            settings: { topBar: { color: { paletteId: null, custom: solid('#000080') } } },
          },
        ],
      }),
    );
    setLocation('/?project=sunset');
    runContentScript();
    await flush();
    const { bar } = getElements();
    expect(TO.map((name) => bar.style.getPropertyValue(name))).toEqual(SUNSET_KNOTS);

    triggerLocationChange('/?project=navy');

    expect(TO.map((name) => bar.style.getPropertyValue(name))).toEqual(Array(KNOTS).fill('#000080'));
    expect(bar.style.backgroundImage).toBe(FILL_IMAGE);
  });

  it.each([
    { stops: ['#ff6d00', '#1a73e8'], text: '#000000' },
    { stops: ['#ff6d00', '#000080'], text: '#ffffff' },
  ])('picks Auto text $text for the worst stop of $stops', async ({ stops, text }) => {
    const { styleEl } = await apply({
      platformBar: {
        color: {
          paletteId: null,
          custom: { type: 'gradient', stops: stops.map((color, i) => ({ color, position: i * 100 })) },
        },
      },
      platformBarText: { auto: true },
    });

    expect(styleEl.textContent).toContain(`color: ${text} !important;`);
  });

  it('paints the text with its custom color while the entry it references is a gradient', async () => {
    const { styleEl } = await apply({
      palette: { entries: [{ id: 'default', name: 'Sunset', color: SUNSET }] },
      platformBarText: { color: { paletteId: 'default', custom: '#abcdef' }, auto: false },
    });

    expect(styleEl.textContent).toContain('.pcc-platform-bar-button * { color: #abcdef !important;');
  });
});

// Pages in the console's newer shell draw the platform bar in one-cloud-bar-widget, inside an open
// shadow root that the console attaches and fills before it inserts the host (mica-widget's
// container). The bar's text has colors of its own in there, set by the root's first style element.
const SHELL_BAR_CONTENT =
  '<style>.cfc-platform-bar-left * { color: #3c4043; }</style><pcc-platform-bar><cfc-platform-bar><div class="cfc-platform-bar-left"><span>Google Cloud</span></div></cfc-platform-bar></pcc-platform-bar>';

// In a new widget, or beside an earlier host when `slot` is that host's parent.
function renderShellBar(slot?: Element): ShadowRoot {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = SHELL_BAR_CONTENT;
  (
    slot ??
    document.body
      .appendChild(document.createElement('one-cloud-bar-widget'))
      .appendChild(document.createElement('mica-widget'))
      .appendChild(document.createElement('div'))
  ).appendChild(host);
  return root;
}

function shellHosts() {
  return Array.from(document.querySelectorAll('one-cloud-bar-widget mica-widget div > div'));
}

describe("platform bar in the console's newer shell", () => {
  // The style elements the script put into a shell root: those after the console's own.
  const copies = (root: ShadowRoot) =>
    Array.from(root.querySelectorAll('style'))
      .slice(1)
      .map((style) => style.textContent);

  // The document's rules, with the background on the root's host.
  const shellCss = () => getElements().styleEl.textContent?.replace('#ocb-platform-bar {', ':host {') ?? '';

  async function runOnTestProject(settings: ProjectSettingsOverrides = {}) {
    await fakeBrowser.storage.local.set(tintSettingsWithRule(settings));
    setTestProjectLocation();
    runContentScript();
    await flush();
  }

  it('paints a shell bar drawn before the script runs, background on its host and text inside', async () => {
    const root = renderShellBar();
    const elsewhere = document.body.appendChild(document.createElement('div')).attachShadow({ mode: 'open' });

    await runOnTestProject({
      platformBar: { color: { paletteId: null, custom: solid('#000080') } },
      platformBarText: { color: { paletteId: null, custom: '#abcdef' } },
    });

    expect(shellCss()).toContain(':host { background-color: #000080 !important;');
    expect(shellCss()).toContain('.pcc-platform-bar-button * { color: #abcdef !important;');
    expect(copies(root)).toEqual([shellCss()]);
    // Only one-cloud-bar-widget's roots, and the document's rules are unchanged.
    expect(elsewhere.querySelectorAll('style')).toHaveLength(0);
    expect(getElements().styleEl.textContent).toContain('#ocb-platform-bar { background-color: #000080 !important;');
  });

  it('paints every host in every widget', async () => {
    const first = renderShellBar();
    const second = renderShellBar(first.host.parentElement ?? undefined);
    const third = renderShellBar();

    await runOnTestProject();

    expect([first, second, third].map(copies)).toEqual(Array(3).fill([shellCss()]));
  });

  it('paints a shell bar drawn later, and keeps it in step with the document', async () => {
    await runOnTestProject();

    const root = renderShellBar();
    await flush();
    expect(copies(root)).toEqual([shellCss()]);

    // Any insertion on the page runs a pass; one that changes nothing leaves the copy's text node as
    // it is, rather than rewriting the style sheet each time.
    const text = root.querySelectorAll('style')[1]?.firstChild;
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(root.querySelectorAll('style')[1]?.firstChild).toBe(text);

    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBarText: { enabled: false } }));
    await flush();
    expect(shellCss()).toMatch(/^:host \{[^\n]*\}$/);
    expect(copies(root)).toEqual([shellCss()]);

    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBar: { enabled: false } }));
    await flush();
    expect(shellCss()).toMatch(/^\.cfc-platform-bar-left \*/);
    expect(copies(root)).toEqual([shellCss()]);

    triggerLocationChange('/?project=unknown-project');
    expect(copies(root)).toEqual(['']);
  });

  it('adds no style element to a shell bar until a rule paints it', async () => {
    const root = renderShellBar();
    runContentScript();
    await flush();
    expect(copies(root)).toEqual([]);

    await fakeBrowser.storage.local.set(tintSettingsWithRule({}));
    triggerLocationChange('/?project=test-project');
    await flush();
    expect(copies(root)).toEqual([shellCss()]);
  });

  it('puts the style back when the console empties the root in place', async () => {
    const root = renderShellBar();
    await runOnTestProject();

    root.innerHTML = SHELL_BAR_CONTENT;
    await flush();

    expect(copies(root)).toEqual([shellCss()]);
  });

  // Something that removed the style every time it came back would otherwise trade mutations with the
  // script for ever, without the event loop yielding. The remover here gives up after 1000 removals,
  // so a script without the limit fails this test instead of hanging it.
  it('puts the style back at most ten times a second into a root that keeps losing it', async () => {
    let now = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const root = renderShellBar();
    await runOnTestProject();
    let removals = 0;
    const remover = new MutationObserver(() => {
      const copy = root.querySelectorAll('style')[1];
      if (copy && removals < 1000) {
        removals++;
        copy.remove();
      }
    });
    remover.observe(root, { childList: true });

    root.querySelectorAll('style')[1]?.remove();
    await flush();
    remover.disconnect();

    expect(removals).toBe(10);
    expect(copies(root)).toEqual([]);

    // Later passes within the same second leave the root alone; the first one after it restores.
    now += 1000;
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(copies(root)).toEqual([]);
    now += 1;
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(copies(root)).toEqual([shellCss()]);
  });

  it('stops watching for shell bars once the content script is invalidated', async () => {
    await runOnTestProject();
    const before = renderShellBar();
    await flush();
    expect(copies(before)).toEqual([shellCss()]);

    invalidateContentScripts();
    const after = renderShellBar();
    await flush();

    expect(copies(after)).toEqual([]);
  });
});

describe('fill property registrations', () => {
  it('registers the fill properties once, in a style element of their own that survives an unmatched project', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({}));
    setTestProjectLocation();
    runContentScript();
    await flush();
    triggerLocationChange('/?project=unknown-project');

    const styles = Array.from(document.documentElement.children).filter((el) => el.tagName === 'STYLE');
    const registrations = styles.filter((el) => el.textContent?.includes('@property'));
    expect(registrations).toHaveLength(1);
    expect(registrations[0]?.textContent?.match(/@property /g)).toHaveLength(
      [...TO, ...FROM, ...STOPS, STRIPE_LIGHT, STRIPE_DARK, FADE].length,
    );
    for (const name of [...TO, ...FROM, ...STOPS, STRIPE_LIGHT, STRIPE_DARK]) {
      expect(registrations[0]?.textContent).toContain(
        `@property ${name} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
      );
    }
    expect(registrations[0]?.textContent).toContain(
      `@property ${FADE} { syntax: '<number>'; inherits: false; initial-value: 1; }`,
    );
    // The rule element (the first <style>) is the one emptied, not the registrations.
    expect(getElements().styleEl.textContent).toBe('');
  });
});
