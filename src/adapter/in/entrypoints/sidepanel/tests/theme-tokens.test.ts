import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A static guard for the theme fade in ../style.css. jsdom evaluates neither @property nor
// transitions, so what can be checked here is that the registered tokens are exactly the colour
// tokens HeroUI changes between its light and dark themes. Paths resolve from the repository root,
// which is the working directory under Vitest.
const HEROUI_VARIABLES = 'node_modules/@heroui/styles/dist/themes/default/variables.css';
const STYLE = 'src/adapter/in/entrypoints/sidepanel/style.css';

// Tokens that differ between the themes but are not colours (shadow lists): they cannot be
// registered as <color>, so they switch at once.
const NON_COLOR_TOKENS = ['--surface-shadow', '--overlay-shadow', '--field-shadow'];

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

// The first declaration of each custom property in a stretch of CSS, whitespace-normalised.
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = '', value = ''] of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    if (!found.has(name)) found.set(name, value.replace(/\s+/g, ' ').trim());
  }
  return found;
}

const sorted = (names: Iterable<string>) => [...names].sort();

const heroui = read(HEROUI_VARIABLES);
const lightStart = heroui.indexOf('color-scheme: light');
const darkStart = heroui.indexOf('color-scheme: dark');
const light = declarations(heroui.slice(lightStart, darkStart));
const dark = declarations(heroui.slice(darkStart));
const differing = [...light.keys()].filter((name) => dark.has(name) && dark.get(name) !== light.get(name));
const expected = sorted(differing.filter((name) => !NON_COLOR_TOKENS.includes(name)));

const style = read(STYLE);

describe('theme token transitions (style.css against HeroUI variables.css)', () => {
  it("finds HeroUI's light and dark token blocks", () => {
    expect(lightStart, `no "color-scheme: light" block in ${HEROUI_VARIABLES}; update this parser`).toBeGreaterThan(-1);
    expect(darkStart, `no "color-scheme: dark" block after the light one in ${HEROUI_VARIABLES}`).toBeGreaterThan(
      lightStart,
    );
    expect(differing, 'the parser no longer sees the page colours change between the themes').toEqual(
      expect.arrayContaining(['--background', '--foreground']),
    );
    for (const name of NON_COLOR_TOKENS) {
      expect(differing, `${name} no longer differs between the themes; drop it from NON_COLOR_TOKENS`).toContain(name);
    }
  });

  it('registers exactly the colour tokens that differ between the themes', () => {
    const registered = [...style.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)]
      .filter(([, , body = '']) => /syntax:\s*"<color>"/.test(body))
      .map(([, name = '']) => name);
    expect(
      sorted(registered),
      `${STYLE} must have one @property <color> rule per colour token that differs between HeroUI's themes: ` +
        'add a rule for each missing token and delete each stale one (a differing token that is not a colour ' +
        'goes into NON_COLOR_TOKENS in this test instead)',
    ).toEqual(expected);
  });

  it('transitions exactly those tokens on html.theme-transitions', () => {
    const list = /html\.theme-transitions\s*\{[^}]*?transition-property:([^;]*);/.exec(style)?.[1] ?? '';
    const transitioned = list
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    expect(
      sorted(transitioned),
      `the transition-property list of html.theme-transitions in ${STYLE} must name every registered token, ` +
        'and nothing else',
    ).toEqual(expected);
    // Without a duration the transition lasts 0s and the theme flips at once again; the E2E cannot
    // see that, because it stretches the duration itself.
    expect(
      /html\.theme-transitions\s*\{[^}]*transition-duration:\s*300ms;/.test(style),
      `html.theme-transitions in ${STYLE} must keep "transition-duration: 300ms"`,
    ).toBe(true);
  });

  it('turns the transition off under prefers-reduced-motion', () => {
    expect(
      style.replace(/\s+/g, ' '),
      `${STYLE} must keep the reduced-motion rule that disables the theme transition`,
    ).toContain('@media (prefers-reduced-motion: reduce) { html.theme-transitions { transition: none; } }');
  });
});
