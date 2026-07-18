import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import contentScript from './entrypoints/content';

interface PaletteEntry {
  id: string;
  name: string;
  color: string;
}

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

function runContentScript() {
  // Our main() never reads its `ctx` argument, so it's safe to invoke without one.
  // content.ts cannot be changed to relax the type for tests, so cast locally here.
  (contentScript.main as () => void)();
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

beforeEach(() => {
  fakeBrowser.reset();
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('content script', () => {
  it('inserts the overlay bar and platform bar style rules with default colors on load', async () => {
    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    expect(bar.style.display).toBe('');
    expect(bar.style.height).toBe('4px');
    expect(bar.style.backgroundImage).toBe('');
    expect(hexOrRgb('#ff6d00')).toContain(bar.style.backgroundColor);
    expect(styleEl.textContent).toContain('#ocb-platform-bar { background-color: #ff6d00 !important; }');
    expect(styleEl.textContent).toContain(
      '.cfc-platform-bar-left *, .cfc-platform-bar-right * { color: #ffffff !important; }',
    );
  });

  it('applies a stored topBarHeight value', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { topBarHeight: 12 } });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('12px');
  });

  it('falls back to the default height for out-of-range or non-numeric values', async () => {
    for (const invalid of [0, 41, Number.NaN, -5]) {
      document.documentElement.innerHTML = '<head></head><body></body>';
      await fakeBrowser.storage.local.set({ tintSettings: { topBarHeight: invalid } });

      runContentScript();
      await flush();

      const { bar } = getElements();
      expect(bar.style.height).toBe('4px');
    }
  });

  it('rounds a fractional topBarHeight to the nearest integer', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { topBarHeight: 7.6 } });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.height).toBe('8px');
  });

  it('applies the Top bar stripe gradient when topBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: { topBarStripes: true, topBarPaletteId: null, topBarColor: '#ffff00' },
    });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.backgroundImage).toContain('repeating-linear-gradient');
    expect(bar.style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('omits the Top bar background image when topBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { topBarStripes: false } });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.backgroundImage).toBe('');
  });

  it('applies the Platform Bar stripe gradient to the CSS rule when platformBarStripes is enabled', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: { platformBarStripes: true, platformBarPaletteId: null, platformBarColor: '#000080' },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('background-image: repeating-linear-gradient');
    expect(styleEl.textContent).toContain('rgba(255, 255, 255, 0.3)');
  });

  it('omits the background-image declaration when platformBarStripes is disabled', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { platformBarStripes: false } });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).not.toContain('background-image');
  });

  it('follows the resolved palette color for stripe tinting on both Top bar and Platform Bar', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        palette: [{ id: 'default', name: 'Primary', color: '#ffff00' }],
        topBarPaletteId: 'default',
        topBarStripes: true,
        platformBarPaletteId: 'default',
        platformBarStripes: true,
      },
    });

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // Bright palette color -> black-tinted stripes on both.
    expect(bar.style.backgroundImage).toContain('rgba(0, 0, 0, 0.3)');
    expect(styleEl.textContent).toContain('rgba(0, 0, 0, 0.3)');
  });

  it('applies settings already stored before load, including palette reference resolution', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        palette: [{ id: 'default', name: 'Primary', color: '#123456' }],
        topBarPaletteId: 'default',
        platformBarColor: '#000000',
        platformBarPaletteId: null,
        platformBarTextColor: '#abcdef',
        platformBarTextPaletteId: null,
      },
    });

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // topBar references the "default" palette entry -> resolves to the palette color.
    expect(hexOrRgb('#123456')).toContain(bar.style.backgroundColor);
    // platformBar has no reference (paletteId: null) -> uses its own raw color.
    expect(styleEl.textContent).toContain('#ocb-platform-bar { background-color: #000000 !important; }');
    expect(styleEl.textContent).toContain('color: #abcdef !important;');
  });

  it('resolves to the palette entry color when paletteId references an existing entry', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        topBarPaletteId: 'default',
        topBarColor: '#999999',
        palette: [{ id: 'default', name: 'Primary', color: '#111111' }],
      },
    });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#111111')).toContain(bar.style.backgroundColor);
  });

  it('falls back to the item own color when paletteId does not match any palette entry', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        topBarPaletteId: 'missing-id',
        topBarColor: '#222222',
        palette: [],
      },
    });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#222222')).toContain(bar.style.backgroundColor);
  });

  it('falls back to the item own color when paletteEnabled is false, even with a valid reference', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        paletteEnabled: false,
        topBarPaletteId: 'default',
        topBarColor: '#333333',
        palette: [{ id: 'default', name: 'Primary', color: '#111111' }],
      },
    });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#333333')).toContain(bar.style.backgroundColor);
  });

  it('hides the overlay bar when topBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { topBarEnabled: false } });

    runContentScript();
    await flush();

    const { bar } = getElements();
    expect(bar.style.display).toBe('none');
  });

  it('omits only the background rule when platformBarEnabled is false', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { platformBarEnabled: false } });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).not.toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('.cfc-platform-bar-left');
  });

  it('omits only the text color rule when platformBarTextEnabled is false', async () => {
    await fakeBrowser.storage.local.set({ tintSettings: { platformBarTextEnabled: false } });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('#ocb-platform-bar');
    expect(styleEl.textContent).not.toContain('.cfc-platform-bar-left');
  });

  it('produces an empty style tag when both platformBarEnabled and platformBarTextEnabled are false', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: { platformBarEnabled: false, platformBarTextEnabled: false },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toBe('');
  });

  it('reapplies settings immediately when storage.onChanged fires', async () => {
    runContentScript();
    await flush();

    await fakeBrowser.storage.local.set({
      tintSettings: {
        palette: [{ id: 'default', name: 'Primary', color: '#ff6d00' }],
        topBarPaletteId: null,
        topBarColor: '#00ff00',
      },
    });
    await flush();

    const { bar } = getElements();
    expect(hexOrRgb('#00ff00')).toContain(bar.style.backgroundColor);
  });

  it('computes an auto text color with sufficient contrast against a dark Platform Bar background', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        platformBarPaletteId: null,
        platformBarColor: '#000080',
        platformBarTextAuto: true,
      },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('computes an auto text color with sufficient contrast against a bright Platform Bar background', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        platformBarPaletteId: null,
        platformBarColor: '#ffff00',
        platformBarTextAuto: true,
      },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #000000 !important;');
  });

  it('auto text color follows the Platform Bar background resolved via a palette reference', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        palette: [{ id: 'default', name: 'Primary', color: '#000080' }],
        platformBarPaletteId: 'default',
        platformBarTextAuto: true,
      },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('auto text color takes priority over a stored platformBarTextColor/paletteId', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        platformBarColor: '#ffff00',
        platformBarTextAuto: true,
        platformBarTextColor: '#ff00ff',
        platformBarTextPaletteId: null,
      },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    expect(styleEl.textContent).toContain('color: #000000 !important;');
    expect(styleEl.textContent).not.toContain('#ff00ff');
  });

  it('computes the auto text color from platformBarColor even when platformBarEnabled is false (documented residual behavior)', async () => {
    await fakeBrowser.storage.local.set({
      tintSettings: {
        platformBarEnabled: false,
        platformBarPaletteId: null,
        platformBarColor: '#000080',
        platformBarTextAuto: true,
      },
    });

    runContentScript();
    await flush();

    const { styleEl } = getElements();
    // The background rule itself is omitted (platformBarEnabled: false), but the auto text
    // color is still computed against what platformBarColor would resolve to.
    expect(styleEl.textContent).not.toContain('#ocb-platform-bar');
    expect(styleEl.textContent).toContain('color: #ffffff !important;');
  });

  it('falls back to a single-entry palette and topBar/platformBar colors from the legacy tintColor string', async () => {
    await fakeBrowser.storage.local.set({ tintColor: '#334455' });

    runContentScript();
    await flush();

    const { bar, styleEl } = getElements();
    // topBar keeps its default paletteId ("default"), which now points to the migrated entry.
    expect(hexOrRgb('#334455')).toContain(bar.style.backgroundColor);
    expect(styleEl.textContent).toContain('#ocb-platform-bar { background-color: #334455 !important; }');
  });
});
