import { describe, expect, it } from 'vitest';
import { Color } from '../color';
import { type Fill, fillEquals, Gradient, type GradientStop } from '../gradient';

const color = (value: string): Color => Color.fromHex(value)!;
const stopsOf = (...stops: [string, number][]): GradientStop[] =>
  stops.map(([hex, position]) => ({ color: color(hex), position }));
const gradient = (...stops: [string, number][]): Gradient => Gradient.fromStops(stopsOf(...stops))!;
// The stops of a gradient as [hex, position] pairs, or the hex of a solid, so one assertion reads
// either result.
const pairs = (fill: Fill): [string, number][] | string =>
  fill instanceof Gradient ? fill.stops.map((stop) => [stop.color.toHex(), stop.position]) : fill.toHex();
// `count` stops of one color, spread over 0..100 with the ends in place.
const spread = (count: number): GradientStop[] =>
  Array.from({ length: count }, (_, i) => ({ color: color('#123456'), position: Math.round((i * 100) / (count - 1)) }));

describe('Gradient.fromStops', () => {
  it.each([2, 3, 4, 8])('accepts %i stops', (count) => {
    expect(Gradient.fromStops(spread(count))?.stops).toHaveLength(count);
  });

  it.each([0, 1, 9])('refuses %i stops', (count) => {
    expect(Gradient.fromStops(count < 2 ? stopsOf(['#123456', 0]).slice(0, count) : spread(count))).toBeUndefined();
  });

  it('allows repeated colors', () => {
    expect(pairs(gradient(['#123456', 0], ['#123456', 100]))).toEqual([
      ['#123456', 0],
      ['#123456', 100],
    ]);
  });

  it('allows stops one percent apart', () => {
    expect(
      Gradient.fromStops(stopsOf(['#000000', 0], ['#ffffff', 40], ['#000000', 41], ['#ffffff', 100])),
    ).toBeDefined();
  });

  it('keeps its own copy of the stops it is given', () => {
    const stops = stopsOf(['#111111', 0], ['#222222', 100]);
    const made = Gradient.fromStops(stops)!;
    Object.assign(stops[0]!, { position: 50 });
    expect(made.stops[0].position).toBe(0);
  });
});

describe('Gradient.stopsProblem', () => {
  it('is undefined for stops fromStops accepts', () => {
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 30], ['#333333', 100]))).toBeUndefined();
  });

  it.each([0, 1, 9])('is a count problem for %i stops', (count) => {
    expect(Gradient.stopsProblem(count < 2 ? spread(2).slice(0, count) : spread(count))).toEqual({ kind: 'count' });
  });

  it.each([0.5, -1, 101, Number.NaN])('is a position problem for the position %d', (position) => {
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', position], ['#333333', 100]))).toEqual({
      kind: 'position',
      index: 1,
    });
  });

  it('is a first problem when the first stop is not at 0', () => {
    expect(Gradient.stopsProblem(stopsOf(['#111111', 5], ['#222222', 100]))).toEqual({ kind: 'first', index: 0 });
  });

  it('is a last problem when the last stop is not at 100', () => {
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 50], ['#333333', 95]))).toEqual({
      kind: 'last',
      index: 2,
    });
  });

  it('is an order problem for a position not above the previous one', () => {
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 40], ['#333333', 40], ['#444444', 100]))).toEqual({
      kind: 'order',
      index: 2,
      previous: 40,
    });
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 60], ['#333333', 30], ['#444444', 100]))).toEqual({
      kind: 'order',
      index: 2,
      previous: 60,
    });
  });

  // The order is fixed: the count first, then each stop in turn, range before first, last and order.
  it('reports the first problem in a fixed order', () => {
    expect(Gradient.stopsProblem([...spread(8), ...stopsOf(['#111111', 0.5])])).toEqual({ kind: 'count' });
    expect(Gradient.stopsProblem(stopsOf(['#111111', 5], ['#222222', 0.5], ['#333333', 100]))).toEqual({
      kind: 'first',
      index: 0,
    });
    expect(Gradient.stopsProblem(stopsOf(['#111111', -1], ['#222222', 100]))).toEqual({ kind: 'position', index: 0 });
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 50], ['#333333', 40]))).toEqual({
      kind: 'last',
      index: 2,
    });
    expect(Gradient.stopsProblem(stopsOf(['#111111', 0], ['#222222', 50], ['#333333', 40], ['#444444', 99]))).toEqual({
      kind: 'order',
      index: 2,
      previous: 50,
    });
  });
});

