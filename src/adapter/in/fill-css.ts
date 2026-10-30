import type { Color } from '../../domain/color';
import { type Fill, Gradient } from '../../domain/gradient';
import { stripeColors, stripeLayer } from './stripes';

// '#rrggbb' or 'linear-gradient(to right, #a, #b, ...)': a CSS `background` value for the delete swatch.
export function fillCss(fill: Fill): string {
  return fill instanceof Gradient ? gradientCss(fill) : fill.toHex();
}

// For the side panel swatches, which paint a fill without a transition: background-color (a
// gradient's first stop) and the gradient as the image. An empty image means none, so a solid is
// its color alone.
export function fillBackground(fill: Fill): { color: string; image: string } {
  if (fill instanceof Gradient) return { color: fill.stops[0].toHex(), image: gradientCss(fill) };
  return { color: fill.toHex(), image: '' };
}

// Evenly spaced stops need no positions: CSS spreads unpositioned stops evenly.
function gradientCss(gradient: Gradient): string {
  return `linear-gradient(to right, ${gradient.stops.map((stop) => stop.toHex()).join(', ')})`;
}

// The bars' crossfade. background-image is discrete, so a gradient or stripes written into it as
// literals snap on a project switch. Registered <color> custom properties interpolate instead, so
// the bars paint one fixed image template (FILL_IMAGE) whose colors are all such properties, and a
// switch only transitions the properties. The prefix keeps clear of the console's own properties.
const PROPERTY_PREFIX = '--gcp-console-tint-';

// Every fill is drawn as one gradient of 7 evenly spaced knots at k/6. Two fills on the same grid
// blend knot by knot, so any fill crossfades into any other (solid and gradient, 2 and 4 stops).
// The grid is exact for every stop count the domain allows: 2, 3 and 4 evenly spaced stops sit at
// multiples of 1, 1/2 and 1/3, all multiples of 1/6, and a straight segment between knots is the
// same line CSS draws between the original stops, short of rounding the in-between knots to whole
// channel values. A solid is 7 equal knots.
const KNOT_INTERVALS = 6;
const STOP_PROPERTIES = Array.from({ length: KNOT_INTERVALS + 1 }, (_, k) => `${PROPERTY_PREFIX}stop-${k}`);
const STRIPE_LIGHT = `${PROPERTY_PREFIX}stripe-light`;
const STRIPE_DARK = `${PROPERTY_PREFIX}stripe-dark`;

// Every property the bars transition, in the order fillProperties() returns them.
export const FILL_PROPERTIES = [...STOP_PROPERTIES, STRIPE_LIGHT, STRIPE_DARK];

// Registration is what makes the properties interpolate as colors; an unregistered custom property
// flips at the midpoint like any discrete value. transparent is a neutral start for a bar that
// first appears with a transition.
export const FILL_PROPERTY_RULES = FILL_PROPERTIES.map(
  (name) => `@property ${name} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
).join('\n');

// Stripes are always present as the top layer, transparent when off, so turning them on or off
// between projects fades too instead of snapping a layer in or out.
export const FILL_IMAGE = `${stripeLayer(`var(${STRIPE_LIGHT})`, `var(${STRIPE_DARK})`)}, linear-gradient(to right, ${STOP_PROPERTIES.map((name) => `var(${name})`).join(', ')})`;

// background-color is the first knot, what the bar settles on under the always-opaque image. The
// content script steps it there only after the knots' fade, so the previous color stays underneath
// while they fade. Without the registrations the image still paints; it only snaps.
export function fillProperties(fill: Fill, stripes: boolean): { color: string; properties: [string, string][] } {
  const knots = fillKnots(fill);
  const { light, dark } = stripes ? stripeColors(fill) : { light: 'transparent', dark: 'transparent' };
  const values = [...knots, light, dark];
  return {
    color: (fill instanceof Gradient ? fill.stops[0] : fill).toHex(),
    properties: FILL_PROPERTIES.map((name, i) => [name, values[i] ?? 'transparent']),
  };
}

// The fill's color at each knot, linearly interpolated in sRGB between its neighbouring stops (how
// CSS interpolates opaque hex stops), rounded to '#rrggbb'. Positions are counted in sixths of a
// segment with integers, so a knot on a stop reads that stop exactly.
export function fillKnots(fill: Fill): string[] {
  const stops: readonly [Color, ...Color[]] = fill instanceof Gradient ? fill.stops : [fill];
  return STOP_PROPERTIES.map((_, k) => {
    const sixths = k * (stops.length - 1);
    const from = stops[Math.floor(sixths / KNOT_INTERVALS)] ?? stops[0];
    const to = stops[Math.ceil(sixths / KNOT_INTERVALS)] ?? from;
    return mix(from, to, (sixths % KNOT_INTERVALS) / KNOT_INTERVALS);
  });
}

function mix(from: Color, to: Color, t: number): string {
  const channels = (color: Color) => [1, 3, 5].map((i) => Number.parseInt(color.toHex().slice(i, i + 2), 16));
  const target = channels(to);
  const mixed = channels(from).map((value, i) => Math.round(value + ((target[i] ?? value) - value) * t));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}
