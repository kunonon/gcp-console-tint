import { ValueObject } from './base/value-object';
import { Color } from './color';

// A left-to-right gradient of evenly spaced colors. The private constructor makes fromStops()
// the single gate: instances always hold MIN_STOPS..MAX_STOPS colors. CSS generation lives
// outside the domain (adapter/in/fill-css.ts), as for Color.
export class Gradient extends ValueObject<Gradient> {
  static readonly MIN_STOPS = 2;
  // A tinted bar is a thin horizontal strip, so more stops would add little but crowd the
  // stop editor's single row.
  static readonly MAX_STOPS = 4;

  private constructor(readonly stops: readonly [Color, Color, ...Color[]]) {
    super();
  }

  // Boundary constructor for untrusted input; undefined unless MIN_STOPS <= length <= MAX_STOPS.
  // Repeated colors are allowed (a freshly grown gradient is [c, c]).
  static fromStops(stops: readonly Color[]): Gradient | undefined {
    const [first, second, ...rest] = stops;
    if (first === undefined || second === undefined || stops.length > Gradient.MAX_STOPS) return undefined;
    return new Gradient([first, second, ...rest]);
  }

  equals(other: Gradient): boolean {
    return (
      this.stops.length === other.stops.length &&
      this.stops.every((stop, i) => {
        const otherStop = other.stops[i];
        return otherStop !== undefined && stop.equals(otherStop);
      })
    );
  }

  // The verbs below leave the gradient unchanged when the index does not fit, the same way
  // Palette's entry verbs ignore an unknown id; the editor disables the controls in those states.
  changeStop(index: number, color: Color): Gradient {
    if (index < 0 || index >= this.stops.length) return this;
    return this.rebuild(this.stops.map((stop, i) => (i === index ? color : stop)));
  }

  // The new color lands at `index`, pushing the stops from there one place to the right.
  insertStop(index: number, color: Color): Gradient {
    if (this.stops.length >= Gradient.MAX_STOPS || index < 0 || index > this.stops.length) return this;
    return this.rebuild([...this.stops.slice(0, index), color, ...this.stops.slice(index)]);
  }

  // Removing one of two stops leaves no gradient: the fill becomes the remaining stop's color.
  removeStop(index: number): Fill {
    if (index < 0 || index >= this.stops.length) return this;
    const remaining = this.stops.filter((_, i) => i !== index);
    return Gradient.fromStops(remaining) ?? remaining[0] ?? this;
  }

  // Black or white, whichever keeps the better worst-case WCAG contrast across the stops: Auto
  // text sits at both ends of the platform bar under one rule and stripes cross the whole bar, so
  // the pick must survive the least favourable stop. Ties go to black, as in Color.
  contrastingTextColor(): Color {
    // ponytail: only the stops are judged; sRGB interpolation can dip slightly below both ends
    // between stops. Sample segment midpoints if that ever shows.
    const worst = (text: Color) => Math.min(...this.stops.map((stop) => stop.contrastRatio(text)));
    return worst(Color.BLACK) >= worst(Color.WHITE) ? Color.BLACK : Color.WHITE;
  }

  // Only reached with a length the calling verb has already kept in range.
  private rebuild(stops: readonly Color[]): Gradient {
    return Gradient.fromStops(stops) ?? this;
  }
}

// What paints a tinted surface or a palette entry: a solid color or a gradient.
export type Fill = Color | Gradient;

// ValueObject<T>.equals cannot compare across the two classes; this is the one place that does.
export function fillEquals(a: Fill, b: Fill): boolean {
  if (a instanceof Color) return b instanceof Color && a.equals(b);
  return b instanceof Gradient && a.equals(b);
}
