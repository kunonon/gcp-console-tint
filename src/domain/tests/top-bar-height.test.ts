import { describe, expect, it } from 'vitest';
import { TopBarHeight } from '../top-bar-height';

describe('TopBarHeight.fromPixels', () => {
  it.each([1, 4, 40])('accepts %i, a whole number of pixels inside the range', (pixels) => {
    expect(TopBarHeight.fromPixels(pixels)?.toPixels()).toBe(pixels);
  });

  it.each([
    ['below the minimum', 0],
    ['above the maximum', 41],
    ['a fraction', 2.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('returns undefined for %s', (_label, pixels) => {
    expect(TopBarHeight.fromPixels(pixels)).toBeUndefined();
  });
});

describe('MIN / MAX', () => {
  it('are the range the side panel offers', () => {
    expect(TopBarHeight.MIN.toPixels()).toBe(1);
    expect(TopBarHeight.MAX.toPixels()).toBe(40);
  });

  it('are themselves accepted by fromPixels (the bounds are inclusive)', () => {
    expect(TopBarHeight.fromPixels(TopBarHeight.MIN.toPixels())?.equals(TopBarHeight.MIN)).toBe(true);
    expect(TopBarHeight.fromPixels(TopBarHeight.MAX.toPixels())?.equals(TopBarHeight.MAX)).toBe(true);
  });
});

describe('equals', () => {
  it('compares by value, not identity', () => {
    expect(TopBarHeight.fromPixels(12)?.equals(TopBarHeight.fromPixels(12)!)).toBe(true);
    expect(TopBarHeight.fromPixels(12)?.equals(TopBarHeight.fromPixels(13)!)).toBe(false);
  });
});
