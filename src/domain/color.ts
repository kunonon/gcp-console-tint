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
    const luminance = this.relativeLuminance();
    const contrastWithWhite = 1.05 / (luminance + 0.05);
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    return contrastWithBlack >= contrastWithWhite ? Color.BLACK : Color.WHITE;
  }

  // WCAG relative luminance (0 = black, 1 = white).
  private relativeLuminance(): number {
    const channel = (start: number) => Number.parseInt(this.hex.slice(start, start + 2), 16) / 255;
    const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linearize(channel(1)) + 0.7152 * linearize(channel(3)) + 0.0722 * linearize(channel(5));
  }
}
