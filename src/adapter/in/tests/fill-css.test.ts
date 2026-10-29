import { describe, expect, it } from 'vitest';
import { Color } from '../../../domain/color';
import { Gradient } from '../../../domain/gradient';
import { fillBackground, fillCss } from '../fill-css';

const color = (hex: string): Color => Color.fromHex(hex)!;
const gradient = (...hexes: string[]): Gradient => Gradient.fromStops(hexes.map(color))!;

// '#ff6d00' to '#1a73e8' keeps black stripes: its worst black contrast beats its worst white one.
const STRIPES = 'repeating-linear-gradient(-45deg, transparent 0 8px, rgba(0, 0, 0, 0.3) 8px 16px)';

describe('fillCss', () => {
  it('is the hex of a solid color', () => {
    expect(fillCss(color('#ff6d00'))).toBe('#ff6d00');
  });

  it('is a left-to-right linear gradient of the stops', () => {
    expect(fillCss(gradient('#ff6d00', '#1a73e8'))).toBe('linear-gradient(to right, #ff6d00, #1a73e8)');
  });
});

describe('fillBackground', () => {
  it('paints a solid without stripes as a color and no image', () => {
    expect(fillBackground(color('#ff6d00'), false)).toEqual({ color: '#ff6d00', image: '' });
  });

  it('lays the stripes over a solid', () => {
    expect(fillBackground(color('#ff6d00'), true)).toEqual({ color: '#ff6d00', image: STRIPES });
  });

  it('paints a gradient over its first stop', () => {
    expect(fillBackground(gradient('#ff6d00', '#1a73e8'), false)).toEqual({
      color: '#ff6d00',
      image: 'linear-gradient(to right, #ff6d00, #1a73e8)',
    });
  });

  it('lists the stripes before the gradient so they draw on top', () => {
    expect(fillBackground(gradient('#ff6d00', '#1a73e8'), true)).toEqual({
      color: '#ff6d00',
      image: `${STRIPES}, linear-gradient(to right, #ff6d00, #1a73e8)`,
    });
  });

  it('lists every stop of a 4-stop gradient', () => {
    expect(fillBackground(gradient('#112233', '#445566', '#778899', '#aabbcc'), false)).toEqual({
      color: '#112233',
      image: 'linear-gradient(to right, #112233, #445566, #778899, #aabbcc)',
    });
  });
});
