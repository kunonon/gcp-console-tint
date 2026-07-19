// jsdom (unlike real browsers) doesn't implement CSS.escape, which react-aria's collection
// selection utilities call when scrolling a newly-selected item into view — a path any HeroUI
// Select/ListBox/Menu/GridList/Table exercises once an option is actually selected in a test.
// The escaping itself is irrelevant here: every key these controls select on (matchType
// strings, crypto.randomUUID() ids) is already a valid, unescaped CSS identifier.
if (typeof globalThis.CSS === 'undefined') {
  (globalThis as { CSS?: Pick<typeof CSS, 'escape'> }).CSS = { escape: (value: string) => value };
}
