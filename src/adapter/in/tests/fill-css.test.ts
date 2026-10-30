import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { Gradient } from '../../../domain/gradient';
import {
  FILL_IMAGE,
  FILL_PROPERTIES,
  FILL_PROPERTY_RULES,
  fillBackground,
  fillCss,
  fillKnots,
  fillProperties,
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

describe('fillProperties', () => {
  const stops = Array.from({ length: 7 }, (_, k) => `--gcp-console-tint-stop-${k}`);

  it('lists the seven knots and two transparent stripe colors when stripes are off', () => {
    expect(fillProperties(color('#ff6d00'), false)).toEqual({
      color: '#ff6d00',
      properties: [
        ...stops.map((name) => [name, '#ff6d00']),
        ['--gcp-console-tint-stripe-light', 'transparent'],
        ['--gcp-console-tint-stripe-dark', 'transparent'],
      ],
    });
  });

  it('carries the stripe tint pair when stripes are on, over a gradient first stop', () => {
    const { color: base, properties } = fillProperties(gradient('#ff6d00', '#1a73e8'), true);
    expect(base).toBe('#ff6d00');
    expect(properties.slice(7)).toEqual([
      ['--gcp-console-tint-stripe-light', 'transparent'],
      ['--gcp-console-tint-stripe-dark', 'rgba(0, 0, 0, 0.3)'],
    ]);
  });

  it('takes white stripes on a dark fill', () => {
    expect(fillProperties(color('#000080'), true).properties.slice(7)).toEqual([
      ['--gcp-console-tint-stripe-light', 'rgba(255, 255, 255, 0.3)'],
      ['--gcp-console-tint-stripe-dark', 'transparent'],
    ]);
  });

  it('names its properties in FILL_PROPERTIES order', () => {
    expect(fillProperties(color('#ff6d00'), false).properties.map(([name]) => name)).toEqual(FILL_PROPERTIES);
  });
});

describe('the registered fill template', () => {
  it('registers every property as a non-inheriting color starting transparent', () => {
    expect(FILL_PROPERTY_RULES.split('\n')).toEqual(
      FILL_PROPERTIES.map(
        (name) => `@property ${name} { syntax: '<color>'; inherits: false; initial-value: transparent; }`,
      ),
    );
  });

  it('draws the stripes over a 7-knot gradient, both from the properties, with the stripe geometry', () => {
    expect(FILL_IMAGE).toBe(
      'repeating-linear-gradient(-45deg, var(--gcp-console-tint-stripe-light) 0 8px, var(--gcp-console-tint-stripe-dark) 8px 16px), ' +
        'linear-gradient(to right, var(--gcp-console-tint-stop-0), var(--gcp-console-tint-stop-1), var(--gcp-console-tint-stop-2), ' +
        'var(--gcp-console-tint-stop-3), var(--gcp-console-tint-stop-4), var(--gcp-console-tint-stop-5), var(--gcp-console-tint-stop-6))',
    );
  });
});
