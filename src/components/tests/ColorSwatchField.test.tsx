import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ColorSwatchField from '../ColorSwatchField';

afterEach(() => {
  cleanup();
});

describe('ColorSwatchField', () => {
  it('adds the "hidden @min-[220px]:inline" classes to the hex span when hexHidableOnNarrow is true', () => {
    render(<ColorSwatchField ariaLabel="Test color" value="#ff0000" onChange={() => {}} hexHidableOnNarrow />);

    const hexSpan = screen.getByText('#ff0000');
    expect(hexSpan.className).toContain('hidden');
    expect(hexSpan.className).toContain('@min-[220px]:inline');
  });

  it('omits the "hidden @min-[220px]:inline" classes from the hex span when hexHidableOnNarrow is false/absent', () => {
    render(<ColorSwatchField ariaLabel="Test color" value="#ff0000" onChange={() => {}} />);

    const hexSpan = screen.getByText('#ff0000');
    expect(hexSpan.className).not.toContain('hidden');
    expect(hexSpan.className).not.toContain('@min-[220px]:inline');
  });

  it('adds a "ring-2 ring-focus" ring to the wrapping label when active is true', () => {
    render(<ColorSwatchField ariaLabel="Test color" value="#ff0000" onChange={() => {}} active />);

    const input = screen.getByLabelText('Test color');
    const label = input.closest('label');
    expect(label).toBeTruthy();
    expect(label!.className).toContain('ring-2');
    expect(label!.className).toContain('ring-focus');
  });

  it('omits the ring from the wrapping label when active is false/absent', () => {
    render(<ColorSwatchField ariaLabel="Test color" value="#ff0000" onChange={() => {}} />);

    const input = screen.getByLabelText('Test color');
    const label = input.closest('label');
    expect(label).toBeTruthy();
    expect(label!.className).not.toContain('ring-2');
    expect(label!.className).not.toContain('ring-focus');
  });

  it('wraps the color input and the hex text in the same <label>, so clicking the hex text (native label click-delegation) activates the input', () => {
    render(<ColorSwatchField ariaLabel="Test color" value="#ff0000" onChange={() => {}} />);

    const input = screen.getByLabelText('Test color') as HTMLInputElement;
    expect(input.type).toBe('color');

    const hexSpan = screen.getByText('#ff0000');
    const label = input.closest('label');
    expect(label).toBeTruthy();
    // Both the input and the hex text are descendants of the same <label>: this is the
    // structural precondition for native label click-delegation (clicking the label, or any
    // non-interactive descendant like the hex span, activates the wrapped input).
    expect(label).toBe(hexSpan.closest('label'));
    expect(label!.contains(input)).toBe(true);
    expect(label!.contains(hexSpan)).toBe(true);
  });
});
