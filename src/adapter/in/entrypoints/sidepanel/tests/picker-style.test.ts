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

  it('keeps the fill of a bead under forced colours', () => {
    expect(/\.color-chip \{[^}]*forced-color-adjust: none;/.test(style)).toBe(true);
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
