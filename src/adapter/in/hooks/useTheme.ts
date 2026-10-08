import { useLayoutEffect } from 'react';
import type { Theme } from '../../../domain/tint-settings';
import { readThemeHint, showTheme, systemDarkQuery, writeThemeHint } from '../theme';

// Applies the side panel's theme to <html> (showTheme in ../theme.ts) and keeps following the
// system scheme while 'auto' is shown.
// `stored` says `theme` is the one read from storage. Until then `theme` is only the default, so
// the theme hinted by the last open is shown instead (the passed theme when there is no hint).
// That is what the pre-paint script (entrypoints/theme-init.ts) already put on <html> before the
// first paint, so mounting changes nothing and the panel does not flash light on its way to a
// stored dark theme.
// If settings fail to load, `stored` never turns true: the panel stays on the hinted theme and
// the hint is left as it is.
// Once `stored`, the stored theme is applied and written back as the hint for the next open,
// which also corrects a hint that no longer matches what is stored.
// Colour changes are animated by CSS (style.css, `html.theme-transitions`). That class is added
// only once `stored`, so neither the pre-paint application nor the correction of a stale hint
// fades; later changes (the user's pick, or the system scheme changing under 'auto') do.
export function useTheme(theme: Theme, stored: boolean): void {
  useLayoutEffect(() => {
    const shown = stored ? theme : (readThemeHint() ?? theme);
    if (stored) writeThemeHint(theme);
    if (shown !== 'auto') {
      showTheme(shown);
      return;
    }
    const media = systemDarkQuery();
    const apply = () => showTheme('auto', media);
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme, stored]);

  // Declared after the effect above on purpose: in the commit that turns `stored` on, the stored
  // theme has already been applied by the time this runs.
  useLayoutEffect(() => {
    if (!stored) return;
    const root = document.documentElement;
    // Force a style flush, so the theme applied in this same commit becomes the transition's
    // starting style instead of a change to animate.
    void getComputedStyle(root).getPropertyValue('--background');
    root.classList.add('theme-transitions');
    return () => root.classList.remove('theme-transitions');
  }, [stored]);
}
