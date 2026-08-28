import { Color } from '../../domain/color';

// Diagonal stripe overlay for tinted surfaces. The stripe tint reuses the domain's
// black-or-white contrast pick so stripes stay visible on any surface color; how they are
// drawn (angle, width, alpha, CSS syntax) is presentation detail and lives here on purpose.
export function stripeGradient(bg: Color): string {
  const stripe = bg.contrastingTextColor().equals(Color.BLACK) ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.3)';
  return `repeating-linear-gradient(-45deg, ${stripe} 0 8px, transparent 8px 16px)`;
}
