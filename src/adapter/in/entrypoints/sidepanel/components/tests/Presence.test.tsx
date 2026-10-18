import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Presence } from '../Presence';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The wrapper Presence puts around a child: the element that carries data-entering/data-exiting.
const wrapperOf = (text: string) => screen.getByText(text).closest('.reveal') as HTMLElement;
const shownTexts = (container: HTMLElement) => [...container.querySelectorAll('.reveal')].map((el) => el.textContent);

function List({ ids }: { ids: string[] }) {
  return (
    <Presence>
      {ids.map((id) => (
        <span key={id}>{id}</span>
      ))}
    </Presence>
  );
}

// jsdom runs no CSS, so test-setup.ts makes getAnimations() return []. These tests stand in for a
// browser that has started the exit transitions: every getAnimations() call on a wrapper marked
// data-exiting returns one animation whose `finished` promise the test settles by hand.
function stubExitAnimations() {
  const exits: { target: Element; finish: () => void; cancel: () => void }[] = [];
  vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-exiting')) return [];
    let finish = () => {};
    let cancel = () => {};
    const finished = new Promise<void>((resolve, reject) => {
      finish = resolve;
      cancel = () => reject(new DOMException('cancelled', 'AbortError'));
    });
    exits.push({ target: this, finish, cancel });
    return [{ finished } as unknown as Animation];
  });
  return exits;
}

