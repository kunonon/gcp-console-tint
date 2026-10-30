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
  knotMixes,
} from '../fill-css';

const color = (hex: string): Color => Color.fromHex(hex)!;
const gradient = (...hexes: string[]): Gradient => Gradient.fromStops(hexes.map(color))!;

describe('fillCss', () => {
  it('is the hex of a solid color', () => {
    expect(fillCss(color('#ff6d00'))).toBe('#ff6d00');
  });

  it('is a left-to-right linear gradient of the stops', () => {
    expect(fillCss(gradient('#ff6d00', '#1a73e8'))).toBe('linear-gradient(to right, #ff6d00, #1a73e8)');
  });
});

describe('fillBackground', () => {
  it('paints a solid as a color and no image', () => {
    expect(fillBackground(color('#ff6d00'))).toEqual({ color: '#ff6d00', image: '' });
  });

  it('paints a gradient over its first stop', () => {
    expect(fillBackground(gradient('#ff6d00', '#1a73e8'))).toEqual({
      color: '#ff6d00',
      image: 'linear-gradient(to right, #ff6d00, #1a73e8)',
    });
  });

  it('lists every stop of a 4-stop gradient', () => {
    expect(fillBackground(gradient('#112233', '#445566', '#778899', '#aabbcc'))).toEqual({
      color: '#112233',
      image: 'linear-gradient(to right, #112233, #445566, #778899, #aabbcc)',
    });
  });
});

