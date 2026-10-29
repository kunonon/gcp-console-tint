import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef } from 'react';

// A row's natural place in document coordinates (rect top + scrollY), so window scrolling during a
// drag does not move it.
export type RowSlot = { top: number; height: number };

// The drag's geometry. The moving rows travel as one block: the grabbed row stays under the
// pointer and the other selected rows gather to it in list order, `gap` apart. `packed` holds the
// tops the other rows (`rest`, in order) would take packed one after another from the list's top,
// with the block out of the list: packed[i + 1] = packed[i] + height of rest[i] + gap. The block
// starts at packed[above], `above` being the number of other rows above the grabbed one, which is
// where the grabbed row already sits, so it does not jump under the pointer. `offsets` are the
// moving rows' tops inside the block and `height` the block's.
function blockLayout(slots: readonly RowSlot[], moving: readonly number[], grabbed: number, gap: number) {
  const rest = slots.map((_, index) => index).filter((index) => !moving.includes(index));
  const packed = [slots[0]?.top ?? 0];
  for (const index of rest) packed.push((packed.at(-1) as number) + (slots[index] as RowSlot).height + gap);
  const above = rest.filter((index) => index < grabbed).length;
  const offsets: number[] = [];
  let height = -gap;
  for (const index of moving) {
    offsets.push(height + gap);
    height += (slots[index] as RowSlot).height + gap;
  }
  return { rest, packed, above, offsets, height: Math.max(height, 0) };
}

// Where the moving rows would land, with the pointer `delta` px from where it pressed: the index,
// into the list with the moving rows taken out, at which they are inserted as one block, which is
// what TintSettings.moveRules takes as `toIndex`. The block's top (unclamped, so the target keeps
// following the pointer past the list's ends) passes another row above it once it rises to that
// row's packed top, and one below it once it sinks past the packed top of the row after it. With
// rows of equal height that is the center of the block's leading row (its first going up, its last
// going down) reaching the passed row's midpoint, as for a single row: a block moves by one row
// for one row pitch of pointer travel. A block exactly on a packed top passes a row above it but
// not one below it.
export function reorderTarget(
  slots: readonly RowSlot[],
  moving: readonly number[],
  grabbed: number,
  delta: number,
  gap: number,
): number {
  const { rest, packed, above } = blockLayout(slots, moving, grabbed, gap);
  const top = (packed[above] as number) + delta;
  let to = 0;
  rest.forEach((_, j) => {
    if ((j < above ? (packed[j] as number) : (packed[j + 1] as number)) < top) to += 1;
  });
  return to;
}

// Below this distance a press on the grip stays a click: nothing moves and nothing is saved.
const THRESHOLD = 3;
// Auto-scroll band at the top and bottom of the viewport, and the speed at its outer edge.
const EDGE = 40;
const MAX_SCROLL = 12;
// style.css's `--ease-out-fluid` (HeroUI's token), for the gathering and landing animations.
export const EASE_OUT_FLUID = 'cubic-bezier(0.32, 0.72, 0, 1)';

type Drag = {
  pointerId: number;
  grip: HTMLElement;
  list: HTMLElement;
  // `keys` as one string, to notice the rows changing under the drag.
  order: string;
  rows: HTMLElement[];
  slots: RowSlot[];
  // The list's row gap, read once at the press.
  gap: number;
  // The indices of the rows that move, ascending: the grabbed row alone, or the whole selection
  // when the grabbed row is part of it. Fixed at the press.
  moving: number[];
  grabbed: number;
  layout: ReturnType<typeof blockLayout>;
  // The last target the other rows were laid out for; -1 until the first update, so that one lays
  // them out even when the target is the starting place (a scattered selection leaves gaps there
  // that must close).
  to: number;
  startDocY: number;
  clientY: number;
  started: boolean;
  frame: number;
  // The moving rows sliding into the block as the drag starts.
  gathers: Animation[];
  detach: () => void;
};

// Rows in visual order with their on-screen tops (transforms included), taken just before the
// order changes, so the landing can start from where each row was seen. `moving` are the lifted
// rows, the lead (the block's top, which carries the lifted surface) first.
type Snapshot = { list: HTMLElement; moving: HTMLElement[]; tops: Map<HTMLElement, number> };

const orderOf = (keys: readonly string[]) => keys.join('\n');

const docTop = (element: HTMLElement) => element.getBoundingClientRect().top + window.scrollY;

// A custom property keeps its written token, and the build minifies 200ms to `.2s`. 0 (reduced
// motion) or none (jsdom) comes out as no duration.
export const reorderDuration = (row: HTMLElement) => {
  const token = getComputedStyle(row).getPropertyValue('--motion-reorder').trim();
  const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
  return duration > 0 ? duration : 0;
};

// Whether the indices are one run, so the rows already sit together as the block.
const isContiguous = (indices: readonly number[]) =>
  (indices.at(-1) as number) - (indices[0] as number) === indices.length - 1;

