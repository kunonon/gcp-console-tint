import { type HexColor, HexColorSchema } from './types';

// Value object for a color in the settings model. Instances only ever hold a validated,
// lowercase '#rrggbb' value: fromHex() trusts the HexColorSchema brand and parse() is the
// gate for untrusted input. CSS generation deliberately lives outside the domain (see
// adapter/in/stripes.ts).
export class Color {
  static readonly BLACK = new Color(HexColorSchema.parse('#000000'));
  static readonly WHITE = new Color(HexColorSchema.parse('#ffffff'));

  private constructor(private readonly hex: HexColor) {}

  // Total constructor for schema-validated values (the settings model only carries HexColor).
  static fromHex(hex: HexColor): Color {
    return new Color(hex);
  }

  // Boundary constructor for untrusted input; null when the value is not '#rrggbb'.
  static parse(value: string): Color | null {
    const result = HexColorSchema.safeParse(value);
    return result.success ? new Color(result.data) : null;
  }

  toHex(): HexColor {
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
