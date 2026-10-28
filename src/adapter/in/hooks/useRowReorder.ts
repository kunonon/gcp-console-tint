import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef } from 'react';

// A row's natural place in document coordinates (rect top + scrollY), so window scrolling during a
// drag does not move it.
export type RowSlot = { top: number; height: number };

// Where the dragged row would land: the number of other rows whose natural midpoint lies strictly
// above `center`, the dragged row's center. That count is the insertion index into the list with
// the dragged row taken out, which is what TintSettings.moveRule takes as `toIndex`. A center
// exactly on a midpoint does not pass that row.
export function reorderTarget(slots: readonly RowSlot[], from: number, center: number): number {
  let to = 0;
  slots.forEach((slot, index) => {
    if (index !== from && slot.top + slot.height / 2 < center) to += 1;
  });
  return to;
}

// Below this distance a press on the grip stays a click: nothing moves and nothing is saved.
const THRESHOLD = 3;
// Auto-scroll band at the top and bottom of the viewport, and the speed at its outer edge.
const EDGE = 40;
const MAX_SCROLL = 12;
// style.css's `--ease-out-fluid` (HeroUI's token), for the landing animation.
const EASE_OUT_FLUID = 'cubic-bezier(0.32, 0.72, 0, 1)';

type Drag = {
  pointerId: number;
  grip: HTMLElement;
  list: HTMLElement;
  // `keys` as one string, to notice the rows changing under the drag.
  order: string;
  rows: HTMLElement[];
  slots: RowSlot[];
  from: number;
  to: number;
  startDocY: number;
  clientY: number;
  started: boolean;
  frame: number;
  detach: () => void;
};

// Rows in visual order with their on-screen tops (transforms included), taken just before the
// order changes, so the landing can start from where each row was seen.
type Snapshot = { list: HTMLElement; dragged: HTMLElement; tops: Map<HTMLElement, number> };

const orderOf = (keys: readonly string[]) => keys.join('\n');

const docTop = (element: HTMLElement) => element.getBoundingClientRect().top + window.scrollY;

/**
 * Pointer-driven reordering of a vertical list: the grabbed row follows the pointer, the rows it
 * passes slide aside to open a gap, and on release every row glides from where it was seen to its
 * new place.
 *
 * - `keys` is the rows' current order; rows are found through it, never through the DOM order.
 * - Spread `gripProps(index)` on each row's handle, `rowRef(key)` on the row and `listRef` on the
 *   flex container whose gap separates the rows.
 * - All styling is CSS on data attributes: `data-reordering-pending` on <html> from press to
 *   release and `data-reordering-drop` from a drop until the rows land, `data-reordering` on the
 *   list while a row is dragged and `data-settling` while rows land, `data-dragging` on the
 *   grabbed row. The hook writes inline `transform`s on the rows and never touches className,
 *   which React owns.
 * - `onMove(from, to)` follows TintSettings.moveRule: `to` is the index in the list without the
 *   moved row. It is called only for a real change; a release on the starting place, Escape, a
 *   cancelled pointer or a lost window focus just put the rows back.
 * - The landing duration is the rows' `--motion-reorder`; 0 (reduced motion) or none (jsdom)
 *   lands at once.
 */
