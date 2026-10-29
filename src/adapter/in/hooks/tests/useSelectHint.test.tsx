import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSelectHint } from '../useSelectHint';

// Rows with a checkbox stand-in each, as App's rule rows carry `.rule-select`. `portal` puts an
// element in document.body from inside the first row, as a row's Delete popover does.
function List({
  keys,
  sliding = true,
  portal = false,
}: {
  keys: readonly string[];
  sliding?: boolean;
  portal?: boolean;
}) {
  const { rowProps, listProps } = useSelectHint({ sliding });
  return (
    <div data-testid="list" {...listProps}>
      {keys.map((key, index) => (
        <div key={key} data-testid={`row-${key}`} {...rowProps}>
          <span className="rule-select" data-testid={`box-${key}`} />
          {portal && index === 0 && createPortal(<div data-testid="popover" />, document.body)}
        </div>
      ))}
    </div>
  );
}

const MOUSE = { pointerType: 'mouse' };
const hinted = () => [...document.querySelectorAll('[data-select-hint]')].map((row) => row.getAttribute('data-testid'));

// jsdom lays nothing out and has no Element.animate: give a checkbox a top and the rows a
// `--motion-reorder`, so a move has somewhere to slide from and a duration to take.
function layOut(tops: Record<string, number>) {
  for (const [key, top] of Object.entries(tops)) {
    const box = screen.getByTestId(`box-${key}`);
    box.style.setProperty('--motion-reorder', '200ms');
    box.getBoundingClientRect = () => ({ top }) as DOMRect;
  }
  const cancel = vi.fn();
  const animate = vi.fn<Element['animate']>(() => ({ cancel }) as unknown as Animation);
  Element.prototype.animate = animate;
  return { animate, cancel };
}

describe('useSelectHint', () => {
  afterEach(() => {
    cleanup();
    delete (Element.prototype as Partial<Element>).animate;
  });

  it('hints the first row the pointer reaches and nothing else', () => {
    render(<List keys={['a', 'b', 'c']} />);

    fireEvent.pointerOver(screen.getByTestId('box-b'), MOUSE);

    expect(hinted()).toEqual(['row-b']);
  });

  it('moves the hint to the next row, with the opacity switch flag gone once the move is made', () => {
    render(<List keys={['a', 'b', 'c']} />);

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    fireEvent.pointerOver(screen.getByTestId('row-c'), MOUSE);

    expect(hinted()).toEqual(['row-c']);
    expect(document.querySelector('[data-select-hint-moving]')).toBeNull();
  });

  it('keeps the hint while the pointer crosses the gap between rows, and drops it when the pointer leaves the list', () => {
    render(<List keys={['a', 'b']} />);

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    fireEvent.pointerOut(screen.getByTestId('row-a'), { ...MOUSE, relatedTarget: screen.getByTestId('list') });
    fireEvent.pointerOver(screen.getByTestId('list'), MOUSE);
    expect(hinted()).toEqual(['row-a']);

    fireEvent.pointerOut(screen.getByTestId('row-a'), { ...MOUSE, relatedTarget: document.body });
    expect(hinted()).toEqual([]);
  });

  it("goes by the DOM for a row's portal: the pointer over it does not hint the row, and leaving the row for it leaves the list", () => {
    render(<List keys={['a', 'b']} portal />);

    // The portal is the row's child in React only; its events still reach the row's handlers.
    fireEvent.pointerOver(screen.getByTestId('popover'), MOUSE);
    expect(hinted()).toEqual([]);

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    // A popover's underlay covers the page; the pointer moving onto it has left the list, which
    // React's own leave would never report for the row it belongs to.
    fireEvent.pointerOut(screen.getByTestId('row-a'), { ...MOUSE, relatedTarget: screen.getByTestId('popover') });
    expect(hinted()).toEqual([]);
  });

  it('ignores touch, which shows every checkbox anyway', () => {
    render(<List keys={['a', 'b']} />);

    fireEvent.pointerOver(screen.getByTestId('row-a'), { pointerType: 'touch' });

    expect(hinted()).toEqual([]);
  });

  it('slides the checkbox from where the previous one is seen to its own row', () => {
    render(<List keys={['a', 'b', 'c']} />);
    const { animate, cancel } = layOut({ a: 0, b: 40, c: 80 });

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    expect(animate).not.toHaveBeenCalled();

    fireEvent.pointerOver(screen.getByTestId('row-c'), MOUSE);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(screen.getByTestId('box-c'));
    expect(animate.mock.calls[0]?.[0]).toEqual([{ transform: 'translateY(-80px)' }, { transform: 'none' }]);

    // A move during a slide replaces it.
    fireEvent.pointerOver(screen.getByTestId('row-b'), MOUSE);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[1]?.[0]).toEqual([{ transform: 'translateY(40px)' }, { transform: 'none' }]);
  });

  it('fades in again rather than sliding when the pointer comes back after leaving the list', () => {
    render(<List keys={['a', 'b']} />);
    const { animate } = layOut({ a: 0, b: 40 });

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    fireEvent.pointerOut(screen.getByTestId('row-a'), { ...MOUSE, relatedTarget: document.body });
    fireEvent.pointerOver(screen.getByTestId('row-b'), MOUSE);

    expect(hinted()).toEqual(['row-b']);
    expect(animate).not.toHaveBeenCalled();
  });

  it('follows the pointer without sliding while every checkbox is shown', () => {
    render(<List keys={['a', 'b']} sliding={false} />);
    const { animate } = layOut({ a: 0, b: 40 });

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    fireEvent.pointerOver(screen.getByTestId('row-b'), MOUSE);

    expect(hinted()).toEqual(['row-b']);
    expect(animate).not.toHaveBeenCalled();
  });

  it('fades in again rather than sliding from a hinted row that was removed', () => {
    const { rerender } = render(<List keys={['a', 'b']} />);
    const { animate } = layOut({ a: 0, b: 40 });

    fireEvent.pointerOver(screen.getByTestId('row-a'), MOUSE);
    rerender(<List keys={['b']} />);
    fireEvent.pointerOver(screen.getByTestId('row-b'), MOUSE);

    expect(hinted()).toEqual(['row-b']);
    expect(animate).not.toHaveBeenCalled();
  });
});