/**
 * Pointer-driven reordering of a vertical list: the grabbed row follows the pointer, the rows it
 * passes slide aside to open a gap, and on release every row glides from where it was seen to its
 * new place. Grabbing a selected row while two or more are selected drags the whole selection as
 * one block: the other selected rows slide in to the grabbed one, in list order, and land together.
 *
 * - `keys` is the rows' current order; rows are found through it, never through the DOM order.
 * - `selected` holds the keys of the selected rows; keys not in `keys` are ignored. Grabbing a row
 *   outside the selection drags that row alone.
 * - Spread `gripProps(index)` on each row's handle, `rowRef(key)` on the row and `listRef` on the
 *   flex container whose gap separates the rows.
 * - All styling is CSS on data attributes: `data-reordering-pending` on <html> from press to
 *   release and `data-reordering-drop` from a drop until the rows land, `data-reordering` on the
 *   list while rows are dragged and `data-settling` while rows land, `data-dragging` on every
 *   moving row: empty on the lead (the block's top row) and `follow` on the others. The lead also
 *   carries `--reorder-block-rest`, the block's height below the lead's own, so one lifted surface
 *   can cover the whole block. The hook writes inline `transform`s on the rows and never touches
 *   className, which React owns.
 * - `onMove(from, to)` follows TintSettings.moveRules: `from` are the moved rows' indices,
 *   ascending, and `to` the index in the list without them. It is called only for a real change; a
 *   release with the rows back as they were, Escape, a cancelled pointer or a lost window focus
 *   just put the rows back. A scattered selection released at its starting place is a change: it
 *   was shown gathered there, and lands that way.
 * - The gathering and landing duration is the rows' `--motion-reorder`; 0 (reduced motion) or none
 *   (jsdom) gathers and lands at once.
 */
