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
// literals snap on a project switch. Registered custom properties animate instead, so the bars
// paint one fixed image template (FILL_IMAGE) whose colors are all such properties, and a switch
// only changes and animates the properties. The prefix keeps clear of the console's own properties.
const PROPERTY_PREFIX = '--gcp-console-tint-';

// Every fill is drawn as one gradient of 7 evenly spaced knots at k/6. Two fills on the same grid
// blend knot by knot, so any fill crossfades into any other (solid and gradient, 2 and 4 stops).
// The grid is exact for every stop count the domain allows: 2, 3 and 4 evenly spaced stops sit at
// multiples of 1, 1/2 and 1/3, all multiples of 1/6, and a straight segment between knots is the
// same line CSS draws between the original stops, short of rounding the in-between knots to whole
// channel values. A solid is 7 equal knots.
const KNOT_INTERVALS = 6;

// stop-k is the knot as painted: a color-mix() from from-k to to-k by FADE_PROPERTY. A switch moves
// to-k to the new fill, sets from-k to what is on screen, and animates FADE_PROPERTY from 0 to 1, so
// the mix picks the hue arc (OKLCH, see knotMixes) instead of the straight sRGB line a <color>
// transition takes, which passes grey between complementary colors such as orange and blue.
const STOP_PROPERTIES = Array.from({ length: KNOT_INTERVALS + 1 }, (_, k) => `${PROPERTY_PREFIX}stop-${k}`);
const FROM_PROPERTIES = Array.from({ length: KNOT_INTERVALS + 1 }, (_, k) => `${PROPERTY_PREFIX}from-${k}`);
const TO_PROPERTIES = Array.from({ length: KNOT_INTERVALS + 1 }, (_, k) => `${PROPERTY_PREFIX}to-${k}`);
const STRIPE_LIGHT = `${PROPERTY_PREFIX}stripe-light`;
const STRIPE_DARK = `${PROPERTY_PREFIX}stripe-dark`;

// The painted knots, read back on a switch so an interrupted fade resumes from what is on screen.
export const KNOT_PROPERTIES: readonly string[] = STOP_PROPERTIES;

// Never declared anywhere: a declaration, above all an !important one, would beat the animation and
// freeze the fade. Unanimated it sits at its registered initial value, 1, the settled end.
export const FADE_PROPERTY = `${PROPERTY_PREFIX}fade`;

// What the bars still move with a CSS transition (the knots move through FADE_PROPERTY instead).
export const FILL_TRANSITION_PROPERTIES = [STRIPE_LIGHT, STRIPE_DARK];

// Every property fillProperties() writes, in the order it returns them.
export const FILL_PROPERTIES = [...TO_PROPERTIES, ...FROM_PROPERTIES, ...STOP_PROPERTIES, STRIPE_LIGHT, STRIPE_DARK];

