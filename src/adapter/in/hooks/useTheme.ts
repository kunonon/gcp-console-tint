import { useLayoutEffect } from 'react';
import type { Theme } from '../../../domain/tint-settings';

// Applies the side panel's theme by toggling the `dark` class on <html>. HeroUI v3 switches its
// theme tokens only through `.dark` or `[data-theme="dark"]` on an ancestor (see
// @heroui/styles/dist/themes/default/variables.css); it has no prefers-color-scheme fallback for
// the tokens, so 'auto' has to follow the system scheme here, and keep following it while the
// panel is open. Without matchMedia (e.g. jsdom) 'auto' falls back to light.
// A layout effect, so the class is in place before the first paint: on a dark system the panel
// never flashes light while settings load. (A stored explicit theme is only known once the
// storage read resolves, so it can still differ from that first paint.)
// Colour changes are animated by CSS (style.css, `html.theme-transitions`). That class is added
// only when the caller says the stored theme is in place (`animate`), so the first application —
// the default theme at mount, then the stored theme once storage has been read — never fades;
// later changes (the user's pick, or the system scheme changing under 'auto') do.
export function useTheme(theme: Theme, animate: boolean): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const setDark = (dark: boolean) => root.classList.toggle('dark', dark);
    if (theme !== 'auto') {
      setDark(theme === 'dark');
      return;
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) {
      setDark(false);
      return;
    }
    const apply = () => setDark(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  // Declared after the effect above on purpose: in the commit that turns `animate` on, the theme
  // has already been applied by the time this runs.
  useLayoutEffect(() => {
    if (!animate) return;
    const root = document.documentElement;
    // Force a style flush, so the theme applied in this same commit becomes the transition's
    // starting style instead of a change to animate.
    void getComputedStyle(root).getPropertyValue('--background');
    root.classList.add('theme-transitions');
    return () => root.classList.remove('theme-transitions');
  }, [animate]);
}
