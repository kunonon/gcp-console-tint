import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import contentScript from './entrypoints/content';

interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

interface ProjectSettings {
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

type MatchType = 'prefix' | 'suffix' | 'exact' | 'regex';

interface ProjectRule {
  id: string;
  matchType: MatchType;
  pattern: string;
  settings: ProjectSettings;
}

interface TintSettings {
  schemaVersion: string;
  projectRules: ProjectRule[];
}

const CURRENT_VERSION = '0.1.0';

// Our main() reads `ctx.addEventListener` to subscribe to WXT's `wxt:locationchange` event.
// The real ContentScriptContext is only constructed by WXT's entrypoint wrapper (not present
// when importing content.ts directly in tests), so we provide a minimal fake here: it simply
// forwards to the target's native addEventListener, which is all our code relies on.
function createFakeCtx() {
  return {
    addEventListener(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject) {
      target.addEventListener(type, listener as EventListener);
    },
  };
}

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

// Defaults schemaVersion to a valid/current value so existing tests that seed storage
// without thinking about schemaVersion keep exercising the "data accepted" path rather
// than accidentally being discarded by loadSettings(). Pass schemaVersion explicitly to
// override for tests that specifically probe the discard/keep boundary.
function tintSettings(partial: {
  schemaVersion?: string;
  projectRules?: { id?: string; matchType: MatchType; pattern: string; settings?: Partial<ProjectSettings> }[];
}) {
  return { tintSettings: { schemaVersion: CURRENT_VERSION, ...partial } as unknown as TintSettings };
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
  settings: Partial<ProjectSettings>,
  pattern: string = TEST_PROJECT_PATTERN,
  matchType: MatchType = 'regex',
) {
  return tintSettings({ projectRules: [{ id: 'r', matchType, pattern, settings }] });
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
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarHeight: 12 }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('12px');
  });

  it('falls back to the default height for out-of-range or non-numeric values', async () => {
    for (const invalid of [0, 41, Number.NaN, -5]) {
      document.documentElement.innerHTML = '<head></head><body></body>';
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarHeight: invalid }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { bar } = getElements();
      expect(bar.style.height).toBe('4px');
    }
  });

  it('rounds a fractional topBarHeight to the nearest integer', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarHeight: 7.6 }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('8px');
  });

  it('applies the Top bar stripe gradient when topBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ topBarStripes: true, topBarPaletteId: null, topBarColor: '#ffff00' }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(bar.style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('omits the Top bar background image when topBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarStripes: false }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.backgroundImage).toBe('');
  });

  it('applies the Platform Bar stripe gradient to the CSS rule when platformBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ platformBarStripes: true, platformBarPaletteId: null, platformBarColor: '#000080' }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('background-image: repeating-linear-gradient');
    expect(styleEl.textContent).toContain('rgba(255, 255, 255, 0.3)');
  });

  it('omits the background-image declaration when platformBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBarStripes: false }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).not.toContain('background-image');
  });

  it('follows the resolved palette color for stripe tinting on both Top bar and Platform Bar', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: [{ id: 'default', name: 'Primary', color: '#ffff00' }],
        topBarPaletteId: 'default',
        topBarStripes: true,
        platformBarPaletteId: 'default',
        platformBarStripes: true,
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // Bright palette color -> black-tinted stripes on both.
    expect(bar.style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)');
    expect(styleEl.textContent).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('applies settings already stored before load, including palette reference resolution', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({
        palette: [{ id: 'default', name: 'Primary', color: '#123456' }],
        topBarPaletteId: 'default',
        platformBarColor: '#000000',
        platformBarPaletteId: null,
        platformBarTextColor: '#abcdef',
        platformBarTextPaletteId: null,
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
        palette: [{ id: 'default', name: 'Primary', color: '#111111' }],
        topBarPaletteId: 'default',
        topBarColor: '#999999',
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
      tintSettingsWithRule({ palette: [], topBarPaletteId: 'missing-id', topBarColor: '#222222' }),
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
        paletteEnabled: false,
        palette: [{ id: 'default', name: 'Primary', color: '#111111' }],
        topBarPaletteId: 'default',
        topBarColor: '#333333',
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#333333')).toContain(bar.style.backgroundColor);
  });

  it('hides the overlay bar when topBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarEnabled: false }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.display).toBe('none');
  });

  it('omits only the background rule when platformBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBarEnabled: false }));
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).not.toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('.cfc-platform-bar-left');
    expect(styleEl.textContent).toContain('.pcc-platform-bar-button');
  });

  it('omits only the text color rule when platformBarTextEnabled is false', async () => {
    await fakeBrowser.storage.local.set(tintSettingsWithRule({ platformBarTextEnabled: false }));
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
      tintSettingsWithRule({ platformBarEnabled: false, platformBarTextEnabled: false }),
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
        palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
        topBarPaletteId: null,
        topBarColor: '#00ff00',
      }),
    );
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#00ff00')).toContain(bar.style.backgroundColor);
  });

  it('computes an auto text color with sufficient contrast against a dark Platform Bar background', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ platformBarPaletteId: null, platformBarColor: '#000080', platformBarTextAuto: true }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('computes an auto text color with sufficient contrast against a bright Platform Bar background', async () => {
    await fakeBrowser.storage.local.set(
      tintSettingsWithRule({ platformBarPaletteId: null, platformBarColor: '#ffff00', platformBarTextAuto: true }),
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
        palette: [{ id: 'default', name: 'Primary', color: '#000080' }],
        platformBarPaletteId: 'default',
        platformBarTextAuto: true,
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
        platformBarColor: '#ffff00',
        platformBarTextAuto: true,
        platformBarTextColor: '#ff00ff',
        platformBarTextPaletteId: null,
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
        platformBarEnabled: false,
        platformBarPaletteId: null,
        platformBarColor: '#000080',
        platformBarTextAuto: true,
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

  it('discards stored data with no schemaVersion (old flat v1 shape); nothing is applied even where a rule would have matched', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: TEST_PROJECT_PATTERN,
            settings: { topBarPaletteId: null, topBarColor: '#334455' },
          },
        ],
      },
    });
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // No schemaVersion -> the whole payload (including projectRules) is discarded, so there's
    // no rule left to match against -> nothing is applied, not the stored #334455.
    expect(bar.style.display).toBe('none');
    expect(styleEl.textContent).toBe('');
  });

  it('applies stored data whose schemaVersion equals SCHEMA_MIN_VERSION', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        schemaVersion: '0.1.0',
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: TEST_PROJECT_PATTERN,
            settings: { topBarPaletteId: null, topBarColor: '#334455' },
          },
        ],
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#334455')).toContain(bar.style.backgroundColor);
  });

  it('applies stored data whose schemaVersion is newer than the current version as-is', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        schemaVersion: '9.9.9',
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: TEST_PROJECT_PATTERN,
            settings: { topBarPaletteId: null, topBarColor: '#334455' },
          },
        ],
      }),
    );
    setTestProjectLocation();

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#334455')).toContain(bar.style.backgroundColor);
  });

  it('discards stored data whose schemaVersion is missing, non-string, or below SCHEMA_MIN_VERSION; nothing is applied', async () => {
    const rule = {
      id: '1',
      matchType: 'regex' as const,
      pattern: TEST_PROJECT_PATTERN,
      settings: { topBarPaletteId: null, topBarColor: '#334455' },
    };
    const invalidCases = [
      { schemaVersion: '0.0.9', projectRules: [rule] },
      { schemaVersion: 123, projectRules: [rule] },
      { projectRules: [rule] },
    ];

    for (const invalid of invalidCases) {
      document.documentElement.innerHTML = '<head></head><body></body>';
      await fakeBrowser.storage.local.set({ tintSettings: invalid });
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { bar, styleEl } = getElements();
      expect(bar.style.display).toBe('none');
      expect(styleEl.textContent).toBe('');
    }
  });

  it('applies project-specific settings when the URL "project" param matches a rule pattern', async () => {
    await fakeBrowser.storage.local.set(
      tintSettings({
        projectRules: [
          {
            id: '1',
            matchType: 'regex',
            pattern: 'my-project',
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
          },
          {
            id: '2',
            matchType: 'regex',
            pattern: 'project',
            settings: { topBarPaletteId: null, topBarColor: '#333333' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
              palette: [{ id: 'p', name: 'A Palette', color: '#aaaaaa' }],
              topBarPaletteId: 'p',
              topBarColor: '#cccccc',
            },
          },
          {
            id: 'rule-b',
            matchType: 'regex',
            pattern: '^project-b$',
            settings: {
              palette: [{ id: 'p', name: 'B Palette', color: '#bbbbbb' }],
              topBarPaletteId: 'p',
              topBarColor: '#dddddd',
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
            settings: { topBarPaletteId: null, topBarColor: '#654321' },
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
            settings: { topBarPaletteId: null, topBarColor: '#654321' },
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

  it('applies topBarHeight at the clamp boundaries (1 and 40) without adjustment', async () => {
    for (const boundary of [1, 40]) {
      document.documentElement.innerHTML = '<head></head><body></body>';
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarHeight: boundary }));
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
            settings: { topBarPaletteId: null, topBarColor: '#222222' },
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
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      // A change in `sync` storage must not trigger a re-apply of `local`'s tintSettings.
      await fakeBrowser.storage.sync.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#999999' }));
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });

    it('ignores changes to unrelated keys in local storage', async () => {
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      await fakeBrowser.storage.local.set({ someUnrelatedKey: 'value' });
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });

    it('does not reapply (keeps the last applied state) when the tintSettings key is removed from storage', async () => {
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);

      // On removal, changes.tintSettings.newValue is undefined; content.ts's `if (newValue)`
      // guard skips re-applying, so the bar keeps showing the last applied color rather than
      // resetting to "nothing".
      await fakeBrowser.storage.local.remove('tintSettings');
      await flush();

      expect(hexOrRgb('#111111')).toContain(getElements().bar.style.backgroundColor);
    });
  });

  describe('project-switch transitions', () => {
    it('does not throw and treats motion as enabled when window.matchMedia is undefined (plain jsdom)', async () => {
      expect(window.matchMedia).toBeUndefined();

      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      expect(() => runContentScript()).not.toThrow();
      await flush();

      const { bar, styleEl } = getElements();
      expect(bar.style.transition).not.toBe('');
      expect(styleEl.textContent).toContain('transition:');
    });

    it('applies background-color/height transitions to the bar element when motion is not reduced', async () => {
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { bar } = getElements();
      expect(bar.style.transition).toContain('background-color');
      expect(bar.style.transition).toContain('height');
    });

    it('adds transition declarations to the generated Platform Bar and text CSS rules', async () => {
      await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
      setTestProjectLocation();

      runContentScript();
      await flush();

      const { styleEl } = getElements();
      expect(styleEl.textContent).toContain('transition: background-color 300ms ease !important');
      expect(styleEl.textContent).toContain('transition: color 300ms ease !important');
    });

    describe('when the user prefers reduced motion', () => {
      afterEach(() => {
        vi.unstubAllGlobals();
      });

      it('omits all transition declarations from both the bar element and the generated CSS rules', async () => {
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

        await fakeBrowser.storage.local.set(tintSettingsWithRule({ topBarPaletteId: null, topBarColor: '#111111' }));
        setTestProjectLocation();

        runContentScript();
        await flush();

        const { bar, styleEl } = getElements();
        expect(bar.style.transition).toBe('');
        expect(styleEl.textContent).not.toContain('transition');
      });
    });
  });
});
