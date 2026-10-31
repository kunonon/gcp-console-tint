import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { Gradient } from '../../../domain/gradient';
import {
  chromaHue,
  FILL_IMAGE,
  FILL_PROPERTIES,
  FILL_PROPERTY_RULES,
  fillBackground,
  fillCss,
  fillKnots,
  fillProperties,
  fillStripImage,
  knotMixes,
} from '../fill-css';

const color = (hex: string): Color => Color.fromHex(hex)!;
// Stops at the given positions, or spread evenly over the bar when the colors come alone.
const at = (...stops: [string, number][]): Gradient =>
  Gradient.fromStops(stops.map(([hex, position]) => ({ color: color(hex), position })))!;
const gradient = (...hexes: string[]): Gradient =>
  at(...hexes.map((hex, i): [string, number] => [hex, Math.round((i * 100) / (hexes.length - 1))]));
// What CSS paints k% along a 0%-to-100% line between two opaque hex stops, each channel rounded,
// worked out here apart from Gradient.colorAt.
const lerp = (from: string, to: string, k: number): string =>
  `#${[1, 3, 5]
    .map((i) => {
      const a = Number.parseInt(from.slice(i, i + 2), 16);
      const b = Number.parseInt(to.slice(i, i + 2), 16);
      return Math.round(a + ((b - a) * k) / 100)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
const KNOTS = 101;

describe('fillCss', () => {
  it('is the hex of a solid color', () => {
    expect(fillCss(color('#ff6d00'))).toBe('#ff6d00');
  });

  it('is a left-to-right linear gradient of the stops at their positions', () => {
    expect(fillCss(at(['#ff6d00', 0], ['#8d7074', 50], ['#1a73e8', 100]))).toBe(
      'linear-gradient(to right, #ff6d00 0%, #8d7074 50%, #1a73e8 100%)',
    );
  });
});

describe('fillBackground', () => {
  it('paints a solid as a color and no image', () => {
    expect(fillBackground(color('#ff6d00'))).toEqual({ color: '#ff6d00', image: '' });
  });

  it('paints a gradient over its first stop', () => {
    expect(fillBackground(gradient('#ff6d00', '#1a73e8'))).toEqual({
      color: '#ff6d00',
      image: 'linear-gradient(to right, #ff6d00 0%, #1a73e8 100%)',
    });
  });

  it('lists every stop of a 4-stop gradient', () => {
    expect(fillBackground(gradient('#112233', '#445566', '#778899', '#aabbcc'))).toEqual({
      color: '#112233',
      image: 'linear-gradient(to right, #112233 0%, #445566 33%, #778899 67%, #aabbcc 100%)',
    });
  });
});

describe('fillStripImage', () => {
  // The beads' centres run from 13px to 100% - 13px, so each stop's color sits under its bead.
  it("places each stop in the strip's bead box", () => {
    expect(fillStripImage(at(['#ff6d00', 0], ['#8d7074', 50], ['#1a73e8', 100]), 13)).toBe(
      'linear-gradient(to right, #ff6d00 calc(13px + (100% - 26px) * 0), ' +
        '#8d7074 calc(13px + (100% - 26px) * 0.5), #1a73e8 calc(13px + (100% - 26px) * 1))',
    );
  });

  it('writes a position as a plain fraction', () => {
    expect(fillStripImage(at(['#000000', 0], ['#ffffff', 29], ['#000000', 100]), 12)).toContain(
      '#ffffff calc(12px + (100% - 24px) * 0.29)',
    );
  });
});

describe('fillKnots', () => {
  // The knots stay exact only while every position a stop can take is a knot, so a finer position
  // step than the grid's fails here instead of blurring the bars.
  it('has a knot at every whole-percent position a stop can take', () => {
    expect(fillKnots(color('#000000'))).toHaveLength(Gradient.MAX_POSITION - Gradient.MIN_POSITION + 1);
  });

  it('repeats a solid color on all 101 knots', () => {
    expect(fillKnots(color('#ff6d00'))).toEqual(Array(KNOTS).fill('#ff6d00'));
  });

  // R at the middle knot is 140.5, which rounds up to 0x8d.
  it('samples a 2-stop gradient every percent, rounding each channel', () => {
    const knots = fillKnots(gradient('#ff6d00', '#1a73e8'));
    expect(knots).toEqual(Array.from({ length: KNOTS }, (_, k) => lerp('#ff6d00', '#1a73e8', k)));
    expect(knots[50]).toBe('#8d7074');
  });

  it.each([
    { name: 'thirds', stops: [0, 33, 67, 100] },
    { name: 'one percent apart', stops: [0, 40, 41, 100] },
    { name: 'eight anywhere', stops: [0, 12, 23, 41, 55, 71, 86, 100] },
  ])('lands every stop exactly on its knot: $name', ({ stops }) => {
    const hexes = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
    const fill = at(...stops.map((position, i): [string, number] => [hexes[i] ?? '#000000', position]));
    const knots = fillKnots(fill);
    for (const stop of fill.stops) expect(knots[stop.position], `knot ${stop.position}`).toBe(stop.color.toHex());
  });

  it('interpolates each segment between its own stops', () => {
    const knots = fillKnots(at(['#ff0000', 0], ['#00ff00', 20], ['#0000ff', 100]));
    expect(knots.slice(0, 21)).toEqual(
      Array.from({ length: 21 }, (_, k) => lerp('#ff0000', '#00ff00', (k * 100) / 20)),
    );
    expect(knots[10]).toBe('#808000');
    expect(knots[60]).toBe('#008080');
  });
});

describe('chromaHue', () => {
  it.each([
    { color: '#ff6d00', chroma: 0.1989, hue: 45.77 },
    { color: '#1a73e8', chroma: 0.1946, hue: 257.86 },
    { color: 'oklch(0.639283 0.196775 331.813)', chroma: 0.196775, hue: 331.813 },
    { color: 'oklch(0.595553 0.195291 294.831 / 0.75)', chroma: 0.195291, hue: 294.831 },
    { color: 'oklab(0.497874 -0.00257875 -0.00901091)', chroma: 0.00937, hue: 254.03 },
    { color: 'oklab(0.6 0.1 -0.1 / 0.5)', chroma: 0.14142, hue: 315 },
  ])('reads the OKLCH chroma and hue of $color', ({ color: value, chroma, hue }) => {
    const result = chromaHue(value);
    expect(result?.chroma).toBeCloseTo(chroma, 3);
    expect(Math.abs((result?.hue ?? 0) - hue)).toBeLessThan(0.05);
  });

  it.each(['rgba(0, 0, 0, 0)', 'transparent', 'oklch(0.5 0 none)', 'oklab(0.5 none 0)'])(
    'has no hue for %s',
    (value) => {
      expect(chromaHue(value)).toBeUndefined();
    },
  );
});

describe('knotMixes', () => {
  const knots = (...hexes: string[]) => fillKnots(hexes.length === 1 ? color(hexes[0] ?? '') : gradient(...hexes));
  const shorter = Array(KNOTS).fill('shorter');
  const oklab = Array(KNOTS).fill('oklab');

  it('takes the shorter arc for every knot of orange to blue', () => {
    expect(knotMixes(knots('#ff6d00'), knots('#1a73e8'))).toEqual(shorter);
  });

  // Each knot is 168° to 180° from its target, some each way: the shorter arcs alone would split
  // the bar into pink and green, and turning the ones against the vote the long way would leave a
  // seam where the spaces meet.
  it('mixes a near tie in Oklab', () => {
    expect(knotMixes(knots('#e67023', '#db7b00'), knots('#52aae5', '#3aafdc'))).toEqual(oklab);
  });

  // Only the last knots' near tie turns against the bar; it no longer goes the long way alone.
  it('sends the whole bar to Oklab when one knot would turn the long way, in either direction', () => {
    expect(knotMixes(knots('#ff6d00', '#fbbc04'), knots('#1a73e8'))).toEqual(oklab);
    expect(knotMixes(knots('#1a73e8'), knots('#ff6d00', '#fbbc04'))).toEqual(oklab);
  });

  // Some knots turn against the rest across 180°, where a knot's shorter arc flips direction
  // between neighbours: per knot, that flip is a seam a percent wide.
  it('sends a bar whose knots turn both ways across 180° to Oklab', () => {
    expect(knotMixes(knots('#ff6d00', '#fbbc04', '#34a853', '#1a73e8'), knots('#9334e6', '#e91e63'))).toEqual(oklab);
  });

  it('keeps the shorter arc when every knot takes it', () => {
    expect(knotMixes(knots('#ff6d00', '#1a73e8'), knots('#e91e63'))).toEqual(shorter);
  });

  it("takes the target's arc from transparent, whose hue the mix ignores", () => {
    expect(knotMixes(Array(KNOTS).fill('rgba(0, 0, 0, 0)'), knots('#ff6d00'))).toEqual(shorter);
  });

  // In OKLCH a grey's hue is powerless, and the mix would paint the other end's hue into it.
  it.each([
    { name: 'from a grey', from: knots('#5f6368'), to: knots('#ff6d00') },
    { name: 'to a grey', from: knots('#ff6d00'), to: knots('#5f6368') },
    { name: 'to a grey at rest', from: knots('#80868b'), to: knots('#80868b') },
    { name: 'to a grey from transparent', from: Array(KNOTS).fill('rgba(0, 0, 0, 0)'), to: knots('#dadce0') },
    {
      name: 'to a grey read back in Oklab',
      from: Array(KNOTS).fill('oklab(0.497874 -0.00257875 -0.00901091)'),
      to: knots('#1a73e8'),
    },
  ])('mixes in Oklab $name', ({ from, to }) => {
    expect(knotMixes(from, to)).toEqual(oklab);
  });

  it('counts a chroma under 0.03 as grey and one above as a hue', () => {
    expect(knotMixes(knots('#5c6570'), knots('#5c6570'))).toEqual(oklab);
    expect(knotMixes(knots('#596678'), knots('#596678'))).toEqual(shorter);
  });

  // A grey knot among hued ones would mix in Oklab beside its neighbours' arcs: the whole bar does.
  it('mixes the whole bar in Oklab for one grey knot', () => {
    const from = [...knots('#ff6d00').slice(0, KNOTS - 1), '#5f6368'];
    expect(knotMixes(from, knots('#1a73e8'))).toEqual(oklab);
  });
});

describe('fillProperties', () => {
  const name = (kind: string) => Array.from({ length: KNOTS }, (_, k) => `--gcp-console-tint-${kind}-${k}`);
  const stop = (k: number, space = 'oklch shorter hue') =>
    `color-mix(in ${space}, var(--gcp-console-tint-from-${k}), var(--gcp-console-tint-to-${k}) calc(var(--gcp-console-tint-fade, 1) * 100%))`;

  it('lists the knots, mixes from them to themselves, and two transparent stripe colors when stripes are off', () => {
    expect(fillProperties(color('#ff6d00'), false)).toEqual({
      color: '#ff6d00',
      properties: [
        ...name('to').map((property) => [property, '#ff6d00']),
        ...name('from').map((property) => [property, '#ff6d00']),
        ...name('stop').map((property, k) => [property, stop(k)]),
        ['--gcp-console-tint-stripe-light', 'transparent'],
        ['--gcp-console-tint-stripe-dark', 'transparent'],
      ],
    });
  });

  it('mixes from the painted knots it is given, in the space knotMixes picks', () => {
    const from = fillKnots(gradient('#ff6d00', '#fbbc04'));
    const { properties } = fillProperties(color('#1a73e8'), false, from);
    expect(properties.slice(KNOTS, 2 * KNOTS)).toEqual(name('from').map((property, k) => [property, from[k]]));
    expect(properties.slice(2 * KNOTS, 3 * KNOTS)).toEqual(
      name('stop').map((property, k) => [property, stop(k, 'oklab')]),
    );
  });

  it('mixes a grey in Oklab', () => {
    expect(fillProperties(color('#5f6368'), false).properties.slice(2 * KNOTS, 3 * KNOTS)).toEqual(
      name('stop').map((property, k) => [property, stop(k, 'oklab')]),
    );
  });

  it('fills in missing painted knots with the target', () => {
    const { properties } = fillProperties(color('#1a73e8'), false, ['oklch(0.7 0.2 45)', '']);
    expect(properties.slice(KNOTS, 2 * KNOTS).map(([, value]) => value)).toEqual([
      'oklch(0.7 0.2 45)',
      ...Array(KNOTS - 1).fill('#1a73e8'),
    ]);
  });

  it('carries the stripe tint pair when stripes are on, over a gradient first stop', () => {
    const { color: base, properties } = fillProperties(gradient('#ff6d00', '#1a73e8'), true);
    expect(base).toBe('#ff6d00');
    expect(properties.slice(3 * KNOTS)).toEqual([
      ['--gcp-console-tint-stripe-light', 'transparent'],
      ['--gcp-console-tint-stripe-dark', 'rgba(0, 0, 0, 0.3)'],
    ]);
  });

  it('takes white stripes on a dark fill', () => {
    expect(fillProperties(color('#000080'), true).properties.slice(3 * KNOTS)).toEqual([
      ['--gcp-console-tint-stripe-light', 'rgba(255, 255, 255, 0.3)'],
      ['--gcp-console-tint-stripe-dark', 'transparent'],
    ]);
  });

  it('names its properties in FILL_PROPERTIES order', () => {
    expect(fillProperties(color('#ff6d00'), false).properties.map(([property]) => property)).toEqual(FILL_PROPERTIES);
  });
});

describe('the registered fill template', () => {
  it('registers every fill property as a non-inheriting color starting transparent, and the fade as a number at 1', () => {
    expect(FILL_PROPERTIES).toHaveLength(3 * KNOTS + 2);
    expect(FILL_PROPERTY_RULES.split('\n')).toEqual([
      ...FILL_PROPERTIES.map(
        (property) => `@property ${property} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
      ),
      "@property --gcp-console-tint-fade { syntax: '<number>'; inherits: false; initial-value: 1; }",
    ]);
  });

  it('draws the stripes over a 101-knot sRGB gradient, both from the properties, with the stripe geometry', () => {
    const knots = Array.from({ length: KNOTS }, (_, k) => `var(--gcp-console-tint-stop-${k})`);
    expect(FILL_IMAGE).toBe(
      'repeating-linear-gradient(-45deg, var(--gcp-console-tint-stripe-light) 0 8px, var(--gcp-console-tint-stripe-dark) 8px 16px), ' +
        `linear-gradient(in srgb to right, ${knots.join(', ')})`,
    );
    expect(FILL_IMAGE).toMatch(/var\(--gcp-console-tint-stop-100\)\)$/);
  });
});
