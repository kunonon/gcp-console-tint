import { describe, expect, it } from 'vitest';
import { Color } from '../color';

describe('Color.parse', () => {
  it('accepts a #rrggbb hex string', () => {
    expect(Color.parse('#000080')?.toHex()).toBe('#000080');
  });

  it('normalizes uppercase hex to lowercase', () => {
    expect(Color.parse('#ABCDEF')?.toHex()).toBe('#abcdef');
  });

  it('returns null for an invalid hex string', () => {
    expect(Color.parse('not-a-color')).toBeNull();
  });

  it('returns null for a shorthand 3-digit hex (unsupported format)', () => {
    expect(Color.parse('#fff')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(Color.parse('')).toBeNull();
  });
});

describe('round-trip', () => {
  it('returns the same value it parsed', () => {
    expect(Color.parse('#ff6d00')?.toHex()).toBe('#ff6d00');
  });
});

describe('equals', () => {
  it('compares by value, not identity', () => {
    expect(Color.parse('#000080')?.equals(Color.parse('#000080')!)).toBe(true);
    expect(Color.parse('#000080')?.equals(Color.parse('#000081')!)).toBe(false);
  });

  it('treats case-different inputs as the same color', () => {
    expect(Color.parse('#ABCDEF')?.equals(Color.parse('#abcdef')!)).toBe(true);
  });
});

describe('contrastingTextColor', () => {
  it('returns white text for a dark background', () => {
    expect(Color.parse('#000080')?.contrastingTextColor().equals(Color.WHITE)).toBe(true);
  });

  it('returns black text for a bright background', () => {
    expect(Color.parse('#ffff00')?.contrastingTextColor().equals(Color.BLACK)).toBe(true);
  });

  it('returns white text for pure black', () => {
    expect(Color.BLACK.contrastingTextColor().equals(Color.WHITE)).toBe(true);
  });

  it('returns black text for pure white', () => {
    expect(Color.WHITE.contrastingTextColor().equals(Color.BLACK)).toBe(true);
  });
});
