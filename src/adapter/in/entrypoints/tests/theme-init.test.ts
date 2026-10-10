import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_HINT_KEY } from '../../theme';
import themeInit from '../theme-init';

const isDark = () => document.documentElement.classList.contains('dark');

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('theme-init entrypoint', () => {
  it('shows a hinted dark theme on a light system before returning', () => {
    localStorage.setItem(THEME_HINT_KEY, 'dark');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );

    // Nothing is returned to wait on: the class is in place when the script has run.
    expect(themeInit.main()).toBeUndefined();
    expect(isDark()).toBe(true);
  });

  it('follows the system scheme when there is no hint', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    themeInit.main();

    expect(isDark()).toBe(true);
  });
});

// A static guard for how the side panel loads the script: it only runs before the first paint as
// a classic script in <head>. As a module, or with async or defer, it would run after parsing like
// the React bundle does. The path resolves from the repository root, which is the working
// directory under Vitest. (That the built page still has it, and where, is checked in E2E.)
describe('sidepanel/index.html', () => {
  it('loads /theme-init.js from <head> as a classic blocking script', () => {
    const html = readFileSync(resolve(process.cwd(), 'src/adapter/in/entrypoints/sidepanel/index.html'), 'utf8');
    const page = new DOMParser().parseFromString(html, 'text/html');

    // WXT names an unlisted script's output after its entrypoint file: theme-init.ts.
    const scripts = page.head.querySelectorAll('script[src="/theme-init.js"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttributeNames().sort()).toEqual(['src', 'vite-ignore']);
  });
});