describe('Presence', () => {
  describe('entering', () => {
    it('wraps each child and marks none of the children of the first render as entering', () => {
      const seen: boolean[] = [];
      vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(function (this: Element) {
        seen.push(this.hasAttribute('data-entering'));
        return [];
      });
      const { container } = render(<List ids={['a', 'b']} />);

      expect(shownTexts(container)).toEqual(['a', 'b']);
      expect(seen).toEqual([]);
      expect(container.querySelector('[data-entering]')).toBeNull();
      expect(wrapperOf('a').hasAttribute('inert')).toBe(false);
    });

    it('marks a child that appears later as entering for exactly one style flush', () => {
      const seen: string[] = [];
      vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(function (this: Element) {
        if (this.hasAttribute('data-entering')) seen.push(this.textContent ?? '');
        return [];
      });
      const { rerender } = render(<List ids={['a']} />);
      rerender(<List ids={['a', 'b']} />);

      // The flush saw the attribute on the new child only, and it is gone once the commit is over.
      expect(seen).toEqual(['b']);
      expect(wrapperOf('b').hasAttribute('data-entering')).toBe(false);

      rerender(<List ids={['b', 'a']} />);
      expect(seen).toEqual(['b']);
    });

    it('treats a conditional single child like any other keyed child', () => {
      const seen: string[] = [];
      vi.spyOn(Element.prototype, 'getAnimations').mockImplementation(function (this: Element) {
        if (this.hasAttribute('data-entering')) seen.push(this.textContent ?? '');
        return [];
      });
      const Section = ({ open }: { open: boolean }) => <Presence>{open && <div key="section">body</div>}</Presence>;
      const { container, rerender } = render(<Section open={false} />);
      expect(container.querySelector('.reveal')).toBeNull();

      rerender(<Section open />);
      expect(seen).toEqual(['body']);

      rerender(<Section open={false} />);
      expect(container.querySelector('.reveal')).toBeNull();
    });

    it('passes the gap to the wrapper as --reveal-gap, and sets nothing without one', () => {
      render(
        <>
          <Presence gap="0.75rem">
            <span key="a">with gap</span>
          </Presence>
          <Presence>
            <span key="b">default</span>
          </Presence>
        </>,
      );

      expect(wrapperOf('with gap').style.getPropertyValue('--reveal-gap')).toBe('0.75rem');
      expect(wrapperOf('default').getAttribute('style')).toBeNull();
    });
  });

  describe('leaving, when nothing animates (jsdom, or no transition left)', () => {
    it('removes the child in the same update', () => {
      const { container, rerender } = render(<List ids={['a', 'b', 'c']} />);
      rerender(<List ids={['a', 'c']} />);

      expect(shownTexts(container)).toEqual(['a', 'c']);
    });

    it('does the same under StrictMode, where renders and effects run twice', () => {
      const { container, rerender } = render(<List ids={['a', 'b']} />, { wrapper: StrictMode });
      rerender(<List ids={['a']} />);
      expect(shownTexts(container)).toEqual(['a']);

      rerender(<List ids={['a', 'b']} />);
      expect(shownTexts(container)).toEqual(['a', 'b']);
    });
  });

  describe('leaving, while the exit transitions run', () => {
    it('keeps the child mounted, inert and marked data-exiting until they finish', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b', 'c']} />);
      rerender(<List ids={['a', 'c']} />);

      expect(shownTexts(container)).toEqual(['a', 'b', 'c']);
      const leaving = wrapperOf('b');
      expect(leaving.hasAttribute('data-exiting')).toBe(true);
      expect(leaving.hasAttribute('inert')).toBe(true);
      expect(wrapperOf('a').hasAttribute('data-exiting')).toBe(false);
      expect(wrapperOf('a').hasAttribute('inert')).toBe(false);

      await act(async () => exits.at(-1)?.finish());
      await waitFor(() => expect(shownTexts(container)).toEqual(['a', 'c']));
    });

    it('still removes the child when its transition is cancelled instead of finishing', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b']} />);
      rerender(<List ids={['a']} />);

      await act(async () => exits.at(-1)?.cancel());
      await waitFor(() => expect(shownTexts(container)).toEqual(['a']));
    });

    it('keeps showing the content the child had when it left', () => {
      stubExitAnimations();
      const Row = ({ label }: { label?: string }) => (
        <Presence>{label !== undefined && <span key="row">{label}</span>}</Presence>
      );
      const { container, rerender } = render(<Row label="last seen" />);
      rerender(<Row />);

      expect(shownTexts(container)).toEqual(['last seen']);
    });

    it('revives the same node when the key comes back, and ignores the exit that was under way', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b']} />);
      const node = wrapperOf('b');
      rerender(<List ids={['a']} />);
      expect(node.hasAttribute('data-exiting')).toBe(true);

      rerender(<List ids={['a', 'b']} />);
      expect(wrapperOf('b')).toBe(node);
      expect(node.hasAttribute('data-exiting')).toBe(false);
      expect(node.hasAttribute('inert')).toBe(false);
      // It never left the document, so it does not enter again either.
      expect(node.hasAttribute('data-entering')).toBe(false);

      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      expect(shownTexts(container)).toEqual(['a', 'b']);
    });

    it('waits for the latest exit when a child leaves, comes back and leaves again', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b']} />);
      rerender(<List ids={['a']} />);
      rerender(<List ids={['a', 'b']} />);
      rerender(<List ids={['a']} />);
      expect(exits).toHaveLength(2);

      // The first exit was abandoned when the child came back; its end must not cut the second short.
      await act(async () => exits[0]?.finish());
      expect(shownTexts(container)).toEqual(['a', 'b']);

      await act(async () => exits[1]?.finish());
      await waitFor(() => expect(shownTexts(container)).toEqual(['a']));
    });

    it('removes only the child whose exit has finished, not one that is still leaving', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b', 'c']} />);
      rerender(<List ids={['a', 'c']} />);
      rerender(<List ids={['a']} />);
      expect(exits.map((exit) => exit.target.textContent)).toEqual(['b', 'c']);

      await act(async () => exits[0]?.finish());
      await waitFor(() => expect(shownTexts(container)).toEqual(['a', 'c']));
      expect(wrapperOf('c').hasAttribute('data-exiting')).toBe(true);

      await act(async () => exits[1]?.finish());
      await waitFor(() => expect(shownTexts(container)).toEqual(['a']));
    });

    it('keeps a leaving child in place, also when its neighbours leave, arrive or move meanwhile', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b', 'c', 'd']} />);

      // Two neighbours leave together: they keep their order between a and d.
      rerender(<List ids={['a', 'd']} />);
      expect(shownTexts(container)).toEqual(['a', 'b', 'c', 'd']);

      // The rest is reordered and a new child arrives while b and c are still leaving: each leaving
      // child stays right after the sibling that preceded it.
      rerender(<List ids={['d', 'e', 'a']} />);
      expect(shownTexts(container)).toEqual(['d', 'e', 'a', 'b', 'c']);
      expect(wrapperOf('b').hasAttribute('data-exiting')).toBe(true);
      expect(wrapperOf('c').hasAttribute('data-exiting')).toBe(true);

      // The first child leaving has no earlier sibling and goes to the front.
      rerender(<List ids={['e', 'a']} />);
      expect(shownTexts(container)).toEqual(['d', 'e', 'a', 'b', 'c']);

      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      await waitFor(() => expect(shownTexts(container)).toEqual(['e', 'a']));
    });

    it('replaces every child at once: the old ones collapse ahead of the new ones', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b']} />);
      rerender(<List ids={['x', 'y']} />);

      expect(shownTexts(container)).toEqual(['a', 'b', 'x', 'y']);
      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      await waitFor(() => expect(shownTexts(container)).toEqual(['x', 'y']));
    });

    it('keeps the leaving child through unrelated parent renders and updates the ones that stay', () => {
      stubExitAnimations();
      const Rows = ({ label, withB }: { label: string; withB: boolean }) => (
        <Presence>
          <span key="a">{label}</span>
          {withB && <span key="b">b</span>}
        </Presence>
      );
      const { container, rerender } = render(<Rows label="one" withB />);
      rerender(<Rows label="one" withB={false} />);
      rerender(<Rows label="two" withB={false} />);
      rerender(<Rows label="three" withB={false} />);

      expect(shownTexts(container)).toEqual(['three', 'b']);
    });

    it('tracks a keyed list and a conditional child side by side', async () => {
      const exits = stubExitAnimations();
      const Mixed = ({ ids, footer }: { ids: string[]; footer: boolean }) => (
        <Presence>
          {ids.map((id) => (
            <span key={id}>{id}</span>
          ))}
          {footer && <span key="footer">footer</span>}
        </Presence>
      );
      const { container, rerender } = render(<Mixed ids={['a', 'b']} footer />);
      rerender(<Mixed ids={['b']} footer={false} />);
      expect(shownTexts(container)).toEqual(['a', 'b', 'footer']);
      expect(wrapperOf('b').hasAttribute('data-exiting')).toBe(false);

      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      await waitFor(() => expect(shownTexts(container)).toEqual(['b']));
    });

    it('works under StrictMode: one node per child, removed once the exit finishes', async () => {
      const exits = stubExitAnimations();
      const { container, rerender } = render(<List ids={['a', 'b']} />, { wrapper: StrictMode });
      rerender(<List ids={['a']} />);
      expect(shownTexts(container)).toEqual(['a', 'b']);

      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      await waitFor(() => expect(shownTexts(container)).toEqual(['a']));
    });

    it('can be unmounted in the middle of an exit', async () => {
      const exits = stubExitAnimations();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container, rerender, unmount } = render(<List ids={['a', 'b']} />);
      rerender(<List ids={['a']} />);
      unmount();

      await act(async () => {
        for (const exit of exits) exit.finish();
      });
      expect(container.querySelector('.reveal')).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
