import {
  Children,
  type CSSProperties,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

type Item = { key: string; element: ReactElement; entering: boolean; exiting: boolean };

// Children.toArray gives every element a key that is stable for a given JSX structure: an explicit
// key becomes `.$key`, a child without one gets its position. Strings, numbers and nulls are not
// tracked, so a conditional child that is currently `false` simply counts as absent.
function toElements(children: ReactNode): ReactElement[] {
  return Children.toArray(children).filter(isValidElement);
}

// Folds the children of this render into the list shown so far. A key that was not there before
// enters; a key that is gone stays in the list as `exiting`, still showing the element it had
// last. `prev === null` is the first render, where nothing enters: content that is simply there
// when a view opens must not animate.
function merge(prev: Item[] | null, current: ReactElement[]): Item[] {
  const known = new Set(prev?.map((item) => item.key));
  const out: Item[] = current.map((element) => {
    const key = String(element.key);
    return { key, element, entering: prev !== null && !known.has(key), exiting: false };
  });
  prev?.forEach((item, index) => {
    if (out.some((o) => o.key === item.key)) return;
    // A leaving child keeps its place: right after the nearest earlier sibling that is still in
    // the list (leaving ones included, so several neighbours that leave together keep their order).
    const anchor = prev.slice(0, index).findLast((p) => out.some((o) => o.key === p.key));
    out.splice(anchor ? out.findIndex((o) => o.key === anchor.key) + 1 : 0, 0, { ...item, exiting: true });
  });
  return out;
}

function PresenceItem({ item, gap, onExited }: { item: Item; gap?: string; onExited: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { key, exiting } = item;
  // Read once, at mount. The attribute lives for a single style flush, the way react-aria marks an
  // entering tab panel: the collapsed style is computed with it, then it is removed before the
  // first paint and the wrapper's own transition opens it. Nothing stays behind on the node, so
  // moving it later (React reorders keyed children with insertBefore) cannot replay the enter.
  const [entering, setEntering] = useState(item.entering);
  useLayoutEffect(() => {
    if (!entering) return;
    ref.current?.getAnimations(); // flushes style
    setEntering(false);
  }, [entering]);

  useLayoutEffect(() => {
    if (!exiting) return;
    // getAnimations() flushes style, so the transitions declared for [data-exiting] are running
    // by the time it returns. It lists the wrapper's own animations only. None (a hidden
    // ancestor, jsdom) means there is nothing to wait for. `finished` rejects when a transition
    // is cancelled, hence allSettled: a wrapper that gets hidden or restyled halfway still
    // leaves.
    const animations = ref.current?.getAnimations() ?? [];
    if (animations.length === 0) {
      onExited(key);
      return;
    }
    let cancelled = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (!cancelled) onExited(key);
    });
    // Runs when the key comes back before the exit is over, and on unmount.
    return () => {
      cancelled = true;
    };
  }, [exiting, key, onExited]);

  return (
    <div
      ref={ref}
      className="reveal"
      style={gap ? ({ '--reveal-gap': gap } as CSSProperties) : undefined}
      data-entering={entering || undefined}
      data-exiting={exiting || undefined}
      // A leaving child still renders its last props and handlers. `inert` takes it out of hit
      // testing, the tab order and the accessibility tree, so nothing in it can be reached.
      inert={exiting}
    >
      {/* The grid item that shrinks. It carries only the 4px of focus-ring room (block padding
          cancelled by an equal negative margin, see style.css). Any other padding or border on it
          would keep the 0fr row from collapsing, so the child's own box sits one level further
          in. */}
      <div>{item.element}</div>
    </div>
  );
}

/**
 * Animates keyed children in and out; the motion itself is the `.reveal` rules in style.css.
 *
 * - Mapped children need keys. A single conditional child is tracked by its position, so its key
 *   is optional but harmless.
 * - Children present at the first render do not animate. One that appears later is mounted with
 *   `data-entering` for one style flush. One that disappears stays mounted, `inert` and marked
 *   `data-exiting`, until the transitions on its wrapper have finished.
 * - Each child is wrapped in two divs, so the parent's direct children are the wrappers.
 * - `gap` is the flex gap of the parent when it is not the default 0.5rem: a collapsed wrapper
 *   still takes one gap, which the CSS cancels with a negative margin.
 */
export function Presence({ children, gap }: { children: ReactNode; gap?: string }) {
  // What is on screen is the children of this render plus the ones still leaving, so it has to
  // be remembered between renders. It is state adjusted during render, keyed on the identity of
  // `children`: a parent render brings a new `children` and is merged once (React re-runs this
  // function right away with the stored result); a render caused by `remove` below sees the same
  // `children` and keeps the list. A ref written during render would be no shorter, and it would
  // keep the result of a render that React throws away.
  const [state, setState] = useState(() => ({ children, items: merge(null, toElements(children)) }));
  let { items } = state;
  if (state.children !== children) {
    items = merge(items, toElements(children));
    setState({ children, items });
  }
  // Called by a child whose exit is over. A child that came back in the meantime never calls it:
  // its effect cleanup has cancelled the wait.
  const remove = useCallback((key: string) => {
    setState((s) => ({ ...s, items: s.items.filter((item) => item.key !== key) }));
  }, []);
  return items.map((item) => <PresenceItem key={item.key} item={item} gap={gap} onExited={remove} />);
}
