import { ValueObject } from './base/value-object';

// Validated hex color: '#rrggbb', case-insensitive on input, normalized to lowercase.
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

// Value object for a color in the settings model. Instances only ever hold a validated,
// lowercase '#rrggbb' value: the private constructor makes fromHex() the single gate for
// untrusted input. CSS generation deliberately lives outside the domain (see
// adapter/in/stripes.ts).
export class Color extends ValueObject<Color> {
  static readonly BLACK = new Color('#000000');
  static readonly WHITE = new Color('#ffffff');

  private constructor(private readonly hex: string) {
    super();
  }

  // Boundary constructor for untrusted input; undefined unless it is a '#rrggbb' hex string.
  static fromHex(hex: string): Color | undefined {
    return HEX_PATTERN.test(hex) ? new Color(hex.toLowerCase()) : undefined;
  }

  toHex(): string {
    return this.hex;
  }

  equals(other: Color): boolean {
    return this.hex === other.hex;
  }

  // Picks black or white, whichever has the higher WCAG contrast ratio against this color.
  contrastingTextColor(): Color {
    // WCAG contrast ratio: (lighter + offset) / (darker + offset); the offset keeps the ratio
    // finite against pure black.
    const contrastOffset = 0.05;
    const candidateLuminance = { white: 1, black: 0 };
    const luminance = this.relativeLuminance();
    const contrastWithWhite = (candidateLuminance.white + contrastOffset) / (luminance + contrastOffset);
    const contrastWithBlack = (luminance + contrastOffset) / (candidateLuminance.black + contrastOffset);
    return contrastWithBlack >= contrastWithWhite ? Color.BLACK : Color.WHITE;
  }

  // WCAG relative luminance (0 = black, 1 = white).
  private relativeLuminance(): number {
    const channelMax = 255;
    // sRGB decoding: channels below the threshold are on the linear segment, the rest on the
    // gamma curve.
    const linear = { threshold: 0.03928, divisor: 12.92 };
    const gamma = { offset: 0.055, scale: 1.055, exponent: 2.4 };
    // Luminance weights of the linearized channels (Rec. 709 primaries).
    const weight = { red: 0.2126, green: 0.7152, blue: 0.0722 };
    // '#rrggbb': two hex digits per channel, starting right after the '#'.
    const hexOffset = { red: 1, green: 3, blue: 5 };

    const channel = (start: number) => Number.parseInt(this.hex.slice(start, start + 2), 16) / channelMax;
    const linearize = (c: number) =>
      c <= linear.threshold ? c / linear.divisor : ((c + gamma.offset) / gamma.scale) ** gamma.exponent;
    return (
      weight.red * linearize(channel(hexOffset.red)) +
      weight.green * linearize(channel(hexOffset.green)) +
      weight.blue * linearize(channel(hexOffset.blue))
    );
  }
}
