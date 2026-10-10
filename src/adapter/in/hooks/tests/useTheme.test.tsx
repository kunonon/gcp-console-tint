import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '../../../../domain/tint-settings';
import { THEME_HINT_KEY } from '../../theme';
import { useTheme } from '../useTheme';

// A controllable stand-in for window.matchMedia (jsdom has none): `matches` can be flipped and a
// 'change' dispatched, and the registered listeners stay inspectable.
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    change(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

const isDark = () => document.documentElement.classList.contains('dark');
const animates = () => document.documentElement.classList.contains('theme-transitions');
const hint = () => localStorage.getItem(THEME_HINT_KEY);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // The hint outlives each render, like the classes on <html>.
  localStorage.clear();
  document.documentElement.classList.remove('dark', 'theme-transitions');
});

describe('useTheme', () => {
  it('adds the dark class for dark and removes it for light', () => {
    const { rerender } = renderHook(({ theme }: { theme: Theme }) => useTheme(theme, false), {
      initialProps: { theme: 'dark' },
    });
    expect(isDark()).toBe(true);

    rerender({ theme: 'light' });
    expect(isDark()).toBe(false);
  });

  it('follows the system scheme for auto', () => {
    const system = stubMatchMedia(true);
    renderHook(() => useTheme('auto', false));

    expect(system.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(isDark()).toBe(true);
  });

  it('stays light for auto when the system scheme is light', () => {
    document.documentElement.classList.add('dark');
    stubMatchMedia(false);
    renderHook(() => useTheme('auto', false));

    expect(isDark()).toBe(false);
  });

  it('re-applies on a system scheme change while auto is selected', () => {
    const system = stubMatchMedia(false);
    renderHook(() => useTheme('auto', false));

    system.change(true);
    expect(isDark()).toBe(true);
    system.change(false);
    expect(isDark()).toBe(false);
  });

  it('stops listening once auto is left or the hook unmounts', () => {
    const system = stubMatchMedia(false);
    const { rerender, unmount } = renderHook(({ theme }: { theme: Theme }) => useTheme(theme, false), {
      initialProps: { theme: 'auto' },
    });
    expect(system.listeners.size).toBe(1);

    rerender({ theme: 'light' });
    expect(system.listeners.size).toBe(0);
    // A system change after leaving auto no longer touches the explicit choice.
    system.change(true);
    expect(isDark()).toBe(false);

    rerender({ theme: 'auto' });
    expect(system.listeners.size).toBe(1);
    unmount();
    expect(system.listeners.size).toBe(0);
  });

  it('falls back to light for auto when matchMedia is unavailable', () => {
    document.documentElement.classList.add('dark');
    vi.stubGlobal('matchMedia', undefined);
    renderHook(() => useTheme('auto', false));

    expect(isDark()).toBe(false);
  });

  it('leaves colour transitions off until the theme is the stored one', () => {
    const { rerender } = renderHook(({ theme }: { theme: Theme }) => useTheme(theme, false), {
      initialProps: { theme: 'light' },
    });
    expect(animates()).toBe(false);

    rerender({ theme: 'dark' });
    expect(isDark()).toBe(true);
    expect(animates()).toBe(false);
  });

  it('turns colour transitions on once the theme is the stored one and off again on unmount', () => {
    const { rerender, unmount } = renderHook(({ stored }: { stored: boolean }) => useTheme('light', stored), {
      initialProps: { stored: false },
    });
    expect(animates()).toBe(false);

    rerender({ stored: true });
    expect(animates()).toBe(true);
    rerender({ stored: false });
    expect(animates()).toBe(false);

    rerender({ stored: true });
    unmount();
    expect(animates()).toBe(false);
  });

  it('applies the theme and flushes styles before turning colour transitions on', () => {
    // The stored theme and `stored` arrive in one commit. If the transition class were added
    // before the style flush, that first application would fade from the default theme.
    const root = document.documentElement;
    const atFlush: string[] = [];
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === root) atFlush.push(root.className);
      return realGetComputedStyle(element, pseudo);
    });
    const { rerender } = renderHook(({ theme, stored }: { theme: Theme; stored: boolean }) => useTheme(theme, stored), {
      initialProps: { theme: 'light', stored: false },
    });
    expect(atFlush).toEqual([]);

    rerender({ theme: 'dark', stored: true });

    // Exactly one flush, with the new theme applied and the transition class not yet there.
    expect(atFlush).toEqual(['dark']);
    expect(animates()).toBe(true);
  });

  // The hint is what the pre-paint script (entrypoints/theme-init.ts) reads on the next open.
  describe('theme hint', () => {
    it('shows the hinted theme instead of the default until the stored theme is known', () => {
      // What the pre-paint script painted: mounting with the default theme must not undo it.
      localStorage.setItem(THEME_HINT_KEY, 'dark');
      document.documentElement.classList.add('dark');
      const system = stubMatchMedia(false);

      renderHook(() => useTheme('auto', false));

      expect(isDark()).toBe(true);
      // A hinted explicit theme does not follow the system scheme.
      expect(system.listeners.size).toBe(0);
    });

    it('keeps following the system scheme under a hinted auto theme', () => {
      localStorage.setItem(THEME_HINT_KEY, 'auto');
      const system = stubMatchMedia(true);

      renderHook(() => useTheme('light', false));

      expect(isDark()).toBe(true);
      system.change(false);
      expect(isDark()).toBe(false);
    });

    it('does not write the hint until the theme is the stored one', () => {
      renderHook(() => useTheme('dark', false));

      expect(isDark()).toBe(true);
      expect(hint()).toBeNull();
    });

    it('leaves an existing hint alone until the theme is the stored one', () => {
      localStorage.setItem(THEME_HINT_KEY, 'dark');

      renderHook(() => useTheme('auto', false));

      expect(hint()).toBe('dark');
    });

    it('writes the stored theme as the hint, and each later change', () => {
      const { rerender } = renderHook(({ theme }: { theme: Theme }) => useTheme(theme, true), {
        initialProps: { theme: 'dark' },
      });
      expect(hint()).toBe('dark');

      rerender({ theme: 'light' });
      expect(hint()).toBe('light');
      rerender({ theme: 'auto' });
      expect(hint()).toBe('auto');
    });

    it.each([
      { stale: 'dark', stored: 'light', systemDark: false, dark: false, atFlush: '' },
      { stale: 'light', stored: 'dark', systemDark: true, dark: true, atFlush: 'dark' },
      { stale: 'dark', stored: 'auto', systemDark: false, dark: false, atFlush: '' },
    ] as const)(
      'corrects a stale $stale hint to the stored $stored theme without fading',
      ({ stale, stored, systemDark, dark, atFlush }) => {
        localStorage.setItem(THEME_HINT_KEY, stale);
        stubMatchMedia(systemDark);
        const root = document.documentElement;
        const classesAtFlush: string[] = [];
        const realGetComputedStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
          if (element === root) classesAtFlush.push(root.className);
          return realGetComputedStyle(element, pseudo);
        });
        const { rerender } = renderHook(
          ({ theme, isStored }: { theme: Theme; isStored: boolean }) => useTheme(theme, isStored),
          { initialProps: { theme: 'auto', isStored: false } },
        );
        expect(isDark()).toBe(stale === 'dark');

        rerender({ theme: stored, isStored: true });

        // The stored theme replaced the hinted one before the flush, and the transition class came
        // only after it: the correction is the transition's starting style, not a change to fade.
        expect(classesAtFlush).toEqual([atFlush]);
        expect(isDark()).toBe(dark);
        expect(animates()).toBe(true);
        expect(hint()).toBe(stored);
      },
    );

    it('still applies the theme when localStorage throws', () => {
      const denied = () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
      vi.stubGlobal('localStorage', { getItem: denied, setItem: denied });
      const { rerender } = renderHook(
        ({ theme, stored }: { theme: Theme; stored: boolean }) => useTheme(theme, stored),
        { initialProps: { theme: 'dark', stored: false } },
      );
      expect(isDark()).toBe(true);

      rerender({ theme: 'light', stored: true });
      expect(isDark()).toBe(false);
      expect(animates()).toBe(true);
    });
  });
});