export function useRowReorder({
  keys,
  onMove,
}: {
  keys: readonly string[];
  onMove: (from: number, to: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowsByKey = useRef(new Map<string, HTMLElement>());
  // The window listeners outlive the render that attached them, so they read the latest props.
  const keysRef = useRef(keys);
  const onMoveRef = useRef(onMove);
  useLayoutEffect(() => {
    keysRef.current = keys;
    onMoveRef.current = onMove;
  });
  const dragRef = useRef<Drag | null>(null);
  // A drop whose new order React has yet to commit; the layout effect below lands it.
  const pendingRef = useRef<Snapshot | null>(null);
  const landingRef = useRef<{ animations: Animation[]; done: () => void } | null>(null);

  // Ends a landing still in flight, at once: a new press measures natural positions.
  const stopLanding = () => {
    const landing = landingRef.current;
    landingRef.current = null;
    for (const animation of landing?.animations ?? []) animation.cancel();
    landing?.done();
  };

  const snapshot = (drag: Drag): Snapshot => ({
    list: drag.list,
    dragged: drag.rows[drag.from] as HTMLElement,
    tops: new Map(drag.rows.map((row) => [row, docTop(row)])),
  });

  // Drops the transforms and animates each row from its snapshot top to its natural one. Removing
  // `data-reordering` first takes the CSS transition off, so the transforms go without one.
  const settle = ({ list, dragged, tops }: Snapshot) => {
    list.removeAttribute('data-reordering');
    for (const row of tops.keys()) row.style.transform = '';
    const animations: Animation[] = [];
    for (const [row, top] of tops) {
      const delta = top - docTop(row);
      // A custom property keeps its written token, and the build minifies 200ms to `.2s`.
      const token = getComputedStyle(row).getPropertyValue('--motion-reorder').trim();
      const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
      if (delta === 0 || !(duration > 0)) continue;
      animations.push(
        row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
          duration,
          easing: EASE_OUT_FLUID,
        }),
      );
    }
    // The dropped row keeps its lift, and the list its unclipped rows, until the last one lands.
    const done = () => {
      list.removeAttribute('data-settling');
      dragged.removeAttribute('data-dragging');
      document.documentElement.removeAttribute('data-reordering-drop');
    };
    if (animations.length === 0) {
      done();
      return;
    }
    list.setAttribute('data-settling', '');
    const landing = { animations, done };
    landingRef.current = landing;
    // `finished` rejects when an animation is cancelled; a newer press has then already cleaned up.
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (landingRef.current !== landing) return;
      landingRef.current = null;
      done();
    });
  };

  // Lays out the dragged row at the pointer and the others around the gap it opens.
  const update = () => {
    const drag = dragRef.current;
    if (!drag?.started) return;
    const self = drag.slots[drag.from] as RowSlot;
    const first = drag.slots[0] as RowSlot;
    const last = drag.slots[drag.slots.length - 1] as RowSlot;
    const top = self.top + drag.clientY + window.scrollY - drag.startDocY;
    // The row stops at the list's ends, but the target follows the pointer: with equal rows, the
    // clamped center sits exactly on the last row's midpoint, which would never pass it.
    const shown = Math.min(Math.max(top, first.top), last.top + last.height - self.height);
    (drag.rows[drag.from] as HTMLElement).style.transform = `translateY(${shown - self.top}px)`;
    const to = reorderTarget(drag.slots, drag.from, top + self.height / 2);
    if (to === drag.to) return;
    drag.to = to;
    const gap = Number.parseFloat(getComputedStyle(drag.list).rowGap) || 0;
    const stride = self.height + gap;
    drag.rows.forEach((row, index) => {
      if (index === drag.from) return;
      const offset =
        drag.from < to && index > drag.from && index <= to
          ? -stride
          : to < drag.from && index >= to && index < drag.from
            ? stride
            : 0;
      row.style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
    });
  };

  // Scrolls the window while the pointer is near its top or bottom edge, faster the closer it is.
  const autoScroll = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = requestAnimationFrame(autoScroll);
    const near = Math.max(EDGE - drag.clientY, drag.clientY - (window.innerHeight - EDGE), 0);
    if (near === 0) return;
    const step = Math.ceil((Math.min(near, EDGE) / EDGE) * MAX_SCROLL);
    const room =
      drag.clientY < EDGE
        ? window.scrollY
        : document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
    if (room <= 0) return;
    window.scrollBy(0, drag.clientY < EDGE ? -step : step);
    update();
  };

  // Ends the gesture's listeners, capture and markers; the rows' transforms are settle's business.
  const release = (drag: Drag) => {
    dragRef.current = null;
    drag.detach();
    cancelAnimationFrame(drag.frame);
    if ('hasPointerCapture' in drag.grip && drag.grip.hasPointerCapture(drag.pointerId)) {
      drag.grip.releasePointerCapture(drag.pointerId);
    }
    document.documentElement.removeAttribute('data-reordering-pending');
  };

  // Puts every row back where it was: the same landing as a drop on the starting place.
  const cancel = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const shot = drag.started ? snapshot(drag) : null;
    release(drag);
    if (shot) settle(shot);
  };

  const start = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    const list = listRef.current;
    const rows = keysRef.current.map((key) => rowsByKey.current.get(key));
    if (!list || rows.some((row) => !row)) return;
    // A row still opening or closing (Presence's `.reveal` transitions) is moving the rows below
    // it, so no position measured now would hold for the drag.
    if (Array.from(list.children).some((wrapper) => wrapper.getAnimations().length > 0)) return;
    event.preventDefault();
    stopLanding();
    const grip = event.currentTarget;
    const elements = rows as HTMLElement[];
    const drag: Drag = {
      pointerId: event.pointerId,
      grip,
      list,
      order: orderOf(keysRef.current),
      rows: elements,
      slots: elements.map((row) => ({ top: docTop(row), height: row.getBoundingClientRect().height })),
      from: index,
      to: index,
      startDocY: event.clientY + window.scrollY,
      clientY: event.clientY,
      started: false,
      frame: 0,
      detach: () => {},
    };

    const ours = (e: PointerEvent) => dragRef.current === drag && e.pointerId === drag.pointerId;
    const onPointerMove = (e: PointerEvent) => {
      if (!ours(e)) return;
      drag.clientY = e.clientY;
      if (!drag.started) {
        if (Math.abs(e.clientY + window.scrollY - drag.startDocY) < THRESHOLD) return;
        drag.started = true;
        list.setAttribute('data-reordering', '');
        (drag.rows[drag.from] as HTMLElement).setAttribute('data-dragging', '');
        drag.frame = requestAnimationFrame(autoScroll);
      }
      // The move that crosses the threshold is the first position update: WebDriver can cross it,
      // and reach the target, in one step.
      update();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!ours(e)) return;
      if (!drag.started || drag.to === drag.from) {
        cancel();
        return;
      }
      const shot = snapshot(drag);
      release(drag);
      // Scroll anchoring is off from here until the rows land: with the window scrolled, the
      // reordered rows would otherwise make the browser shift scrollY by a row at the commit, and
      // the whole list would jump. The landing measures in document coordinates and cannot undo it.
      document.documentElement.setAttribute('data-reordering-drop', '');
      pendingRef.current = shot;
      onMoveRef.current(drag.from, drag.to);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (ours(e)) cancel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.started || dragRef.current !== drag) return;
      // Ours alone: an open popover or the modal must not take the same Escape.
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };
    const onLost = () => {
      if (dragRef.current === drag) cancel();
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onLost);
    window.addEventListener('scroll', update);
    grip.addEventListener('lostpointercapture', onLost);
    // Removed before release() lets go of the capture, so letting go ourselves is not a loss.
    drag.detach = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onLost);
      window.removeEventListener('scroll', update);
      grip.removeEventListener('lostpointercapture', onLost);
    };
    dragRef.current = drag;
    // Keeps a press on the grip from starting a text selection.
    document.documentElement.setAttribute('data-reordering-pending', '');
    // jsdom has no pointer capture; the window listeners work either way.
    if ('setPointerCapture' in grip) grip.setPointerCapture(event.pointerId);
  };

  // Runs after every commit: once React has put the rows in their new order, they land from where
  // they were seen. No dependency list, as the drop's commit is the one that brings new props.
  useLayoutEffect(() => {
    const shot = pendingRef.current;
    if (!shot) return;
    pendingRef.current = null;
    settle(shot);
  });

  // Rows added, removed or reordered mid-drag invalidate the measured positions and `from`: a drop
  // would move another rule.
  const order = orderOf(keys);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the row order only
  useLayoutEffect(() => {
    if (dragRef.current && dragRef.current.order !== order) cancel();
  }, [order]);

  // Unmount: nothing may stay behind on <html> or in flight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only
  useEffect(
    () => () => {
      const drag = dragRef.current;
      if (drag) release(drag);
      stopLanding();
      document.documentElement.removeAttribute('data-reordering-drop');
    },
    [],
  );

  const rowRef = (key: string) => (element: HTMLElement | null) => {
    if (element) rowsByKey.current.set(key, element);
    else rowsByKey.current.delete(key);
  };

  const gripProps = (index: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(index, event),
  });

  return { listRef, rowRef, gripProps };
}
