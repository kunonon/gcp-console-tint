import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reorderTarget, useRowReorder } from '../useRowReorder';

// Four 36px rows 8px apart: tops 0, 44, 88, 132; midpoints 18, 62, 106, 150.
const GAP = 8;
const slots = [0, 44, 88, 132].map((top) => ({ top, height: 36 }));

describe('reorderTarget', () => {
  // One row, pressed at its center and released with its center at `center`: the row lands past
  // every other row whose midpoint lies strictly above that center. A midpoint equal to the center
  // is not above it, so a tie keeps the row below.
  it.each([
    { name: 'stays put at its own center', from: 1, center: 62, to: 1 },
    { name: 'moves down past the next midpoint', from: 0, center: 107, to: 2 },
    { name: 'moves up past the previous midpoint', from: 3, center: 61, to: 1 },
    { name: 'goes to the top above every midpoint', from: 2, center: -40, to: 0 },
    { name: 'goes to the end below every midpoint', from: 0, center: 400, to: 3 },
    { name: 'moving down, does not pass a row whose midpoint equals its center', from: 0, center: 106, to: 1 },
    { name: 'moving up, passes a row whose midpoint equals its center', from: 3, center: 62, to: 1 },
  ])('$name', ({ from, center, to }) => {
    const delta = center - ((slots[from] as { top: number }).top + 18);
    expect(reorderTarget(slots, [from], from, delta, GAP)).toBe(to);
  });

  // A block of selected rows, `delta` px of pointer travel from the press on `grabbed`. The target
  // is the index into the list without the block.
  it.each([
    { name: 'a block of two stays put without travel', moving: [1, 2], grabbed: 1, delta: 0, to: 1 },
    { name: 'a block of two moves down one row after one row pitch', moving: [0, 1], grabbed: 0, delta: 45, to: 1 },
    { name: 'a block of two does not move down for exactly one pitch', moving: [0, 1], grabbed: 1, delta: 44, to: 0 },
    { name: 'a block of two moves up one row after one row pitch', moving: [2, 3], grabbed: 3, delta: -45, to: 1 },
    { name: 'a block of two moves up for exactly one pitch', moving: [2, 3], grabbed: 2, delta: -44, to: 1 },
    { name: 'a block of two goes to the end', moving: [0, 1], grabbed: 0, delta: 400, to: 2 },
    { name: 'a block of two goes to the top', moving: [2, 3], grabbed: 2, delta: -400, to: 0 },
    // Rows 0 and 2 grabbed by row 2: the block's top starts at row 1's packed top, under row 1.
    {
      name: 'a scattered selection gathers under the row above the grabbed one',
      moving: [0, 2],
      grabbed: 2,
      delta: 0,
      to: 1,
    },
    {
      name: 'a scattered selection grabbed by its first row gathers at the top',
      moving: [0, 2],
      grabbed: 0,
      delta: 0,
      to: 0,
    },
    { name: 'a scattered selection moves past the rows it sinks below', moving: [0, 2], grabbed: 0, delta: 89, to: 2 },
    // Rows 1 and 3 grabbed by row 3: the block starts under rows 0 and 2, at row 2's packed top.
    { name: 'a scattered selection moves above the row it rises over', moving: [1, 3], grabbed: 3, delta: -45, to: 1 },
  ])('$name', ({ moving, grabbed, delta, to }) => {
    expect(reorderTarget(slots, moving, grabbed, delta, GAP)).toBe(to);
  });
});

// The smallest list the hook can drive. jsdom lays nothing out, so every row measures 0x0 at the
// top: any move past the threshold targets the end of the list.
function List({ keys, onMove }: { keys: readonly string[]; onMove: (from: readonly number[], to: number) => void }) {
  const { listRef, rowRef, gripProps } = useRowReorder({ keys, onMove });
  return (
    <div ref={listRef}>
      {keys.map((key, index) => (
        <div key={key} ref={rowRef(key)}>
          <span data-testid={`grip-${key}`} {...gripProps(index)} />
        </div>
      ))}
    </div>
  );
}

const POINTER = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };

describe('useRowReorder', () => {
  afterEach(cleanup);

  it('cancels the drag when the rows change under it at the same count', () => {
    const onMove = vi.fn();
    const { rerender } = render(<List keys={['a', 'b', 'c']} onMove={onMove} />);

    fireEvent.pointerDown(screen.getByTestId('grip-a'), { ...POINTER, clientY: 0 });
    fireEvent.pointerMove(window, { ...POINTER, clientY: 50 });
    expect(document.querySelector('[data-dragging]')).not.toBeNull();
    // Another rule in place of the grabbed one: a drop would move a rule nobody grabbed.
    rerender(<List keys={['x', 'b', 'c']} onMove={onMove} />);
    expect(document.querySelector('[data-dragging]')).toBeNull();
    expect(document.documentElement.hasAttribute('data-reordering-pending')).toBe(false);
    fireEvent.pointerUp(window, { ...POINTER, clientY: 50 });

    expect(onMove).not.toHaveBeenCalled();
  });

  it('does not start while a row wrapper of the list is still animating in or out', () => {
    const onMove = vi.fn();
    render(<List keys={['a', 'b', 'c']} onMove={onMove} />);
    const wrapper = screen.getByTestId('grip-b').parentElement as HTMLElement;
    vi.spyOn(wrapper, 'getAnimations').mockReturnValue([{} as Animation]);

    fireEvent.pointerDown(screen.getByTestId('grip-a'), { ...POINTER, clientY: 0 });
    fireEvent.pointerMove(window, { ...POINTER, clientY: 50 });
    expect(document.documentElement.hasAttribute('data-reordering-pending')).toBe(false);
    expect(document.querySelector('[data-dragging]')).toBeNull();
    fireEvent.pointerUp(window, { ...POINTER, clientY: 50 });

    expect(onMove).not.toHaveBeenCalled();
  });
});
