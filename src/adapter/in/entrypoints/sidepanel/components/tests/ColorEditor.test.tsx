import { parseColor } from '@heroui/react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Color } from '../../../../../../domain/color';
import ColorEditor from '../ColorEditor';

// Any React or react-aria complaint (act, controlled/uncontrolled, unknown prop, missing label)
// fails the test it was logged in, and so does an exception thrown by an event handler, which
// React hands to window instead of the caller. Registered before cleanup's hook: afterEach hooks
// run in reverse registration order, so unmounting is checked as well.
const handlerErrors: unknown[] = [];
const recordHandlerError = (event: ErrorEvent) => {
  event.preventDefault();
  handlerErrors.push(event.error ?? event.message);
};
beforeEach(() => {
  vi.spyOn(console, 'error');
  vi.spyOn(console, 'warn');
  window.addEventListener('error', recordHandlerError);
});
afterEach(() => {
  window.removeEventListener('error', recordHandlerError);
  const thrown = handlerErrors.splice(0);
  expect(vi.mocked(console.error).mock.calls).toEqual([]);
  expect(vi.mocked(console.warn).mock.calls).toEqual([]);
  expect(thrown).toEqual([]);
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
});

type EditorProps = ComponentProps<typeof ColorEditor>;

// The editor under a parent that echoes every change back as the new value, as App does through
// its settings state. `echo: false` is a parent that keeps its value whatever is reported.
function renderEditor({
  value = '#3b82f6',
  echo = true,
  ...props
}: Partial<Omit<EditorProps, 'onChange'>> & { echo?: boolean } = {}) {
  const onChange = vi.fn<(color: Color) => void>();
  function Parent({ initial }: { initial: string }) {
    const [current, setCurrent] = useState(initial);
    return (
      <ColorEditor
        hexLabel="Hex"
        {...props}
        value={current}
        onChange={(color) => {
          onChange(color);
          if (echo) setCurrent(color.toHex());
        }}
      />
    );
  }
  render(<Parent initial={value} />);
  return { onChange, hexes: () => onChange.mock.calls.map(([color]) => color.toHex()) };
}

const hexInput = () => screen.getByLabelText('Hex') as HTMLInputElement;
const hexControl = () => hexInput().closest('label') as HTMLLabelElement;
const bead = () => hexControl().querySelector('span[aria-hidden="true"]') as HTMLElement;
// The face exposes its horizontal (saturation) input by role; the vertical one is aria-hidden.
const faceSlider = () =>
  within(screen.getByRole('group', { name: /Saturation and brightness/ })).getByRole('slider') as HTMLInputElement;
const hueSlider = () => within(screen.getByRole('group', { name: 'Hue' })).getByRole('slider') as HTMLInputElement;

// Keyboard focus without a pointer press (a press on the hex control is itself an action).
function focus(element: HTMLElement) {
  act(() => {
    element.focus();
  });
}

