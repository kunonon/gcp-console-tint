import { Color } from '../../domain/color';
import type { Fill } from '../../domain/gradient';

// Diagonal stripe overlay for tinted surfaces. The stripe tint reuses the domain's
// black-or-white contrast pick so stripes stay visible on any surface color or gradient; how they are
// drawn (angle, width, alpha, CSS syntax) is presentation detail and lives here on purpose.

// The two stripe colors, which the content script hands to registered custom properties so they
// fade between projects.
export function stripeColors(bg: Fill): { light: string; dark: string } {
  // Keep bright and dark stripes in the same gradient phase across background colors.
  const blackStripe = bg.contrastingTextColor().equals(Color.BLACK);
  return {
    light: blackStripe ? 'transparent' : 'rgba(255, 255, 255, 0.3)',
    dark: blackStripe ? 'rgba(0, 0, 0, 0.3)' : 'transparent',
  };
}

// The stripe geometry, for literal colors or var() references alike.
export function stripeLayer(light: string, dark: string): string {
  return `repeating-linear-gradient(-45deg, ${light} 0 8px, ${dark} 8px 16px)`;
}
