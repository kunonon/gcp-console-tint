import { afterEach, describe, expect, it, vi } from 'vitest';
import { readThemeHint, showHintedTheme, showTheme, systemDarkQuery, THEME_HINT_KEY, writeThemeHint } from '../theme';

const isDark = () => document.documentElement.classList.contains('dark');

// jsdom has no matchMedia; this stands in for the system colour scheme.
function stubSystemScheme(dark: boolean) {
  const matchMedia = vi.fn(() => ({ matches: dark }));
  vi.stubGlobal('matchMedia', matchMedia);
  return matchMedia;
}

// A localStorage that refuses every access, as a browser with storage blocked does.
function blockLocalStorage() {
  const denied = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.stubGlobal('localStorage', { getItem: denied, setItem: denied });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('readThemeHint', () => {
  it.each(['light', 'dark', 'auto'] as const)('returns a stored %s hint', (theme) => {
    localStorage.setItem(THEME_HINT_KEY, theme);

    expect(readThemeHint()).toBe(theme);
  });

  it('returns undefined when nothing is stored', () => {
    expect(readThemeHint()).toBeUndefined();
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_HINT_KEY, 'sepia');

    expect(readThemeHint()).toBeUndefined();
  });

  it('reads as no hint when localStorage throws', () => {
    blockLocalStorage();

    expect(readThemeHint()).toBeUndefined();
  });
});

describe('writeThemeHint', () => {
  it.each(['light', 'dark', 'auto'] as const)('stores %s under the hint key', (theme) => {
    writeThemeHint(theme);

    expect(localStorage.getItem(THEME_HINT_KEY)).toBe(theme);
  });

  it('drops the write when localStorage throws', () => {
    blockLocalStorage();

    expect(() => writeThemeHint('dark')).not.toThrow();
  });
});

describe('systemDarkQuery', () => {
  it('asks for the dark colour scheme', () => {
    const matchMedia = stubSystemScheme(true);

    expect(systemDarkQuery()?.matches).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('is undefined without matchMedia', () => {
    expect(systemDarkQuery()).toBeUndefined();
  });
});

describe('showTheme', () => {
  it('adds the dark class for dark and removes it for light', () => {
    showTheme('dark');
    expect(isDark()).toBe(true);

    showTheme('light');
    expect(isDark()).toBe(false);
  });

  it('does not look up the system scheme for an explicit theme', () => {
    const matchMedia = stubSystemScheme(true);

    showTheme('light');

    expect(isDark()).toBe(false);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it.each([true, false])('follows the system scheme for auto (system dark: %s)', (systemDark) => {
    document.documentElement.classList.toggle('dark', !systemDark);
    stubSystemScheme(systemDark);

    showTheme('auto');

    expect(isDark()).toBe(systemDark);
  });

  it('uses the query it is given for auto instead of looking one up', () => {
    const matchMedia = stubSystemScheme(false);

    showTheme('auto', { matches: true } as MediaQueryList);

    expect(isDark()).toBe(true);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('falls back to light for auto when matchMedia is unavailable', () => {
    document.documentElement.classList.add('dark');

    showTheme('auto');

    expect(isDark()).toBe(false);
  });
});

describe('showHintedTheme', () => {
  it.each([
    { hint: 'dark', systemDark: false, dark: true, when: 'a dark hint on a light system' },
    { hint: 'light', systemDark: true, dark: false, when: 'a light hint on a dark system' },
    { hint: null, systemDark: true, dark: true, when: 'no hint on a dark system' },
    { hint: null, systemDark: false, dark: false, when: 'no hint on a light system' },
    { hint: 'auto', systemDark: true, dark: true, when: 'an auto hint on a dark system' },
    { hint: 'auto', systemDark: false, dark: false, when: 'an auto hint on a light system' },
    { hint: 'sepia', systemDark: true, dark: true, when: 'an unusable hint on a dark system' },
  ])('shows dark: $dark for $when', ({ hint, systemDark, dark }) => {
    // Start from the opposite state, so the expected one has to be applied rather than left over.
    document.documentElement.classList.toggle('dark', !dark);
    if (hint !== null) localStorage.setItem(THEME_HINT_KEY, hint);
    stubSystemScheme(systemDark);

    showHintedTheme();

    expect(isDark()).toBe(dark);
  });

  it('follows the system scheme when localStorage throws', () => {
    blockLocalStorage();
    stubSystemScheme(true);

    showHintedTheme();

    expect(isDark()).toBe(true);
  });
});