describe('ColorEditor', () => {
  describe('hex input', () => {
    it('shows the value on a "color-chip" bead and in the input, and selects the whole value on focus so typing replaces it', () => {
      renderEditor({ value: '#3b82f6' });

      expect(hexInput().value).toBe('#3b82f6');
      expect(bead().classList.contains('color-chip')).toBe(true);
      expect(['#3b82f6', 'rgb(59, 130, 246)']).toContain(bead().style.backgroundColor);

      focus(hexInput());
      expect([hexInput().selectionStart, hexInput().selectionEnd]).toEqual([0, 7]);
    });

    it('commits a complete hex on the keystroke that completes it, not before, and shows it in lowercase', async () => {
      const user = userEvent.setup();
      const { onChange, hexes } = renderEditor();

      await user.click(hexInput());
      await user.keyboard('1A73E');
      expect(onChange).not.toHaveBeenCalled();
      expect(hexInput().value).toBe('1A73E');

      await user.keyboard('8');
      expect(hexes()).toEqual(['#1a73e8']);
      expect(onChange.mock.calls[0]![0]).toBeInstanceOf(Color);
      expect(hexInput().value).toBe('#1a73e8');
      expect(['#1a73e8', 'rgb(26, 115, 232)']).toContain(bead().style.backgroundColor);
    });

    it.each([
      ['with its "#"', '#1a73e8'],
      ['without its "#"', '1a73e8'],
      ['in upper case', '#1A73E8'],
      ['in mixed case without "#"', '1a73E8'],
      ['with surrounding whitespace', '  #1A73E8\t'],
      ['with surrounding whitespace and no "#"', ' 1a73e8 '],
    ])('commits a pasted hex %s as a domain Color with a lowercase hex', (_form, text) => {
      const { onChange, hexes } = renderEditor();

      fireEvent.change(hexInput(), { target: { value: text } });

      expect(hexes()).toEqual(['#1a73e8']);
      expect(onChange.mock.calls[0]![0]).toBeInstanceOf(Color);
      expect(hexInput().value).toBe('#1a73e8');
      expect(hexInput().getAttribute('aria-invalid')).toBeNull();
    });

    it.each([
      ['retyped', '#3b82f6'],
      ['in upper case without "#"', '3B82F6'],
      ['with a trailing space', '#3b82f6 '],
    ])('never calls onChange for the colour already shown (%s)', (_form, text) => {
      const { onChange } = renderEditor({ value: '#3b82f6' });

      fireEvent.change(hexInput(), { target: { value: text } });

      expect(onChange).not.toHaveBeenCalled();
      expect(hexInput().value).toBe('#3b82f6');
    });

    it.each(['', '#', '1', '#12', 'abc', '#abcd', 'ABC12'])(
      'keeps the partial draft %j as typed: not committed, not marked invalid',
      (text) => {
        const { onChange } = renderEditor();

        fireEvent.change(hexInput(), { target: { value: text } });

        expect(onChange).not.toHaveBeenCalled();
        expect(hexInput().value).toBe(text);
        expect(hexInput().getAttribute('aria-invalid')).toBeNull();
        expect(hexInput().className).not.toContain('text-danger');
      },
    );

    it.each(['12zz', 'z', '#1234567', '1234567', '##123', 'rgb(1, 2, 3)', '#12 34'])(
      'marks the draft %j, which cannot become a hex, as invalid and does not commit it',
      (text) => {
        const { onChange } = renderEditor();

        fireEvent.change(hexInput(), { target: { value: text } });

        expect(onChange).not.toHaveBeenCalled();
        expect(hexInput().value).toBe(text);
        expect(hexInput().getAttribute('aria-invalid')).toBe('true');
        expect(hexInput().className).toContain('text-danger');
        // The bead keeps the last valid colour.
        expect(['#3b82f6', 'rgb(59, 130, 246)']).toContain(bead().style.backgroundColor);
      },
    );

    it('clears the invalid mark as soon as the draft can become a hex again', () => {
      renderEditor();

      fireEvent.change(hexInput(), { target: { value: '12zz' } });
      expect(hexInput().getAttribute('aria-invalid')).toBe('true');
      fireEvent.change(hexInput(), { target: { value: '12' } });
      expect(hexInput().getAttribute('aria-invalid')).toBeNull();
    });

    it.each(['12', 'fff', '#abc', '12zz', '#abcd'])(
      'drops the draft %j when focus leaves the field: nothing is written and the value is shown again',
      async (text) => {
        const user = userEvent.setup();
        const { onChange } = renderEditor({ value: '#3b82f6' });

        await user.click(hexInput());
        await user.keyboard(text);
        expect(hexInput().value).toBe(text);
        await user.tab();

        expect(onChange).not.toHaveBeenCalled();
        expect(hexInput().value).toBe('#3b82f6');
        expect(hexInput().getAttribute('aria-invalid')).toBeNull();
      },
    );

    it.each([
      ['12', '123'],
      ['fff', 'fff3'],
      ['#abc', '#abc3'],
      [' ABC', ' ABC3'],
    ])(
      'Enter on the draft %j marks it invalid, keeps it, writes nothing and does not report done; the next edit clears the mark',
      async (text, edited) => {
        const user = userEvent.setup();
        const onDone = vi.fn();
        const { onChange } = renderEditor({ onDone });

        await user.click(hexInput());
        await user.keyboard(text);
        expect(hexInput().getAttribute('aria-invalid')).toBeNull();
        await user.keyboard('{Enter}');

        expect(onDone).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
        expect(hexInput().value).toBe(text);
        expect(hexInput().getAttribute('aria-invalid')).toBe('true');
        expect(hexInput().className).toContain('text-danger');

        await user.keyboard('3');
        expect(hexInput().value).toBe(edited);
        expect(hexInput().getAttribute('aria-invalid')).toBeNull();
        expect(onDone).not.toHaveBeenCalled();
        expect(onChange).not.toHaveBeenCalled();
      },
    );

    it('describes the expected form to assistive technology while the draft is marked as wrong, and only then', async () => {
      const user = userEvent.setup();
      renderEditor();
      const hint = screen.getByText('Enter a hex color like #1a73e8');
      expect(hint.className).toBe('sr-only');
      expect(hexInput().getAttribute('aria-describedby')).toBeNull();

      await user.click(hexInput());
      await user.keyboard('12zz');
      expect(hexInput().getAttribute('aria-invalid')).toBe('true');
      expect(hexInput().getAttribute('aria-describedby')).toBe(hint.id);

      await user.keyboard('{Backspace}{Backspace}');
      expect(hexInput().getAttribute('aria-describedby')).toBeNull();
      await user.keyboard('{Enter}');
      expect(hexInput().getAttribute('aria-describedby')).toBe(hint.id);
    });

    it('keeps a draft as typed while the window is not the focused one, and does not select it on the way back, so a hex left unfinished is typed on', async () => {
      const user = userEvent.setup();
      const { onChange, hexes } = renderEditor();
      await user.click(hexInput());
      await user.keyboard('1a7');

      // Another window comes to the front: the field gets the event it gets when focus leaves it,
      // but stays the document's active element.
      fireEvent.blur(hexInput());
      expect(document.activeElement).toBe(hexInput());
      expect(onChange).not.toHaveBeenCalled();
      expect(hexInput().value).toBe('1a7');

      fireEvent.focus(hexInput());
      expect([hexInput().selectionStart, hexInput().selectionEnd]).toEqual([3, 3]);
      await user.keyboard('3e8');

      expect(hexes()).toEqual(['#1a73e8']);
    });

    it('a rejected draft is forgotten when focus leaves the field: the value comes back unmarked', async () => {
      const user = userEvent.setup();
      renderEditor({ value: '#3b82f6' });

      await user.click(hexInput());
      await user.keyboard('12{Enter}');
      expect(hexInput().getAttribute('aria-invalid')).toBe('true');
      await user.tab();

      expect(hexInput().value).toBe('#3b82f6');
      expect(hexInput().getAttribute('aria-invalid')).toBeNull();
    });

    it('Enter with no draft in the field reports done once and writes nothing; other keys do not', async () => {
      const user = userEvent.setup();
      const onDone = vi.fn();
      const { onChange } = renderEditor({ onDone });

      await user.click(hexInput());
      await user.keyboard('{ArrowLeft}{Home}a{Backspace}');
      expect(onDone).not.toHaveBeenCalled();

      fireEvent.change(hexInput(), { target: { value: '#1a73e8' } });
      onChange.mockClear();
      await user.keyboard('{Enter}');

      expect(onDone.mock.calls).toEqual([[]]);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('the hex control among alternatives', () => {
    const RING = ['ring-2', 'ring-focus', 'ring-offset-2', 'ring-offset-overlay'];

    it('is a label holding the input directly, marked "hex-control" and "outlined-control", the hooks style.css uses for its focus ring and dark-theme border', () => {
      renderEditor();

      expect(hexControl().tagName).toBe('LABEL');
      expect(hexInput().parentElement).toBe(hexControl());
      expect(hexControl().classList.contains('hex-control')).toBe(true);
      expect(hexControl().classList.contains('outlined-control')).toBe(true);
    });

    it('wears the gapped selection ring when active', () => {
      renderEditor({ active: true });

      for (const className of RING) expect(hexControl().classList.contains(className), className).toBe(true);
    });

    it.each([
      ['false', false],
      ['absent', undefined],
    ])('has no ring when active is %s', (_label, active) => {
      renderEditor({ active });

      for (const className of RING) expect(hexControl().classList.contains(className), className).toBe(false);
    });

    it('calls onActivate for a primary-button press anywhere on the control', () => {
      const onActivate = vi.fn();
      renderEditor({ active: false, onActivate });

      fireEvent.pointerDown(hexControl(), { button: 0 });
      fireEvent.pointerDown(bead(), { button: 0 });
      fireEvent.pointerDown(hexInput(), { button: 0 });

      expect(onActivate).toHaveBeenCalledTimes(3);
    });

    it.each([
      ['the secondary button (a right click to paste)', 2],
      ['the middle button', 1],
    ])('does not call onActivate for a press with %s', (_label, button) => {
      const onActivate = vi.fn();
      renderEditor({ active: false, onActivate });

      fireEvent.pointerDown(hexInput(), { button });

      expect(onActivate).not.toHaveBeenCalled();
    });

    // The picker decides what a press on the choice already in use does: nothing, unless the
    // selection still holds a reference the palette no longer honours, which the press drops.
    it('calls onActivate for a primary-button press while active as well', () => {
      const onActivate = vi.fn();
      renderEditor({ active: true, onActivate });

      fireEvent.pointerDown(hexInput(), { button: 0 });

      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('does not call onActivate for keyboard focus, or for a press on the well', async () => {
      const user = userEvent.setup();
      const onActivate = vi.fn();
      renderEditor({ active: false, onActivate });
      await user.tab();
      expect(document.activeElement).toBe(hexInput());
      fireEvent.pointerDown(screen.getByRole('group', { name: 'Hue' }), { button: 0 });
      fireEvent.pointerDown(document.querySelector('.color-well')!, { button: 0 });
      expect(onActivate).not.toHaveBeenCalled();
    });
  });

  describe('the well', () => {
    it('ArrowLeft on the face reports one change, a domain Color one saturation step down', async () => {
      const user = userEvent.setup();
      const { onChange, hexes } = renderEditor({ value: '#ff0000' });

      focus(faceSlider());
      await user.keyboard('{ArrowLeft}');

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0]).toBeInstanceOf(Color);
      // hsb(0, 99%, 100%)
      expect(hexes()).toEqual(['#ff0303']);
      expect(hexInput().value).toBe('#ff0303');
    });

    it('ArrowDown on the face reports one change, one brightness step down', async () => {
      const user = userEvent.setup();
      const { hexes } = renderEditor({ value: '#ff0000' });

      focus(faceSlider());
      await user.keyboard('{ArrowDown}');

      // hsb(0, 100%, 99%)
      expect(hexes()).toEqual(['#fc0000']);
    });

    it('ArrowRight on the hue strip reports one change, a domain Color one degree on', async () => {
      const user = userEvent.setup();
      const { onChange, hexes } = renderEditor({ value: '#ff0000' });

      focus(hueSlider());
      await user.keyboard('{ArrowRight}');

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0]).toBeInstanceOf(Color);
      // hsb(1, 100%, 100%)
      expect(hexes()).toEqual(['#ff0400']);
      expect(hueSlider().value).toBe('1');
    });

    it('a press on the face reports the colour under the pointer', () => {
      const { hexes } = renderEditor({ value: '#ff0000' });
      const face = screen.getByRole('group', { name: /Saturation and brightness/ });
      // jsdom lays nothing out; react-aria maps the pointer over this rect.
      face.getBoundingClientRect = () => new DOMRect(0, 0, 200, 140);

      fireEvent.pointerDown(face, {
        clientX: 100,
        clientY: 70,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
      });
      fireEvent.pointerUp(document, { clientX: 100, clientY: 70, pointerId: 1, pointerType: 'mouse', button: 0 });

      // hsb(0, 50%, 50%)
      expect(hexes()).toEqual(['#804040']);
    });

    it.each([
      ['a draft', 'abc', false],
      ['a draft marked as wrong by Enter', '12', true],
    ])(
      'a press on the well with %s in the field reports the colour under the pointer alone, and the field shows it unmarked',
      async (_case, text, enter) => {
        const user = userEvent.setup();
        const { hexes } = renderEditor({ value: '#ff0000' });
        const face = screen.getByRole('group', { name: /Saturation and brightness/ });
        face.getBoundingClientRect = () => new DOMRect(0, 0, 200, 140);
        await user.click(hexInput());
        await user.keyboard(text);
        if (enter) await user.keyboard('{Enter}');
        expect(hexInput().getAttribute('aria-invalid')).toBe(enter ? 'true' : null);

        const at = { clientX: 100, clientY: 70, pointerId: 1, pointerType: 'mouse', button: 0 };
        fireEvent.pointerDown(face, { ...at, buttons: 1 });
        // The press takes focus from the field, as it does in a browser.
        focus(faceSlider());
        fireEvent.pointerUp(document, at);

        expect(hexes()).toEqual(['#804040']);
        expect(hexInput().value).toBe('#804040');
        expect(hexInput().getAttribute('aria-invalid')).toBeNull();
      },
    );

    it('keeps the hue through a grey: desaturating to nothing and back returns to the same hue, not to red', async () => {
      const user = userEvent.setup();
      const { hexes } = renderEditor({ value: '#3b82f6' });
      expect(hueSlider().value).toBe('217');

      focus(faceSlider());
      await user.keyboard('{ArrowLeft>80/}');
      expect(hexInput().value).toBe('#f6f6f6');
      expect(hueSlider().value).toBe('217');
      expect(hueSlider().getAttribute('aria-valuetext')).toContain('217.22°');

      await user.keyboard('{ArrowRight>80/}');
      // hsb(217.22, 80%, 96.47%): the blue it came from, where a hue lost at the grey gives a red.
      expect(hexInput().value).toBe('#317cf6');
      expect(hueSlider().value).toBe('217');
      expect(hexes().at(-1)).toBe('#317cf6');
    });

    it('keeps the hue through black', async () => {
      const user = userEvent.setup();
      renderEditor({ value: '#3b82f6' });

      focus(faceSlider());
      await user.keyboard('{ArrowDown>100/}');
      expect(hexInput().value).toBe('#000000');
      expect(hueSlider().value).toBe('217');

      await user.keyboard('{ArrowUp>50/}');
      expect(hueSlider().value).toBe('217');
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hexInput().value.slice(i, i + 2), 16));
      expect(b!).toBeGreaterThan(g!);
      expect(g!).toBeGreaterThan(r!);
    });

    it('turning the hue of a grey moves the hue thumb without reporting a change (the hex is the same)', async () => {
      const user = userEvent.setup();
      const { onChange } = renderEditor({ value: '#808080' });

      focus(hueSlider());
      await user.keyboard('{ArrowRight>30/}');

      expect(onChange).not.toHaveBeenCalled();
      expect(hueSlider().value).toBe('30');
      expect(hexInput().value).toBe('#808080');
    });

    it('re-syncs the well, the bead and the input when the parent hands over another colour', () => {
      const { rerender } = render(<ColorEditor hexLabel="Hex" value="#3b82f6" onChange={() => {}} />);
      expect(hueSlider().value).toBe('217');

      rerender(<ColorEditor hexLabel="Hex" value="#00ff00" onChange={() => {}} />);

      expect(hexInput().value).toBe('#00ff00');
      expect(hueSlider().value).toBe('120');
      expect(faceSlider().value).toBe('100');
      expect(['#00ff00', 'rgb(0, 255, 0)']).toContain(bead().style.backgroundColor);
    });

    it('follows a parent that does not take the change: the well returns to the value', async () => {
      const user = userEvent.setup();
      const { onChange } = renderEditor({ value: '#ff0000', echo: false });

      focus(hueSlider());
      await user.keyboard('{ArrowRight}');

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(hueSlider().value).toBe('0');
      expect(hexInput().value).toBe('#ff0000');
    });
  });

  describe('render-time sync with the parent', () => {
    // The editor compares the hex of its HSB state with the value on every render and adopts the
    // value when they differ. That terminates only because hex -> HSB -> hex is the identity; a
    // dependency whose rounding breaks it would re-render without end ("Too many re-renders").
    const EXTREMES = [
      '#000000',
      '#ffffff',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ffff00',
      '#00ffff',
      '#ff00ff',
      '#808080',
      '#7f7f7f',
      '#010101',
      '#fefefe',
      '#010000',
      '#000100',
      '#000001',
      '#fffffe',
      '#ff6d00',
      '#d93025',
    ];
    // 0x00000b is coprime with 2^24 and the stride walks every channel through uneven values.
    const SPREAD = Array.from(
      { length: 400 },
      (_, i) => `#${((i * 0x9e3779 + 0x00000b) % 0x1000000).toString(16).padStart(6, '0')}`,
    );

    it('a lowercase hex survives the trip through HSB and back unchanged, for the extremes and a spread of 400 colours', () => {
      const changed = [...EXTREMES, ...SPREAD].filter(
        (hex) => parseColor(hex).toFormat('hsb').toString('hex').toLowerCase() !== hex,
      );

      expect(changed).toEqual([]);
    });
  });
});
