import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { EASE_OUT_FLUID, reorderDuration } from './useRowReorder';

const checkboxOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.rule-select');

/**
 * Which row of a list shows its select checkbox for the pointer. The first row the pointer reaches
 * fades its checkbox in; from then on, while the pointer stays over the list, the checkbox moves
 * from row to row instead of fading out and in again, and it fades out once the pointer leaves the
 * list (the gaps between rows are part of the list, so crossing one keeps it; style.css makes the
 * checkboxes' column part of it too). Rows are entered through `pointerover`, which the browser also
 * sends when the rows move under a still pointer, as when a checkbox slides out from under it or a
 * dropped row lands there.
 *
 * Over and out go by the DOM, as :hover does, not by the React tree: a row's popover is a portal,
 * so its events reach the row's handlers, and React would never call the list's onPointerLeave for
 * a pointer that left through a popover's underlay, which is removed rather than left.
 *
 * - Spread `rowProps` on each row and `listProps` on the list. The hinted row carries
 *   `data-select-hint`, which CSS turns into a shown `.rule-select`. For a move, both rows carry
 *   `data-select-hint-moving` for one style flush, so CSS can switch the two checkboxes' opacity
 *   at once instead of fading them.
 * - With `sliding` off (every checkbox is shown, as while some are selected) the hint still follows
 *   the pointer, so the row under it keeps its checkbox when the selection empties, but nothing
 *   moves.
 * - Touch is ignored: without hover every checkbox shows anyway.
 * - The slide takes the rows' `--motion-reorder`, so reduced motion (and jsdom) moves it at once.
 */
export function useSelectHint({ sliding }: { sliding: boolean }) {
  const hinted = useRef<HTMLElement | null>(null);
  const slide = useRef<Animation | null>(null);

  const onPointerOver = (event: ReactPointerEvent<HTMLElement>) => {
    const row = event.currentTarget;
    const from = hinted.current;
    if (event.pointerType === 'touch' || row === from || !row.contains(event.target as Node)) return;
    hinted.current = row;
    const fromBox = from?.isConnected ? checkboxOf(from) : null;
    const toBox = checkboxOf(row);
    if (!from || !fromBox || !toBox || !sliding) {
      from?.removeAttribute('data-select-hint');
      row.setAttribute('data-select-hint', '');
      return;
    }
    // Measured before the swap, with any slide still running, so a quick run over several rows
    // carries on from where the checkbox is seen.
    const fromTop = fromBox.getBoundingClientRect().top;
    slide.current?.cancel();
    from.setAttribute('data-select-hint-moving', '');
    row.setAttribute('data-select-hint-moving', '');
    from.removeAttribute('data-select-hint');
    row.setAttribute('data-select-hint', '');
    // Forces a style flush, so the opacity changes happen with the transition off.
    void getComputedStyle(toBox).opacity;
    from.removeAttribute('data-select-hint-moving');
    row.removeAttribute('data-select-hint-moving');
    const delta = fromTop - toBox.getBoundingClientRect().top;
    const duration = reorderDuration(toBox);
    if (delta === 0 || duration === 0) return;
    slide.current = toBox.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
      duration,
      easing: EASE_OUT_FLUID,
    });
  };

  const onPointerOut = (event: ReactPointerEvent<HTMLElement>) => {
    const to = event.relatedTarget;
    if (to instanceof Node && event.currentTarget.contains(to)) return;
    hinted.current?.removeAttribute('data-select-hint');
    hinted.current = null;
  };

  return { rowProps: { onPointerOver }, listProps: { onPointerOut } };
}
