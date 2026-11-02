import { ValueObject } from './base/value-object';
import { Color } from './color';

// A stop of a gradient: its color and where it sits, as a whole percent of the bar's width.
export interface GradientStop {
  readonly color: Color;
  readonly position: number; // integer, Gradient.MIN_POSITION..Gradient.MAX_POSITION
}

// Why a set of stops is not a gradient. One problem, the first found in this order: count,
// then each position in turn (range, first, last, order).
export type GradientStopsProblem =
  | { kind: 'count' }
  | { kind: 'position'; index: number } // not an integer in MIN_POSITION..MAX_POSITION
  | { kind: 'first'; index: 0 } // the first stop is not at MIN_POSITION
  | { kind: 'last'; index: number } // the last stop is not at MAX_POSITION
  | { kind: 'order'; index: number; previous: number }; // not greater than the previous position

// A left-to-right gradient of colors at whole-percent positions: the ends at 0 and 100, the stops
// in between strictly increasing, so no two share a position (the bars draw one color per whole
// percent and cannot paint a hard stop exactly). The private constructor makes fromStops() the
// single gate. CSS generation lives outside the domain (adapter/in/fill-css.ts), as for Color.
export class Gradient extends ValueObject<Gradient> {
  static readonly MIN_STOPS = 2;
  // A UI bound, not a renderer one (the bars draw any count exactly): eight 16px beads with a 1px
  // halo are the most that stay apart on the narrowest full-width strip (141px of travel).
  static readonly MAX_STOPS = 8;
  static readonly MIN_POSITION = 0;
  static readonly MAX_POSITION = 100;

  private constructor(readonly stops: readonly [GradientStop, GradientStop, ...GradientStop[]]) {
    super();
  }

  // Why `stops` would be refused, or undefined when fromStops accepts it. The import adapter maps
  // each kind to a path and a message; the rules themselves live only here. Repeated colors are
  // allowed (a freshly grown gradient is [c, c]).
  static stopsProblem(stops: readonly GradientStop[]): GradientStopsProblem | undefined {
    if (stops.length < Gradient.MIN_STOPS || stops.length > Gradient.MAX_STOPS) return { kind: 'count' };
    let previous: number | undefined;
    for (const [index, { position }] of stops.entries()) {
      if (!Number.isInteger(position) || position < Gradient.MIN_POSITION || position > Gradient.MAX_POSITION) {
        return { kind: 'position', index };
      }
      if (index === 0 && position !== Gradient.MIN_POSITION) return { kind: 'first', index };
      if (index === stops.length - 1 && position !== Gradient.MAX_POSITION) return { kind: 'last', index };
      if (previous !== undefined && position <= previous) return { kind: 'order', index, previous };
      previous = position;
    }
    return undefined;
  }

  // Boundary constructor for untrusted input; undefined unless stopsProblem() is undefined.
  static fromStops(stops: readonly GradientStop[]): Gradient | undefined {
    if (Gradient.stopsProblem(stops)) return undefined;
    const [first, second, ...rest] = stops.map(({ color, position }) => ({ color, position }));
    if (first === undefined || second === undefined) return undefined;
    return new Gradient([first, second, ...rest]);
  }

  // Same count, and every stop the same color at the same position.
  equals(other: Gradient): boolean {
    return (
      this.stops.length === other.stops.length &&
      this.stops.every((stop, i) => {
        const otherStop = other.stops[i];
        return otherStop !== undefined && stop.position === otherStop.position && stop.color.equals(otherStop.color);
      })
    );
  }

  // The verbs below leave the gradient unchanged when the index does not fit, the same way
  // Palette's entry verbs ignore an unknown id; the editor disables the controls in those states.
  // Recolors the stop at `index`; it keeps its position.
  changeStop(index: number, color: Color): Gradient {
    if (index < 0 || index >= this.stops.length) return this;
    return this.rebuild(this.stops.map((stop, i) => (i === index ? { color, position: stop.position } : stop)));
  }

  // Moves an inner stop. `this` for an end, a bad index or a non-integer position, and when the
  // stop would not move. The position is clamped to [previous + 1, next - 1]: a stop never passes
  // its neighbours, so the stops keep their order and their numbers.
  moveStop(index: number, position: number): Gradient {
    const previous = this.stops[index - 1];
    const stop = this.stops[index];
    const next = this.stops[index + 1];
    if (!previous || !stop || !next || !Number.isInteger(position)) return this;
    const clamped = Math.min(Math.max(position, previous.position + 1), next.position - 1);
    if (clamped === stop.position) return this;
    return this.rebuild(this.stops.map((s, i) => (i === index ? { color: s.color, position: clamped } : s)));
  }

