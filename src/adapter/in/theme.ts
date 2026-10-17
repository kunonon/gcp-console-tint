import type { Theme } from '../../domain/tint-settings';

// How the side panel shows a theme, shared by the pre-paint script (entrypoints/theme-init.ts) and
// useTheme so the two can never resolve a theme differently. That script blocks the first paint,
// so this module imports nothing at runtime: the domain module alone would add about 6 kB to it.

// The stored theme lives in browser.storage.local, which can only be read asynchronously — too
// late for the first paint. This localStorage entry, on the extension's own origin, repeats the
// theme the panel last applied so the next open can paint with it at once. It is a hint only:
// browser.storage.local stays the source of truth, and useTheme rewrites the hint whenever the
// loaded settings disagree with it. It is deliberately not kept by the settings store, which the
// content script (whose localStorage is the console page's) and the background script (which has
// none) also use.
export const THEME_HINT_KEY = 'theme';

// localStorage can throw on access (Firefox with storage blocked, for one). The hint is optional,
// so a failure reads as "no hint" and a failed write is dropped.
export function readThemeHint(): Theme | undefined {
  try {
    const hint = localStorage.getItem(THEME_HINT_KEY);
    return hint === 'light' || hint === 'dark' || hint === 'auto' ? hint : undefined;
  } catch {
    return undefined;
  }
}

export function writeThemeHint(theme: Theme): void {
  try {
    localStorage.setItem(THEME_HINT_KEY, theme);
  } catch {
    // Without the hint the next open falls back to the system scheme until settings load.
  }
}

// The system scheme, for 'auto'. Undefined where matchMedia is missing (jsdom).
export function systemDarkQuery(): MediaQueryList | undefined {
  return window.matchMedia?.('(prefers-color-scheme: dark)');
}

// HeroUI v3 switches its theme tokens only through `.dark` or `[data-theme="dark"]` on an ancestor
// (see @heroui/styles/dist/themes/default/variables.css); it has no prefers-color-scheme fallback
// for the tokens, so 'auto' is resolved here. Without matchMedia 'auto' falls back to light.
// `systemDark` lets a caller that is already listening to the query pass it in; the system scheme
// is only looked up for 'auto'.
export function showTheme(theme: Theme, systemDark?: MediaQueryList): void {
  const dark = theme === 'dark' || (theme === 'auto' && Boolean((systemDark ?? systemDarkQuery())?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

// What is known before settings load: the hinted theme, or the default, which follows the system.
export function showHintedTheme(): void {
  showTheme(readThemeHint() ?? 'auto');
}
