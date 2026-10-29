import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { type Fill, fillEquals, Gradient } from '../gradient';

const color = (value: string): Color => Color.fromHex(value)!;
const gradient = (...values: string[]): Gradient => Gradient.fromStops(values.map(color))!;
// The stops of a gradient as hex, or the hex of a solid, so one assertion reads either result.
const hexes = (fill: Fill): string[] | string =>
  fill instanceof Gradient ? fill.stops.map((stop) => stop.toHex()) : fill.toHex();

describe('Gradient.fromStops', () => {
  it.each([2, 3, 4])('accepts %i stops', (count) => {
    const stops = Array.from({ length: count }, () => color('#123456'));
    expect(Gradient.fromStops(stops)?.stops).toHaveLength(count);
  });

  it.each([0, 1, 5])('refuses %i stops', (count) => {
    expect(Gradient.fromStops(Array.from({ length: count }, () => color('#123456')))).toBeUndefined();
  });

  it('allows repeated colors', () => {
    expect(hexes(gradient('#123456', '#123456'))).toEqual(['#123456', '#123456']);
  });
});

describe('Gradient.equals and fillEquals', () => {
  it('compares stop by stop', () => {
    expect(gradient('#111111', '#222222').equals(gradient('#111111', '#222222'))).toBe(true);
    expect(gradient('#111111', '#222222').equals(gradient('#222222', '#111111'))).toBe(false);
    expect(gradient('#111111', '#222222').equals(gradient('#111111', '#222222', '#222222'))).toBe(false);
  });

  it('never equates a color with a gradient, even one of that color alone', () => {
    expect(fillEquals(color('#111111'), gradient('#111111', '#111111'))).toBe(false);
    expect(fillEquals(gradient('#111111', '#111111'), color('#111111'))).toBe(false);
  });

  it('compares two colors or two gradients by value', () => {
    expect(fillEquals(color('#111111'), color('#111111'))).toBe(true);
    expect(fillEquals(color('#111111'), color('#222222'))).toBe(false);
    expect(fillEquals(gradient('#111111', '#222222'), gradient('#111111', '#222222'))).toBe(true);
  });
});

describe('Gradient.changeStop', () => {
  it('replaces the stop at the index', () => {
    expect(hexes(gradient('#111111', '#222222').changeStop(1, color('#333333')))).toEqual(['#111111', '#333333']);
  });

  it.each([-1, 2])('leaves the gradient unchanged for the out-of-range index %i', (index) => {
    const original = gradient('#111111', '#222222');
    expect(original.changeStop(index, color('#333333'))).toBe(original);
  });
});

describe('Gradient.insertStop', () => {
  it('puts the new color at the index', () => {
    expect(hexes(gradient('#111111', '#222222').insertStop(1, color('#333333')))).toEqual([
      '#111111',
      '#333333',
      '#222222',
    ]);
  });

  it('appends at the end index', () => {
    expect(hexes(gradient('#111111', '#222222').insertStop(2, color('#333333')))).toEqual([
      '#111111',
      '#222222',
      '#333333',
    ]);
  });

  it('leaves a full gradient unchanged', () => {
    const full = gradient('#111111', '#222222', '#333333', '#444444');
    expect(full.insertStop(1, color('#555555'))).toBe(full);
  });

  it.each([-1, 3])('leaves the gradient unchanged for the out-of-range index %i', (index) => {
    const original = gradient('#111111', '#222222');
    expect(original.insertStop(index, color('#333333'))).toBe(original);
  });
});

describe('Gradient.removeStop', () => {
  it('drops the stop at the index', () => {
    expect(hexes(gradient('#111111', '#222222', '#333333').removeStop(1))).toEqual(['#111111', '#333333']);
  });

  it('leaves the other stop as a solid color when two remain', () => {
    const removed = gradient('#111111', '#222222').removeStop(0);
    expect(removed).toBeInstanceOf(Color);
    expect(hexes(removed)).toBe('#222222');
  });

  it.each([-1, 2])('leaves the gradient unchanged for the out-of-range index %i', (index) => {
    const original = gradient('#111111', '#222222');
    expect(original.removeStop(index)).toBe(original);
  });
});

describe('Gradient.contrastingTextColor', () => {
  it.each([
    // A first-stop rule would pick black here; the navy end needs white.
    { stops: ['#ff6d00', '#000080'], expected: Color.WHITE },
    // First-stop and mean-luminance rules both pick black; two black ends need white.
    { stops: ['#eeeeee', '#000000', '#000000'], expected: Color.WHITE },
    // Both worst cases are 1.0: the tie goes to black, as in Color.
    { stops: ['#000000', '#ffffff'], expected: Color.BLACK },
    { stops: ['#ff6d00', '#1a73e8'], expected: Color.BLACK },
  ])('picks the text color that survives the worst of $stops', ({ stops, expected }) => {
    expect(
      gradient(...stops)
        .contrastingTextColor()
        .equals(expected),
    ).toBe(true);
  });

  it.each(['#000080', '#ffff00', '#ff6d00'])('matches Color for identical stops of %s', (hex) => {
    expect(gradient(hex, hex).contrastingTextColor().equals(color(hex).contrastingTextColor())).toBe(true);
  });
});