// Registration is what makes the properties animate and read back as colors: FADE_PROPERTY
// interpolates as a <number> and the stripe pair as colors, where an unregistered custom property
// flips at the midpoint like any discrete value; a registered stop-k computes to a resolved color,
// which the next switch reads back as its from-k. transparent is a neutral start for a bar that first
// appears with a fade.
export const FILL_PROPERTY_RULES = [
  ...FILL_PROPERTIES.map(
    (name) => `@property ${name} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
  ),
  `@property ${FADE_PROPERTY} { syntax: '<number>'; inherits: false; initial-value: 1; }`,
].join('\n');

// Stripes are always present as the top layer, transparent when off, so turning them on or off
// between projects fades too instead of snapping a layer in or out. The knots are oklch() colors
// now, which a gradient would blend in Oklab by default; `in srgb` keeps the line between two knots
// the one CSS draws between the fill's own hex stops (see fillKnots).
export const FILL_IMAGE = `${stripeLayer(`var(${STRIPE_LIGHT})`, `var(${STRIPE_DARK})`)}, linear-gradient(in srgb to right, ${STOP_PROPERTIES.map((name) => `var(${name})`).join(', ')})`;

// Below this chroma an end has no hue worth following, so its knot mixes in Oklab, which has no hue.
// In OKLCH the browser drops such a hue as powerless (Chrome somewhere between chroma 0.011 and
// 0.021), and a mix then paints the other end's hue, or hue 0 at rest, into a grey. The margin above
// Chrome's cutoff costs nothing: so close to grey, Oklab and OKLCH look the same.
const POWERLESS_CHROMA = 0.03;
// A shorter arc past this is "almost 180°", where a slight color change flips the arc's direction:
// such a knot follows the rest of the bar. Further from 180° a knot that turns against the bar keeps
// its own shorter arc, since forcing it round the long way paints a rainbow (up to 248°).
const NEAR_TIE_DEGREES = 160;

// background-color is the first stop, what the bar settles on under the always-opaque image. The
// content script steps it there only after the knots' fade, so the previous color stays underneath
// while they fade. Without the registrations the image still paints; it only snaps. `from` is the
// knots as painted (KNOT_PROPERTIES), absent to paint the fill at once.
export function fillProperties(
  fill: Fill,
  stripes: boolean,
  from?: readonly string[],
): { color: string; properties: [string, string][] } {
  const to = fillKnots(fill);
  const fromKnots = to.map((knot, k) => from?.[k] || knot);
  const mixes = knotMixes(fromKnots, to);
  const stops = mixes.map(
    (mix, k) =>
      `color-mix(in ${mix === 'oklab' ? mix : `oklch ${mix} hue`}, var(${FROM_PROPERTIES[k]}), var(${TO_PROPERTIES[k]}) calc(var(${FADE_PROPERTY}, 1) * 100%))`,
  );
  const { light, dark } = stripes ? stripeColors(fill) : { light: 'transparent', dark: 'transparent' };
  const values = [...to, ...fromKnots, ...stops, light, dark];
  return {
    color: (fill instanceof Gradient ? fill.stops[0] : fill).toHex(),
    properties: FILL_PROPERTIES.map((name, i) => [name, values[i] ?? 'transparent']),
  };
}

// How each knot mixes from the painted knot to the next: 'oklab' when either end is (nearly) grey,
// otherwise the OKLCH hue arc, 'shorter' | 'longer'. Each knot takes its shorter arc, except that one
// whose shorter arc is a near tie (within 20° of 180°) and turns against the bar's net direction goes
// the long way with it, so a gradient whose knots all sit near 180° from their targets turns one way
// instead of splitting into two hues with grey where they meet. A painted end with no chroma to read
// (the transparent first tint) stays on the target's arc: its hue is powerless, so the target's is
// used.
export function knotMixes(from: readonly string[], to: readonly string[]): ('oklab' | 'shorter' | 'longer')[] {
  const ends = to.map((target, k) => [chromaHue(from[k] ?? ''), chromaHue(target)] as const);
  const grey = (end: { chroma: number } | undefined) => end !== undefined && end.chroma < POWERLESS_CHROMA;
  const deltas = ends.map(([p, q]) =>
    p === undefined || q === undefined || grey(p) || grey(q)
      ? undefined
      : ((((q.hue - p.hue) % 360) + 540) % 360) - 180,
  );
  const direction = deltas.reduce<number>((sum, delta) => sum + (delta ?? 0), 0) >= 0 ? 1 : -1;
  return ends.map(([p, q], k) => {
    if (q === undefined || grey(p) || grey(q)) return 'oklab';
    const delta = deltas[k];
    return delta !== undefined && Math.abs(delta) > NEAR_TIE_DEGREES && Math.sign(delta) !== direction
      ? 'longer'
      : 'shorter';
  });
}

// OKLCH chroma and hue of '#rrggbb' or of a painted 'oklch(L C H)' / 'oklab(L a b)' (either with
// '/ A'); undefined for anything else (transparent, 'rgba(0, 0, 0, 0)', a 'none' channel), which then
// neither votes nor flips. sRGB to Oklab is Björn Ottosson's; Color.relativeLuminance is WCAG's, a
// different matrix.
export function chromaHue(color: string): { chroma: number; hue: number } | undefined {
  const painted = /^(oklch|oklab)\(\s*[^\s)]+\s+([^\s)]+)\s+([^\s)/]+)/.exec(color.trim());
  let a: number;
  let b: number;
  if (painted?.[1] === 'oklch') {
    const chroma = Number(painted[2]);
    const hue = Number(painted[3]);
    return Number.isFinite(chroma) && Number.isFinite(hue) ? { chroma, hue } : undefined;
  }
  if (painted) {
    a = Number(painted[2]);
    b = Number(painted[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined;
  } else if (/^#[0-9a-f]{6}$/i.test(color)) {
    const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((i) => {
      const v = Number.parseInt(color.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  } else {
    return undefined;
  }
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return { chroma: Math.hypot(a, b), hue: hue < 0 ? hue + 360 : hue };
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
