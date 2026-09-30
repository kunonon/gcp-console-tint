import { Color } from '../../domain/color';

// Diagonal stripe overlay for tinted surfaces. The stripe tint reuses the domain's
// black-or-white contrast pick so stripes stay visible on any surface color; how they are
// drawn (angle, width, alpha, CSS syntax) is presentation detail and lives here on purpose.
export function stripeGradient(bg: Color): string {
  // Keep bright and dark stripes in the same gradient phase across background colors.
  const blackStripe = bg.contrastingTextColor().equals(Color.BLACK);
  const light = blackStripe ? 'transparent' : 'rgba(255, 255, 255, 0.3)';
  const dark = blackStripe ? 'rgba(0, 0, 0, 0.3)' : 'transparent';
  return `repeating-linear-gradient(-45deg, ${light} 0 8px, ${dark} 8px 16px)`;
}
