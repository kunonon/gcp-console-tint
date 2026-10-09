import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '../../../../domain/tint-settings';
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('leaves colour transitions off while animate is false', () => {
    const { rerender } = renderHook(({ theme }: { theme: Theme }) => useTheme(theme, false), {
      initialProps: { theme: 'light' },
    });
    expect(animates()).toBe(false);

    rerender({ theme: 'dark' });
    expect(isDark()).toBe(true);
    expect(animates()).toBe(false);
  });

  it('turns colour transitions on with animate and off again on unmount', () => {
    const { rerender, unmount } = renderHook(({ animate }: { animate: boolean }) => useTheme('light', animate), {
      initialProps: { animate: false },
    });
    expect(animates()).toBe(false);

    rerender({ animate: true });
    expect(animates()).toBe(true);
    rerender({ animate: false });
    expect(animates()).toBe(false);

    rerender({ animate: true });
    unmount();
    expect(animates()).toBe(false);
  });

  it('applies the theme and flushes styles before turning colour transitions on', () => {
    // The stored theme and `animate` arrive in one commit. If the transition class were added
    // before the style flush, that first application would fade from the default theme.
    const root = document.documentElement;
    const atFlush: string[] = [];
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === root) atFlush.push(root.className);
      return realGetComputedStyle(element, pseudo);
    });
    const { rerender } = renderHook(
      ({ theme, animate }: { theme: Theme; animate: boolean }) => useTheme(theme, animate),
      { initialProps: { theme: 'light', animate: false } },
    );
    expect(atFlush).toEqual([]);

    rerender({ theme: 'dark', animate: true });

    // Exactly one flush, with the new theme applied and the transition class not yet there.
    expect(atFlush).toEqual(['dark']);
    expect(animates()).toBe(true);
  });
});