describe('Gradient.equals and fillEquals', () => {
  it('compares stop by stop, color and position', () => {
    const sunrise = gradient(['#111111', 0], ['#222222', 100]);
    expect(sunrise.equals(gradient(['#111111', 0], ['#222222', 100]))).toBe(true);
    expect(sunrise.equals(gradient(['#222222', 0], ['#111111', 100]))).toBe(false);
    expect(sunrise.equals(gradient(['#111111', 0], ['#222222', 50], ['#222222', 100]))).toBe(false);
    expect(
      gradient(['#111111', 0], ['#222222', 30], ['#333333', 100]).equals(
        gradient(['#111111', 0], ['#222222', 70], ['#333333', 100]),
      ),
    ).toBe(false);
  });

  it('never equates a color with a gradient, even one of that color alone', () => {
    expect(fillEquals(color('#111111'), gradient(['#111111', 0], ['#111111', 100]))).toBe(false);
    expect(fillEquals(gradient(['#111111', 0], ['#111111', 100]), color('#111111'))).toBe(false);
  });

  it('compares two colors or two gradients by value', () => {
    expect(fillEquals(color('#111111'), color('#111111'))).toBe(true);
    expect(fillEquals(color('#111111'), color('#222222'))).toBe(false);
    expect(fillEquals(gradient(['#111111', 0], ['#222222', 100]), gradient(['#111111', 0], ['#222222', 100]))).toBe(
      true,
    );
  });
});

describe('Gradient.changeStop', () => {
  it('recolors the stop at the index and keeps its position', () => {
    expect(pairs(gradient(['#111111', 0], ['#222222', 40], ['#333333', 100]).changeStop(1, color('#444444')))).toEqual([
      ['#111111', 0],
      ['#444444', 40],
      ['#333333', 100],
    ]);
  });

  it.each([-1, 2])('leaves the gradient unchanged for the out-of-range index %i', (index) => {
    const original = gradient(['#111111', 0], ['#222222', 100]);
    expect(original.changeStop(index, color('#333333'))).toBe(original);
  });
});

describe('Gradient.moveStop', () => {
  const four = gradient(['#111111', 0], ['#222222', 50], ['#333333', 90], ['#444444', 100]);

  it('moves an inner stop and keeps its color', () => {
    expect(pairs(four.moveStop(1, 70))).toEqual([
      ['#111111', 0],
      ['#222222', 70],
      ['#333333', 90],
      ['#444444', 100],
    ]);
  });

  it('stops one percent short of either neighbour', () => {
    expect(four.moveStop(1, 95).stops[1].position).toBe(89);
    expect(four.moveStop(1, 0).stops[1].position).toBe(1);
  });

  it.each([
    ['the first stop', 0, 10],
    ['the last stop', 3, 95],
    ['a non-integer position', 1, 49.5],
    ['an out-of-range index', 4, 50],
    ['a negative index', -1, 50],
    ['a position it already has', 1, 50],
  ])('leaves the gradient unchanged for %s', (_, index, position) => {
    expect(four.moveStop(index, position)).toBe(four);
  });
});

