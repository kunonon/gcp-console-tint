// Display-only text fitting for the side panel. Callers pass copies of what they show; the values
// these come from (an import failure's version, issues and cause, a picked file's name) are never
// rewritten, so DevTools and the console still see them whole.

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

// Moves a cut point back by one when it would land between the two halves of a surrogate pair,
// so an emoji is dropped whole instead of leaving a lone half behind.
function backOffSurrogate(text: string, end: number): number {
  return end > 0 && isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end;
}

// File names and version stamps come from the user's file and can be arbitrarily long; past `max`
// UTF-16 units they are cut and end in an ellipsis so one value cannot push the sentence around it
// out of view.
export function shortenForDisplay(text: string, max = 256): string {
  if (text.length <= max) return text;
  return `${text.slice(0, backOffSurrogate(text, max - 1))}…`;
}

export const DETAIL_LIMIT = 16_384;
const TRUNCATION_MARKER = 'Details truncated.';

// Fits an error detail (and an optional closing footer line) into DETAIL_LIMIT UTF-16 units. The
// footer always survives. When the body has to be cut, whole lines are kept in order and a
// "Details truncated." line marks the cut; only a first line that alone does not fit is cut
// mid-line. The result is both what is shown and what Copy details copies.
export function fitDetail(body: string, footer?: string): string {
  const footerPart = footer === undefined ? '' : `\n${footer}`;
  if (body.length + footerPart.length <= DETAIL_LIMIT) return body + footerPart;

  const budget = DETAIL_LIMIT - footerPart.length - `\n${TRUNCATION_MARKER}`.length;
  let end = body.indexOf('\n');
  if (end === -1 || end > budget) {
    end = budget;
  } else {
    for (let next = body.indexOf('\n', end + 1); next !== -1 && next <= budget; next = body.indexOf('\n', next + 1)) {
      end = next;
    }
  }
  return `${body.slice(0, backOffSurrogate(body, end))}\n${TRUNCATION_MARKER}${footerPart}`;
}
