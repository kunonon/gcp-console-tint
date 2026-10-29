import { type Fill, Gradient } from '../../domain/gradient';
import { stripeGradient } from './stripes';

// '#rrggbb' or 'linear-gradient(to right, #a, #b, ...)': a CSS `background` value for the delete swatch.
export function fillCss(fill: Fill): string {
  return fill instanceof Gradient ? gradientCss(fill) : fill.toHex();
}

// background-color (a gradient's first stop, so the 300ms color crossfade keeps a sane target and
// a solid paints before any image) and the image layers, stripes listed first (on top). An empty
// image means none, so a solid without stripes reads exactly as it did before gradients.
export function fillBackground(fill: Fill, stripes: boolean): { color: string; image: string } {
  const layers: string[] = [];
  if (stripes) layers.push(stripeGradient(fill));
  if (fill instanceof Gradient) layers.push(gradientCss(fill));
  const base = fill instanceof Gradient ? fill.stops[0] : fill;
  return { color: base.toHex(), image: layers.join(', ') };
}

// Evenly spaced stops need no positions: CSS spreads unpositioned stops evenly.
function gradientCss(gradient: Gradient): string {
  return `linear-gradient(to right, ${gradient.stops.map((stop) => stop.toHex()).join(', ')})`;
}
