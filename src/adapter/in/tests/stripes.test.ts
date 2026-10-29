import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { Gradient } from '../../../domain/gradient';
import { stripeGradient } from '../stripes';

describe('stripeGradient', () => {
  it.each([
    { background: 'dark', hex: '#000080', light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
    { background: 'black', hex: '#000000', light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
    { background: 'bright', hex: '#ffff00', light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
    { background: 'white', hex: '#ffffff', light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
  ])('keeps bright stripes first on a $background background', ({ hex, light, dark }) => {
    expect(stripeGradient(Color.fromHex(hex)!)).toBe(
      `repeating-linear-gradient(-45deg, ${light} 0 8px, ${dark} 8px 16px)`,
    );
  });

  // A gradient takes the pick that survives its least favourable stop (Gradient.contrastingTextColor).
  it.each([
    { stops: ['#ff6d00', '#1a73e8'], light: 'transparent', dark: 'rgba(0, 0, 0, 0.3)' },
    { stops: ['#ff6d00', '#000080'], light: 'rgba(255, 255, 255, 0.3)', dark: 'transparent' },
  ])('picks the stripe tint for the gradient $stops', ({ stops, light, dark }) => {
    const gradient = Gradient.fromStops(stops.map((hex) => Color.fromHex(hex)!))!;
    expect(stripeGradient(gradient)).toBe(`repeating-linear-gradient(-45deg, ${light} 0 8px, ${dark} 8px 16px)`);
  });
});