describe('Gradient.insertStop', () => {
  it('splits the gradient with the color already at the position', () => {
    expect(pairs(gradient(['#000000', 0], ['#ffffff', 100]).insertStop(50))).toEqual([
      ['#000000', 0],
      ['#808080', 50],
      ['#ffffff', 100],
    ]);
  });

  it('lands between the stops around the position', () => {
    expect(pairs(gradient(['#000000', 0], ['#ffffff', 40], ['#000000', 100]).insertStop(70))).toEqual([
      ['#000000', 0],
      ['#ffffff', 40],
      ['#808080', 70],
      ['#000000', 100],
    ]);
  });

  it.each([
    ['the left end', 0],
    ['the right end', 100],
    ['an existing stop', 40],
    ['a non-integer position', 50.5],
    ['a position outside the bar', 120],
  ])('leaves the gradient unchanged at %s', (_, position) => {
    const original = gradient(['#000000', 0], ['#ffffff', 40], ['#000000', 100]);
    expect(original.insertStop(position)).toBe(original);
  });

  it('leaves a full gradient unchanged', () => {
    const full = Gradient.fromStops(spread(8))!;
    expect(full.insertStop(50)).toBe(full);
  });
});

describe('Gradient.removeStop', () => {
  const three = gradient(['#111111', 0], ['#222222', 30], ['#333333', 100]);

  it('drops an inner stop and leaves the others where they are', () => {
    expect(pairs(three.removeStop(1))).toEqual([
      ['#111111', 0],
      ['#333333', 100],
    ]);
  });

  it('moves the next stop to the left end when the first is removed', () => {
    expect(pairs(three.removeStop(0))).toEqual([
      ['#222222', 0],
      ['#333333', 100],
    ]);
  });

  it('moves the previous stop to the right end when the last is removed', () => {
    expect(pairs(three.removeStop(2))).toEqual([
      ['#111111', 0],
      ['#222222', 100],
    ]);
  });

  it('leaves the other stop as a solid color when two remain', () => {
    const removed = gradient(['#111111', 0], ['#222222', 100]).removeStop(0);
    expect(removed).toBeInstanceOf(Color);
    expect(pairs(removed)).toBe('#222222');
  });

  it.each([-1, 2])('leaves the gradient unchanged for the out-of-range index %i', (index) => {
    const original = gradient(['#111111', 0], ['#222222', 100]);
    expect(original.removeStop(index)).toBe(original);
  });
});

describe('Gradient.colorAt', () => {
  const blackToWhite = gradient(['#000000', 0], ['#ffffff', 100]);

  it.each([
    [0, '#000000'],
    [25, '#404040'], // 63.75 rounds to 64
    [50, '#808080'], // 127.5 rounds to 128
    [100, '#ffffff'],
    [-5, '#000000'],
    [140, '#ffffff'],
  ])('reads black to white at %d as %s', (position, hex) => {
    expect(blackToWhite.colorAt(position).toHex()).toBe(hex);
  });

  it('rounds each channel of sunrise on its own', () => {
    expect(gradient(['#ff6d00', 0], ['#1a73e8', 100]).colorAt(50).toHex()).toBe('#8d7074');
  });

  it('reads a stop as its own color, between neighbours on either side', () => {
    const steps = gradient(['#000000', 0], ['#ffffff', 40], ['#000000', 41], ['#ffffff', 100]);
    expect(steps.colorAt(40).toHex()).toBe('#ffffff');
    expect(steps.colorAt(41).toHex()).toBe('#000000');
    expect(steps.colorAt(20).toHex()).toBe('#808080');
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
    const evenly = stops.map((hex, i): [string, number] => [hex, Math.round((i * 100) / (stops.length - 1))]);
    expect(
      gradient(...evenly)
        .contrastingTextColor()
        .equals(expected),
    ).toBe(true);
  });

  it('does not change with the stops’ positions', () => {
    const at = (position: number) =>
      gradient(['#eeeeee', 0], ['#000000', position], ['#000000', 100]).contrastingTextColor();
    expect(at(10).equals(at(90))).toBe(true);
  });

  it.each(['#000080', '#ffff00', '#ff6d00'])('matches Color for identical stops of %s', (hex) => {
    expect(gradient([hex, 0], [hex, 100]).contrastingTextColor().equals(color(hex).contrastingTextColor())).toBe(true);
  });
});
