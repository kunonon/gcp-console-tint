import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { stripeGradient } from '../stripes';

describe('stripeGradient', () => {
  it('uses white-tinted stripes for a dark background (matching the contrast pick)', () => {
    expect(stripeGradient(Color.fromHex('#000080')!)).toBe(
      'repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.3) 0 8px, transparent 8px 16px)',
    );
  });

  it('uses black-tinted stripes for a bright background (matching the contrast pick)', () => {
    expect(stripeGradient(Color.fromHex('#ffff00')!)).toBe(
      'repeating-linear-gradient(-45deg, rgba(0, 0, 0, 0.3) 0 8px, transparent 8px 16px)',
    );
  });
});