  // Splits the gradient at `position` with the color already there (colorAt), so the bar does not
  // change until the user recolors the new stop. `this` when full, when the position is not an
  // integer strictly inside (MIN_POSITION, MAX_POSITION), or when a stop already sits there.
  insertStop(position: number): Gradient {
    if (
      this.stops.length >= Gradient.MAX_STOPS ||
      !Number.isInteger(position) ||
      position <= Gradient.MIN_POSITION ||
      position >= Gradient.MAX_POSITION ||
      this.stops.some((stop) => stop.position === position)
    ) {
      return this;
    }
    const at = this.stops.findIndex((stop) => stop.position > position);
    const added = { color: this.colorAt(position), position };
    return this.rebuild([...this.stops.slice(0, at), added, ...this.stops.slice(at)]);
  }

  // An inner stop is dropped and the others keep their positions. An end is removed by moving its
  // neighbour to that end, so the gradient still spans the bar. Removing one of two stops leaves
  // no gradient: the fill becomes the remaining stop's color.
  removeStop(index: number): Fill {
    if (index < 0 || index >= this.stops.length) return this;
    const remaining = this.stops.filter((_, i) => i !== index);
    const last = remaining.length - 1;
    const spanned = remaining.map((stop, i) =>
      i === 0 || i === last
        ? { color: stop.color, position: i === 0 ? Gradient.MIN_POSITION : Gradient.MAX_POSITION }
        : stop,
    );
    return Gradient.fromStops(spanned) ?? remaining[0]?.color ?? this;
  }

  // The color the gradient shows at `position` (clamped to MIN_POSITION..MAX_POSITION): sRGB linear
  // interpolation between the neighbouring stops, each channel rounded to a whole value, which is
  // what CSS paints between opaque hex stops. On a stop it is that stop's color exactly.
  colorAt(position: number): Color {
    const at = Math.min(Math.max(position, Gradient.MIN_POSITION), Gradient.MAX_POSITION);
    const after = this.stops.findIndex((stop) => stop.position >= at);
    const to = this.stops[after] ?? this.stops[this.stops.length - 1] ?? this.stops[0];
    const from = this.stops[after - 1];
    if (!from || to.position === at) return to.color;
    return interpolate(from.color, to.color, at - from.position, to.position - from.position);
  }

  // Black or white, whichever keeps the better worst-case WCAG contrast across the stops: Auto
  // text sits at both ends of the platform bar under one rule and stripes cross the whole bar, so
  // the pick must survive the least favourable stop. Ties go to black, as in Color.
  contrastingTextColor(): Color {
    // ponytail: only the stops are judged; sRGB interpolation can dip slightly below both ends
    // between stops. Sample segment midpoints if that ever shows. Positions do not move the worst
    // case, since it is a stop's own color.
    const worst = (text: Color) => Math.min(...this.stops.map((stop) => stop.color.contrastRatio(text)));
    return worst(Color.BLACK) >= worst(Color.WHITE) ? Color.BLACK : Color.WHITE;
  }

  // Only reached with stops the calling verb has already kept valid.
  private rebuild(stops: readonly GradientStop[]): Gradient {
    return Gradient.fromStops(stops) ?? this;
  }
}

// `from` mixed `part / whole` of the way to `to`, channel by channel in sRGB, each rounded to a whole
// value. Multiplying before dividing keeps a whole-percent position exact: a + (b - a) * k / 100.
function interpolate(from: Color, to: Color, part: number, whole: number): Color {
  const channels = (color: Color) => [1, 3, 5].map((i) => Number.parseInt(color.toHex().slice(i, i + 2), 16));
  const target = channels(to);
  const mixed = channels(from).map((value, i) => Math.round(value + (((target[i] ?? value) - value) * part) / whole));
  return Color.fromHex(`#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`) ?? from;
}

// What paints a tinted surface or a palette entry: a solid color or a gradient.
export type Fill = Color | Gradient;

// ValueObject<T>.equals cannot compare across the two classes; this is the one place that does.
export function fillEquals(a: Fill, b: Fill): boolean {
  if (a instanceof Color) return b instanceof Color && a.equals(b);
  return b instanceof Gradient && a.equals(b);
}
