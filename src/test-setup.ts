// jsdom (unlike real browsers) doesn't implement CSS.escape, which react-aria's collection
// selection utilities call when scrolling a newly-selected item into view — a path any HeroUI
// Select/ListBox/Menu/GridList/Table exercises once an option is actually selected in a test.
// The escaping itself is irrelevant here: every key these controls select on (matchType
// strings, crypto.randomUUID() ids) is already a valid, unescaped CSS identifier.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as { CSS?: Pick<typeof CSS, 'escape'> }).CSS = { escape: (value: string) => value };
}

// Same kind of gap: jsdom has no ResizeObserver. HeroUI's ScrollShadow constructs one on mount to
// decide whether its overflow chevrons apply, and Tabs.ListContainer (the side panel's Rules /
// Settings switch) renders a ScrollShadow around the tab list, so every test that renders the list
// view would otherwise throw. Nothing in these tests depends on measured sizes, so a no-op observer
// is enough: with no callback ever firing, ScrollShadow keeps its initial "no overflow" state.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// And one more: jsdom implements no Web Animations API, so Element.getAnimations is missing.
// react-aria's SharedElementTransition — which drives the Tabs indicator's slide between tabs —
// calls it on every selection change to wait out any in-flight animation. Returning "nothing is
// animating" makes that transition resolve immediately, which is what a test wants anyway.
if (typeof Element.prototype.getAnimations === 'undefined') {
  Element.prototype.getAnimations = () => [];
}
