import { ValueObject } from './base/value-object';

// Value object for the top bar's height, in CSS pixels. Instances only ever hold a whole number
// of pixels inside the offered range: the private constructor makes fromPixels() the single gate
// for untrusted input, so no reader has to round or clamp before using the value.
export class TopBarHeight extends ValueObject<TopBarHeight> {
  // The range the side panel's number input offers, and the bounds fromPixels() enforces.
  static readonly MIN = new TopBarHeight(1);
  static readonly MAX = new TopBarHeight(40);

  private constructor(private readonly pixels: number) {
    super();
  }

  // Boundary constructor for untrusted input; undefined unless it is a whole number of pixels
  // from MIN to MAX inclusive (so fractions, NaN and Infinity are all refused).
  static fromPixels(value: number): TopBarHeight | undefined {
    return Number.isInteger(value) && value >= TopBarHeight.MIN.pixels && value <= TopBarHeight.MAX.pixels
      ? new TopBarHeight(value)
      : undefined;
  }

  toPixels(): number {
    return this.pixels;
  }

  equals(other: TopBarHeight): boolean {
    return this.pixels === other.pixels;
  }
}
