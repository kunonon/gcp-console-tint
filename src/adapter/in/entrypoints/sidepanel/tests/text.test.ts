import { describe, expect, it } from 'vitest';
import { fitDetail, shortenForDisplay } from '../text';

const EMOJI = '😀'; // two UTF-16 units
const MARKER = '\nDetails truncated.';
const FOOTER = 'Validation stopped after 100 issues; fix these and import again.';

describe('shortenForDisplay', () => {
  it('keeps text of up to 256 units unchanged', () => {
    const text = 'a'.repeat(256);
    expect(shortenForDisplay(text)).toBe(text);
  });

  it('cuts longer text to 255 units plus an ellipsis', () => {
    expect(shortenForDisplay('a'.repeat(300))).toBe(`${'a'.repeat(255)}…`);
    expect(shortenForDisplay('a'.repeat(257))).toHaveLength(256);
  });

  it('drops an emoji whose halves straddle the cut instead of splitting it', () => {
    // The pair occupies units 254-255, so a 255-unit cut would keep only its high half.
    expect(shortenForDisplay(`${'a'.repeat(254)}${EMOJI}${'b'.repeat(10)}`)).toBe(`${'a'.repeat(254)}…`);
    // One unit earlier the whole pair fits before the cut.
    expect(shortenForDisplay(`${'a'.repeat(253)}${EMOJI}${'b'.repeat(10)}`)).toBe(`${'a'.repeat(253)}${EMOJI}…`);
  });

  it('honors a custom limit', () => {
    expect(shortenForDisplay('abcdef', 4)).toBe('abc…');
  });
});

describe('fitDetail', () => {
  it('leaves a body that fits untouched, with no truncation marker', () => {
    const body = 'x'.repeat(16_384);
    expect(fitDetail(body)).toBe(body);
  });

  it('appends the footer without cutting when body and footer fit together', () => {
    const body = 'x'.repeat(16_384 - FOOTER.length - 1);
    const result = fitDetail(body, FOOTER);
    expect(result).toBe(`${body}\n${FOOTER}`);
    expect(result).toHaveLength(16_384);
  });

  it('keeps whole lines and marks the cut when the body is too long', () => {
    const line = 'y'.repeat(99); // 100 units with its newline
    const body = Array.from({ length: 200 }, () => line).join('\n');
    // 16,384 - 19 (marker with its newline) = 16,365 units for the body: 163 lines take 16,299.
    const expected = `${Array.from({ length: 163 }, () => line).join('\n')}${MARKER}`;
    expect(fitDetail(body)).toBe(expected);
  });

  it('puts the marker before the footer when cutting at a line', () => {
    const line = 'y'.repeat(99);
    const body = Array.from({ length: 200 }, () => line).join('\n');
    const expected = `${Array.from({ length: 163 }, () => line).join('\n')}${MARKER}\n${FOOTER}`;
    const result = fitDetail(body, FOOTER);
    expect(result).toBe(expected);
    expect(result.length).toBeLessThanOrEqual(16_384);
  });

  it('keeps a later whole line that ends exactly at the budget', () => {
    // Budget 16,384 - 19 = 16,365. The second newline sits at unit 16,365, so both lines before it fit.
    const kept = `${'a'.repeat(100)}\n${'b'.repeat(16_264)}`;
    const result = fitDetail(`${kept}\n${'c'.repeat(100)}`);
    expect(result).toBe(`${kept}${MARKER}`);
    expect(result).toHaveLength(16_384);
  });

  it('keeps a later whole line that ends exactly at the budget left by the footer', () => {
    // Budget 16,384 - 19 - 65 = 16,300; the second newline sits at unit 16,300.
    const kept = `${'a'.repeat(100)}\n${'b'.repeat(16_199)}`;
    const result = fitDetail(`${kept}\n${'c'.repeat(100)}`, FOOTER);
    expect(result).toBe(`${kept}${MARKER}\n${FOOTER}`);
    expect(result).toHaveLength(16_384);
  });

  it('drops a later line whose newline sits one unit past the budget', () => {
    // Budget 16,365; the second newline sits at unit 16,366, so only the first line fits.
    expect(fitDetail(`${'a'.repeat(100)}\n${'b'.repeat(16_265)}\n${'c'.repeat(100)}`)).toBe(
      `${'a'.repeat(100)}${MARKER}`,
    );
    // With the footer the budget is 16,300; the second newline sits at unit 16,301.
    expect(fitDetail(`${'a'.repeat(100)}\n${'b'.repeat(16_200)}\n${'c'.repeat(100)}`, FOOTER)).toBe(
      `${'a'.repeat(100)}${MARKER}\n${FOOTER}`,
    );
  });

  it('reserves room for the footer, not just the marker, before choosing the last whole line', () => {
    // Budget 16,384 - 19 - 65 = 16,300. The second line ends at unit 16,350: inside the budget
    // the marker alone would leave (16,365), outside the one that also holds the footer.
    const body = `${'a'.repeat(16_299)}\n${'b'.repeat(50)}\n${'c'.repeat(5000)}`;
    const result = fitDetail(body, FOOTER);
    expect(result).toBe(`${'a'.repeat(16_299)}${MARKER}\n${FOOTER}`);
    expect(result).toHaveLength(16_383);
  });

  it('reserves room for the footer when cutting inside a single line', () => {
    const result = fitDetail('z'.repeat(20_000), FOOTER);
    expect(result).toBe(`${'z'.repeat(16_300)}${MARKER}\n${FOOTER}`);
    expect(result).toHaveLength(16_384);
  });

  it('cuts inside a single line that alone does not fit', () => {
    const body = 'z'.repeat(20_000);
    expect(fitDetail(body)).toBe(`${'z'.repeat(16_365)}${MARKER}`);
  });

  it('cuts inside the first line when it alone does not fit, even if later lines are short', () => {
    const body = `${'z'.repeat(20_000)}\nshort`;
    expect(fitDetail(body)).toBe(`${'z'.repeat(16_365)}${MARKER}`);
  });

  it('never leaves half of an emoji at the cut (odd and even offsets)', () => {
    // Pair at units 16,364-16,365: a 16,365-unit cut would keep only the high half.
    const odd = `${'z'.repeat(16_364)}${EMOJI.repeat(3000)}`;
    expect(fitDetail(odd)).toBe(`${'z'.repeat(16_364)}${MARKER}`);
    // Pair at units 16,363-16,364: the cut lands after it.
    const even = `${'z'.repeat(16_363)}${EMOJI.repeat(3000)}`;
    expect(fitDetail(even)).toBe(`${'z'.repeat(16_363)}${EMOJI}${MARKER}`);
  });
});