export function useRowReorder({
  keys,
  selected,
  onMove,
}: {
  keys: readonly string[];
  selected?: ReadonlySet<string>;
  onMove: (from: readonly number[], to: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowsByKey = useRef(new Map<string, HTMLElement>());
  // The window listeners outlive the render that attached them, so they read the latest props.
  const keysRef = useRef(keys);
  const selectedRef = useRef(selected);
  const onMoveRef = useRef(onMove);
  useLayoutEffect(() => {
    keysRef.current = keys;
    selectedRef.current = selected;
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

  // Taken before the gathering animations are cancelled: the on-screen tops include them.
  const snapshot = (drag: Drag): Snapshot => ({
    list: drag.list,
    moving: drag.moving.map((index) => drag.rows[index] as HTMLElement),
    tops: new Map(drag.rows.map((row) => [row, docTop(row)])),
  });

  // Drops the transforms and animates each row from its snapshot top to its natural one. Removing
  // `data-reordering` first takes the CSS transition off, so the transforms go without one.
  const settle = ({ list, moving, tops }: Snapshot) => {
    list.removeAttribute('data-reordering');
    for (const row of tops.keys()) row.style.transform = '';
    const animations: Animation[] = [];
    for (const [row, top] of tops) {
      const delta = top - docTop(row);
      const duration = reorderDuration(row);
      if (delta === 0 || duration === 0) continue;
      animations.push(
        row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], {
          duration,
          easing: EASE_OUT_FLUID,
        }),
      );
    }
    // The dropped rows keep their lift, and the list its unclipped rows, until the last one lands.
    const done = () => {
      list.removeAttribute('data-settling');
      for (const row of moving) row.removeAttribute('data-dragging');
      moving[0]?.style.removeProperty('--reorder-block-rest');
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

  // Lays out the block at the pointer and the other rows around the gap it opens. Returns the
  // moving rows' transforms, so the start can tell how far each one jumped into the block.
  const update = () => {
    const drag = dragRef.current;
    if (!drag?.started) return [];
    const { slots, rows, moving, gap, layout } = drag;
    const first = slots[0] as RowSlot;
    const last = slots[slots.length - 1] as RowSlot;
    const delta = drag.clientY + window.scrollY - drag.startDocY;
    const top = (layout.packed[layout.above] as number) + delta;
    // The block stops at the list's ends, but the target follows the pointer: with equal rows, a
    // clamped block would sit exactly on the last packed top, which never passes it.
    const shown = Math.min(Math.max(top, first.top), last.top + last.height - layout.height);
    const shifts = moving.map((index, i) => (layout.offsets[i] as number) + shown - (slots[index] as RowSlot).top);
    moving.forEach((index, i) => {
      (rows[index] as HTMLElement).style.transform = `translateY(${shifts[i]}px)`;
    });
    const to = reorderTarget(slots, moving, drag.grabbed, delta, gap);
    if (to === drag.to) return shifts;
    drag.to = to;
    // Each other row packs from the list's top, past the block's height once it is below the gap.
    layout.rest.forEach((index, j) => {
      const offset = (layout.packed[j] as number) + (j >= to ? layout.height + gap : 0) - (slots[index] as RowSlot).top;
      (rows[index] as HTMLElement).style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
    });
    return shifts;
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

  // Ends the gesture's listeners, capture, gathering and markers; the rows' transforms are settle's
  // business. A snapshot, which sees the gathering, must be taken before this.
  const release = (drag: Drag) => {
    dragRef.current = null;
    drag.detach();
    cancelAnimationFrame(drag.frame);
    for (const animation of drag.gathers) animation.cancel();
    if ('hasPointerCapture' in drag.grip && drag.grip.hasPointerCapture(drag.pointerId)) {
      drag.grip.releasePointerCapture(drag.pointerId);
    }
    document.documentElement.removeAttribute('data-reordering-pending');
  };

  // Puts every row back where it was: the same landing as a drop on the starting place. A scattered
  // selection goes back to its separate places, so its rows lose the one surface over the block.
  const cancel = () => {
    const drag = dragRef.current;
    if (!drag) return;
    const shot = drag.started ? snapshot(drag) : null;
    release(drag);
    if (!shot) return;
    if (!isContiguous(drag.moving)) shot.moving[0]?.style.removeProperty('--reorder-block-rest');
    settle(shot);
  };

  const start = (index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current) return;
    const list = listRef.current;
    const currentKeys = keysRef.current;
    const rows = currentKeys.map((key) => rowsByKey.current.get(key));
    if (!list || rows.some((row) => !row)) return;
    // A row still opening or closing (Presence's `.reveal` transitions) is moving the rows below
    // it, so no position measured now would hold for the drag.
    if (Array.from(list.children).some((wrapper) => wrapper.getAnimations().length > 0)) return;
    event.preventDefault();
    stopLanding();
    const grip = event.currentTarget;
    const elements = rows as HTMLElement[];
    const slots = elements.map((row) => ({ top: docTop(row), height: row.getBoundingClientRect().height }));
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    const selection = selectedRef.current;
    const chosen = currentKeys.flatMap((key, i) => (selection?.has(key) ? [i] : []));
    const moving = chosen.length >= 2 && chosen.includes(index) ? chosen : [index];
    const drag: Drag = {
      pointerId: event.pointerId,
      grip,
      list,
      order: orderOf(currentKeys),
      rows: elements,
      slots,
      gap,
      moving,
      grabbed: index,
      layout: blockLayout(slots, moving, index, gap),
      to: -1,
      startDocY: event.clientY + window.scrollY,
      clientY: event.clientY,
      started: false,
      frame: 0,
      gathers: [],
      detach: () => {},
    };

    const ours = (e: PointerEvent) => dragRef.current === drag && e.pointerId === drag.pointerId;
    const onPointerMove = (e: PointerEvent) => {
      if (!ours(e)) return;
      drag.clientY = e.clientY;
      if (drag.started) {
        update();
        return;
      }
      if (Math.abs(e.clientY + window.scrollY - drag.startDocY) < THRESHOLD) return;
      drag.started = true;
      list.setAttribute('data-reordering', '');
      const lead = elements[moving[0] as number] as HTMLElement;
      for (const i of moving) {
        (elements[i] as HTMLElement).setAttribute('data-dragging', i === moving[0] ? '' : 'follow');
      }
      lead.style.setProperty(
        '--reorder-block-rest',
        `${drag.layout.height - (slots[moving[0] as number] as RowSlot).height}px`,
      );
      drag.frame = requestAnimationFrame(autoScroll);
      // The move that crosses the threshold is the first position update: WebDriver can cross it,
      // and reach the target, in one step.
      const shifts = update();
      // The other selected rows jump into the block on that update; an additive animation from
      // minus the jump slides each in from where it was, while the inline transform under it keeps
      // following the pointer. The jump is measured against the grabbed row, which has already
      // moved with the pointer: a row already next to it in the block has none, so a selection
      // that is one run stays rigid from the first frame.
      const grabbedShift = shifts[moving.indexOf(index)] as number;
      moving.forEach((i, m) => {
        const row = elements[i] as HTMLElement;
        const jump = (shifts[m] as number) - grabbedShift;
        const duration = reorderDuration(row);
        if (i === index || jump === 0 || duration === 0) return;
        drag.gathers.push(
          row.animate([{ transform: `translateY(${-jump}px)` }, { transform: 'translateY(0)' }], {
            duration,
            easing: EASE_OUT_FLUID,
            composite: 'add',
          }),
        );
      });
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!ours(e)) return;
      // Rows already together and back at their place are unchanged; scattered rows shown
      // gathered at their place are not.
      if (!drag.started || (isContiguous(moving) && drag.to === drag.layout.above)) {
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
      onMoveRef.current(moving, drag.to);
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

  // Rows added, removed or reordered mid-drag invalidate the measured positions and the moving
  // indices: a drop would move other rules.
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
