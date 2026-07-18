import { describe, it, expect } from 'vitest';
import { contrastTextColor, stripeGradient } from './color';

describe('contrastTextColor', () => {
  it('returns white text for a dark background', () => {
    expect(contrastTextColor('#000080')).toBe('#ffffff');
  });

  it('returns black text for a bright background', () => {
    expect(contrastTextColor('#ffff00')).toBe('#000000');
  });

  it('returns white text for pure black', () => {
    expect(contrastTextColor('#000000')).toBe('#ffffff');
  });

  it('returns black text for pure white', () => {
    expect(contrastTextColor('#ffffff')).toBe('#000000');
  });

  it('is case-insensitive for hex input', () => {
    expect(contrastTextColor('#000080')).toBe(contrastTextColor('#000080'.toUpperCase()));
  });

  it('falls back to white for an invalid hex string', () => {
    expect(contrastTextColor('not-a-color')).toBe('#ffffff');
  });

  it('falls back to white for a shorthand 3-digit hex (unsupported format)', () => {
    expect(contrastTextColor('#fff')).toBe('#ffffff');
  });

  it('falls back to white for an empty string', () => {
    expect(contrastTextColor('')).toBe('#ffffff');
  });
});

describe('stripeGradient', () => {
  it('uses white-tinted stripes for a dark background (matching contrastTextColor)', () => {
    expect(stripeGradient('#000080')).toBe(
      'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.3) 0 8px, transparent 8px 16px)',
    );
  });

  it('uses black-tinted stripes for a bright background (matching contrastTextColor)', () => {
    expect(stripeGradient('#ffff00')).toBe(
      'repeating-linear-gradient(45deg, rgba(0, 0, 0, 0.3) 0 8px, transparent 8px 16px)',
    );
  });

  it('falls back to white-tinted stripes for an invalid hex string', () => {
    expect(stripeGradient('not-a-color')).toBe(
      'repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.3) 0 8px, transparent 8px 16px)',
    );
  });
});
