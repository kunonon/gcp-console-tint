import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A static guard, like theme-tokens.test.ts, for the colour pickers' rules in ../style.css that
// only a media feature jsdom and the E2E browsers do not emulate can show: forced colours (a
// Windows contrast theme drops every box-shadow and repaints every fill) and reduced motion.
const STYLE = 'src/adapter/in/entrypoints/sidepanel/style.css';
const style = readFileSync(resolve(process.cwd(), STYLE), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

describe('colour picker rules of style.css', () => {
  it('keeps a keyboard focus mark on the bordered controls where box-shadows are dropped', () => {
    const rule = /button\.outlined-control:focus-visible, \.hex-control:focus-within \{([^}]*)\}/.exec(style)?.[1];
    expect(rule, `${STYLE} must keep the focus rule of the pickers' bordered controls`).toBeDefined();
    // "none" would leave nothing to repaint under forced colours.
    expect(rule).toContain('2px solid transparent;');
    expect(rule).not.toMatch(/:\s*none/);
  });

  it('wraps the accent ring of a focused thumb of the colour well in white and a dark hairline', () => {
    const rule =
      /\.color-well \.color-area__thumb\[data-focus-visible="true"\], \.color-well \.color-slider__thumb\[data-focus-visible="true"\] \{([^}]*)\}/.exec(
        style,
      )?.[1];
    expect(rule, `${STYLE} must keep the focus rule of the colour well's thumbs`).toBeDefined();
    // A bare accent ring vanished on a colour near the accent (the seed's blue): the accent band
    // needs a white band outside it, so that one of the two always differs from the colour under
    // the thumb. The hairline outside the white band is the mark's edge on a white face.
    const bands = /0 0 0 (\d+)px var\(--focus\), 0 0 0 (\d+)px #fff, 0 0 0 (\d+)px rgba\(0, 0, 0, 0\.28\)/.exec(
      rule ?? '',
    );
    expect(bands, 'the accent band must be followed by a wider white band and a hairline').not.toBeNull();
    expect(Number(bands?.[2])).toBeGreaterThan(Number(bands?.[1]));
    expect(Number(bands?.[3])).toBeGreaterThan(Number(bands?.[2]));
  });

  it('keeps the fill of a bead under forced colours', () => {
    expect(/\.color-chip \{[^}]*forced-color-adjust: none;/.test(style)).toBe(true);
  });

  it("lays a gradient bead's and the stop strip's image over the border box, and keeps the strip's fill under forced colours", () => {
    expect(/\.color-chip \{[^}]*background-origin: border-box;/.test(style)).toBe(true);
    const strip = /\.fill-strip \{([^}]*)\}/.exec(style)?.[1];
    expect(strip, `${STYLE} must keep the rule of the gradient stops strip`).toBeDefined();
    expect(strip).toContain('forced-color-adjust: none;');
    expect(strip).toContain('background-origin: border-box;');
  });

  it('cuts the stop beads out of the strip with a halo of the popover surface, wider on the stop being edited', () => {
    expect(style).toContain(':where(.fill-strip) .color-chip { box-shadow: 0 0 0 1px var(--overlay); }');
    expect(style).toContain('.fill-strip button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--overlay); }');
  });

  it('marks the choice in use under forced colours, ahead of the focus rule so that focus shows on it', () => {
    const selected =
      '@media (forced-colors: active) { button.outlined-control[aria-pressed="true"], .hex-control.ring-2 { ' +
      'outline: 2px solid Highlight; outline-offset: 2px; } ' +
      // A bead keeps its own colours, so its focus mark is given the system's text colour.
      'button.color-chip:focus-visible { outline-color: CanvasText; } }';
    expect(style).toContain(selected);
    expect(style.indexOf(selected)).toBeLessThan(style.indexOf('button.outlined-control:focus-visible'));
  });

  it('keeps a bead at its size under the pointer, and when pressed under reduced motion', () => {
    // No hover movement in this dense list ("Hand-built controls" in style.css); a press scales
    // the bead, which reduced motion takes away.
    expect(style).not.toContain('button.color-chip:hover');
    expect(style).toContain('button.outlined-control:active, button.color-chip:active { scale: none; }');
  });
});
