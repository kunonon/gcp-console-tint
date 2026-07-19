export function contrastTextColor(bgHex: string): '#000000' | '#ffffff' {
  const match = /^#([0-9a-fA-F]{6})$/.exec(bgHex);
  if (!match) return '#ffffff';

  const r = parseInt(match[1].slice(0, 2), 16) / 255;
  const g = parseInt(match[1].slice(2, 4), 16) / 255;
  const b = parseInt(match[1].slice(4, 6), 16) / 255;

  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

  const luminance = 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);

  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;

  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

export function stripeGradient(bgHex: string): string {
  const color = contrastTextColor(bgHex);
  const rgba = color === '#000000' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.3)';
  return `repeating-linear-gradient(-45deg, ${rgba} 0 8px, transparent 8px 16px)`;
}