describe('fillKnots', () => {
  // The knots stay exact only while every allowed stop count puts its stops on them, so raising
  // Gradient.MAX_STOPS past what the grid divides fails here instead of blurring the bars.
  it('puts the stops of every allowed stop count on a knot', () => {
    const intervals = fillKnots(color('#000000')).length - 1;
    for (let stops = Gradient.MIN_STOPS; stops <= Gradient.MAX_STOPS; stops++) {
      expect(intervals % (stops - 1), `${stops} stops on ${intervals} knot intervals`).toBe(0);
    }
  });

  it('repeats a solid color on all seven knots', () => {
    expect(fillKnots(color('#ff6d00'))).toEqual(Array(7).fill('#ff6d00'));
  });

  // R at the middle knot is 140.5, which rounds up to 0x8d.
  it('samples a 2-stop gradient every sixth, rounding each channel', () => {
    expect(fillKnots(gradient('#ff6d00', '#1a73e8'))).toEqual([
      '#ff6d00',
      '#d96e27',
      '#b36f4d',
      '#8d7074',
      '#66719b',
      '#4072c1',
      '#1a73e8',
    ]);
  });

  it('lands a 3-stop gradient middle stop exactly on the middle knot', () => {
    expect(fillKnots(gradient('#000000', '#666666', '#cccccc'))).toEqual([
      '#000000',
      '#222222',
      '#444444',
      '#666666',
      '#888888',
      '#aaaaaa',
      '#cccccc',
    ]);
  });

  it('lands a 4-stop gradient inner stops exactly on the knots at thirds', () => {
    expect(fillKnots(gradient('#000000', '#303030', '#606060', '#909090'))).toEqual([
      '#000000',
      '#181818',
      '#303030',
      '#484848',
      '#606060',
      '#787878',
      '#909090',
    ]);
  });

  it('interpolates each segment between its own stops', () => {
    expect(fillKnots(gradient('#ff0000', '#00ff00', '#0000ff'))).toEqual([
      '#ff0000',
      '#aa5500',
      '#55aa00',
      '#00ff00',
      '#00aa55',
      '#0055aa',
      '#0000ff',
    ]);
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
  const shorter = Array(7).fill('shorter');

  it('takes the shorter arc for every knot of orange to blue', () => {
    expect(knotMixes(knots('#ff6d00'), knots('#1a73e8'))).toEqual(shorter);
  });

  // Each knot is 168° to 180° from its target, some each way: the shorter arcs alone would split
  // the bar into pink and green.
  it('turns every knot of a near tie one way', () => {
    expect(knotMixes(knots('#e67023', '#db7b00'), knots('#52aae5', '#3aafdc'))).toEqual([
      'longer',
      'longer',
      'longer',
      'shorter',
      'shorter',
      'shorter',
      'shorter',
    ]);
  });

  it('sends only the knot whose near tie turns against the bar the long way, in either direction', () => {
    const expected = [...Array(6).fill('shorter'), 'longer'];
    expect(knotMixes(knots('#ff6d00', '#fbbc04'), knots('#1a73e8'))).toEqual(expected);
    expect(knotMixes(knots('#1a73e8'), knots('#ff6d00', '#fbbc04'))).toEqual(expected);
  });

  // Knots 5 and 6 turn against the rest by 149° and 112°, short of a near tie: forcing them the
  // long way would sweep a rainbow, so they keep their own arcs.
  it('leaves a knot that truly turns the other way on its shorter arc', () => {
    expect(knotMixes(knots('#ff6d00', '#fbbc04', '#34a853', '#1a73e8'), knots('#9334e6', '#e91e63'))).toEqual(shorter);
  });

  it("takes the target's arc from transparent, whose hue the mix ignores", () => {
    expect(knotMixes(Array(7).fill('rgba(0, 0, 0, 0)'), knots('#ff6d00'))).toEqual(shorter);
  });

  // In OKLCH a grey's hue is powerless, and the mix would paint the other end's hue into it.
  it.each([
    { name: 'from a grey', from: knots('#5f6368'), to: knots('#ff6d00') },
    { name: 'to a grey', from: knots('#ff6d00'), to: knots('#5f6368') },
    { name: 'to a grey at rest', from: knots('#80868b'), to: knots('#80868b') },
    { name: 'to a grey from transparent', from: Array(7).fill('rgba(0, 0, 0, 0)'), to: knots('#dadce0') },
    {
      name: 'to a grey read back in Oklab',
      from: Array(7).fill('oklab(0.497874 -0.00257875 -0.00901091)'),
      to: knots('#1a73e8'),
    },
  ])('mixes in Oklab $name', ({ from, to }) => {
    expect(knotMixes(from, to)).toEqual(Array(7).fill('oklab'));
  });

  it('counts a chroma under 0.03 as grey and one above as a hue', () => {
    expect(knotMixes(knots('#5c6570'), knots('#5c6570'))).toEqual(Array(7).fill('oklab'));
    expect(knotMixes(knots('#596678'), knots('#596678'))).toEqual(shorter);
  });

  // A grey knot among hued ones mixes in Oklab and leaves the others' arcs as they were.
  it('mixes only the grey knot of a bar in Oklab', () => {
    const from = [...knots('#ff6d00').slice(0, 6), '#5f6368'];
    expect(knotMixes(from, knots('#1a73e8'))).toEqual([...Array(6).fill('shorter'), 'oklab']);
  });
});

describe('fillProperties', () => {
  const name = (kind: string) => Array.from({ length: 7 }, (_, k) => `--gcp-console-tint-${kind}-${k}`);
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

  it('mixes from the painted knots it is given, on the arc knotMixes picks', () => {
    const from = fillKnots(gradient('#ff6d00', '#fbbc04'));
    const { properties } = fillProperties(color('#1a73e8'), false, from);
    expect(properties.slice(7, 14)).toEqual(name('from').map((property, k) => [property, from[k]]));
    expect(properties.slice(14, 21)).toEqual(
      name('stop').map((property, k) => [property, stop(k, k === 6 ? 'oklch longer hue' : 'oklch shorter hue')]),
    );
  });

  it('mixes a grey in Oklab', () => {
    expect(fillProperties(color('#5f6368'), false).properties.slice(14, 21)).toEqual(
      name('stop').map((property, k) => [property, stop(k, 'oklab')]),
    );
  });

  it('fills in missing painted knots with the target', () => {
    const { properties } = fillProperties(color('#1a73e8'), false, ['oklch(0.7 0.2 45)', '']);
    expect(properties.slice(7, 14).map(([, value]) => value)).toEqual([
      'oklch(0.7 0.2 45)',
      ...Array(6).fill('#1a73e8'),
    ]);
  });

  it('carries the stripe tint pair when stripes are on, over a gradient first stop', () => {
    const { color: base, properties } = fillProperties(gradient('#ff6d00', '#1a73e8'), true);
    expect(base).toBe('#ff6d00');
    expect(properties.slice(21)).toEqual([
      ['--gcp-console-tint-stripe-light', 'transparent'],
      ['--gcp-console-tint-stripe-dark', 'rgba(0, 0, 0, 0.3)'],
    ]);
  });

  it('takes white stripes on a dark fill', () => {
    expect(fillProperties(color('#000080'), true).properties.slice(21)).toEqual([
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
    expect(FILL_PROPERTIES).toHaveLength(23);
    expect(FILL_PROPERTY_RULES.split('\n')).toEqual([
      ...FILL_PROPERTIES.map(
        (property) => `@property ${property} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
      ),
      "@property --gcp-console-tint-fade { syntax: '<number>'; inherits: false; initial-value: 1; }",
    ]);
  });

  it('draws the stripes over a 7-knot sRGB gradient, both from the properties, with the stripe geometry', () => {
    expect(FILL_IMAGE).toBe(
      'repeating-linear-gradient(-45deg, var(--gcp-console-tint-stripe-light) 0 8px, var(--gcp-console-tint-stripe-dark) 8px 16px), ' +
        'linear-gradient(in srgb to right, var(--gcp-console-tint-stop-0), var(--gcp-console-tint-stop-1), var(--gcp-console-tint-stop-2), ' +
        'var(--gcp-console-tint-stop-3), var(--gcp-console-tint-stop-4), var(--gcp-console-tint-stop-5), var(--gcp-console-tint-stop-6))',
    );
  });
});
