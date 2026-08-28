import { describe, expect, it } from 'vitest';
import { Color } from '../color';

describe('Color.fromHex', () => {
  it('accepts a #rrggbb hex string', () => {
    expect(Color.fromHex('#000080')?.toHex()).toBe('#000080');
  });

  it('normalizes uppercase hex to lowercase', () => {
    expect(Color.fromHex('#ABCDEF')?.toHex()).toBe('#abcdef');
  });

  it('returns undefined for an invalid hex string', () => {
    expect(Color.fromHex('not-a-color')).toBeUndefined();
  });

  it('returns undefined for a shorthand 3-digit hex (unsupported format)', () => {
    expect(Color.fromHex('#fff')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(Color.fromHex('')).toBeUndefined();
  });
});

describe('round-trip', () => {
  it('returns the same value it parsed', () => {
    expect(Color.fromHex('#ff6d00')?.toHex()).toBe('#ff6d00');
  });
});

describe('equals', () => {
  it('compares by value, not identity', () => {
    expect(Color.fromHex('#000080')?.equals(Color.fromHex('#000080')!)).toBe(true);
    expect(Color.fromHex('#000080')?.equals(Color.fromHex('#000081')!)).toBe(false);
  });

  it('treats case-different inputs as the same color', () => {
    expect(Color.fromHex('#ABCDEF')?.equals(Color.fromHex('#abcdef')!)).toBe(true);
  });
});

describe('contrastingTextColor', () => {
  it('returns white text for a dark background', () => {
    expect(Color.fromHex('#000080')?.contrastingTextColor().equals(Color.WHITE)).toBe(true);
  });

  it('returns black text for a bright background', () => {
    expect(Color.fromHex('#ffff00')?.contrastingTextColor().equals(Color.BLACK)).toBe(true);
  });

  it('returns white text for pure black', () => {
    expect(Color.BLACK.contrastingTextColor().equals(Color.WHITE)).toBe(true);
  });

  it('returns black text for pure white', () => {
    expect(Color.WHITE.contrastingTextColor().equals(Color.BLACK)).toBe(true);
  });
});
