import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { Gradient } from '../../../domain/gradient';
import { stripeColors, stripeLayer } from '../stripes';

describe('stripeColors', () => {
  it.each([
    { background: 'dark', hex: '#000080', light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
    { background: 'black', hex: '#000000', light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
    { background: 'bright', hex: '#ffff00', light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
    { background: 'white', hex: '#ffffff', light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
  ])('picks the stripe pair for a $background background', ({ hex, light, dark }) => {
    expect(stripeColors(Color.fromHex(hex)!)).toEqual({ light, dark });
  });

  // A gradient takes the pick that survives its least favourable stop (Gradient.contrastingTextColor).
  it.each([
    { stops: ['#ff6d00', '#1a73e8'], light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
    { stops: ['#ff6d00', '#000080'], light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
  ])('picks the stripe pair for the gradient $stops', ({ stops, light, dark }) => {
    const gradient = Gradient.fromStops(stops.map((hex) => Color.fromHex(hex)!))!;
    expect(stripeColors(gradient)).toEqual({ light, dark });
  });
});

describe('stripeLayer', () => {
  it('keeps the stripe geometry around any two colors, var() references included', () => {
    expect(stripeLayer('var(--a)', 'var(--b)')).toBe(
      'repeating-linear-gradient(-45deg, var(--a) 0 8px, var(--b) 8px 16px)',
    );
  });
});
