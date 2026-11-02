import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, type RefObject, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '../../../../../../domain/color';
import { type Fill, Gradient } from '../../../../../../domain/gradient';
import { fillStripImage } from '../../../../fill-css';
import FillEditor, { type KeptGradient } from '../FillEditor';

afterEach(() => {
  cleanup();
});

const hex = (value: string) => Color.fromHex(value)!;
// Stops at the given positions, or spread evenly over the bar when the colors come alone.
const at = (...stops: [string, number][]) =>
  Gradient.fromStops(stops.map(([color, position]) => ({ color: hex(color), position })))!;
const gradient = (...hexes: string[]) =>
  at(...hexes.map((color, i): [string, number] => [color, Math.round((i * 100) / (hexes.length - 1))]));
// Seven stops of distinct colors at the given positions.
const spaced = (...positions: number[]) =>
  at(...positions.map((position, i): [string, number] => [`#${String(i).repeat(6)}`, position]));

type EditorProps = ComponentProps<typeof FillEditor>;

// FillEditor is controlled: the stops it adds only show once the parent holds the new fill, as
// App's synchronous save does. `onChange` records every call.
function Harness({ initial, ...props }: { initial: Fill } & Partial<EditorProps>) {
  const [value, setValue] = useState(initial);
  const [lastGradient] = useState<RefObject<KeptGradient | null>>(() => ({ current: null }));
  return (
    <FillEditor
      hexLabel="Hex"
      typeLabel="Color type"
      lastGradient={lastGradient}
      {...props}
      value={value}
      onChange={(fill) => {
        props.onChange?.(fill);
        setValue(fill);
      }}
    />
  );
}

function renderEditor(initial: Fill, props: Partial<EditorProps> = {}) {
  const user = userEvent.setup();
  const onChange = vi.fn<(fill: Fill) => void>();
  const result = render(<Harness initial={initial} onChange={onChange} {...props} />);
  return { user, onChange, ...result };
}

const stopsRow = () => screen.getByRole('group', { name: 'Gradient stops' });
// An end stop is a button, an inner one a slider; both are named "Stop N".
const stop = (n: number) => within(stopsRow()).getByLabelText(`Stop ${n}`);
const strip = () => stopsRow().querySelector('.fill-strip') as HTMLElement;
const positionInput = () => screen.getByLabelText(/^Stop \d+ position$/) as HTMLInputElement;
const addButton = () => screen.getByRole('button', { name: 'Add stop' });
const removeButton = () => screen.getByRole('button', { name: 'Remove stop' });
const modeGroup = () => screen.getByRole('radiogroup', { name: 'Color type' });
const mode = (name: 'Solid' | 'Gradient') => within(modeGroup()).getByRole('radio', { name });
const picked = (n: number) => stop(n).getAttribute('data-selected') === 'true';
const lastFill = (onChange: { mock: { calls: [Fill][] } }) => onChange.mock.calls.at(-1)?.[0];
// A style value as jsdom normalises it (it reorders a calc() product, and may write colours as rgb()).
const normalised = (property: 'left' | 'backgroundImage', value: string) => {
  const probe = document.createElement('div');
  probe.style[property] = value;
  return probe.style[property];
};
const beadLeft = (position: number) => normalised('left', `calc(12px + (100% - 24px) * ${position / 100})`);

describe('FillEditor', () => {
  describe('modes', () => {
    it('shows a colour as Solid: the switch says so, and there is no strip, no position and no Add or Remove', () => {
      renderEditor(hex('#ff6d00'));

      expect(mode('Solid').getAttribute('aria-checked')).toBe('true');
      expect(mode('Gradient').getAttribute('aria-checked')).toBe('false');
      expect(screen.queryByRole('group', { name: 'Gradient stops' })).toBeNull();
      expect(screen.queryByLabelText(/position$/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add stop' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Remove stop' })).toBeNull();
      expect(screen.getByLabelText('Hex')).toBeTruthy();
      // The face takes the rows' height (style.css keys it on data-mode).
      expect(modeGroup().closest('.fill-editor')?.getAttribute('data-mode')).toBe('solid');
    });

    it('Gradient on a colour makes a gradient of it twice in one change, with stop 2 picked and focus left on the switch', async () => {
      const { user, onChange } = renderEditor(hex('#ff6d00'));

      await user.click(mode('Gradient'));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0]).toEqual(at(['#ff6d00', 0], ['#ff6d00', 100]));
      expect(mode('Gradient').getAttribute('aria-checked')).toBe('true');
      expect(picked(2)).toBe(true);
      expect(stop(2).className).toContain('h-5 w-5');
      expect(picked(1)).toBe(false);
      expect(stop(1).className).toContain('h-4 w-4');
      // The picked stop is marked by size, never by the ring that means "in use".
      expect(stop(2).className).not.toContain('ring-2');
      expect(screen.getByLabelText('Hex, stop 2')).toBeTruthy();
      expect(document.activeElement).toBe(mode('Gradient'));
      expect(modeGroup().closest('.fill-editor')?.getAttribute('data-mode')).toBe('gradient');
    });

    it('Solid on a gradient takes the picked stop’s colour and keeps the gradient in the ref; Gradient brings it back with that stop picked', async () => {
      const lastGradient: RefObject<KeptGradient | null> = { current: null };
      const kept = gradient('#000000', '#111111', '#222222', '#333333');
      const { user, onChange } = renderEditor(kept, { lastGradient });

      await user.click(stop(3));
      await user.click(mode('Solid'));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(hex('#222222'));
      expect(lastGradient.current).toEqual({ gradient: kept, index: 2 });

      await user.click(mode('Gradient'));
      expect(onChange).toHaveBeenCalledTimes(2);
      expect((lastFill(onChange) as Gradient).equals(kept)).toBe(true);
      expect(picked(3)).toBe(true);
      expect(screen.getByLabelText('Hex, stop 3')).toBeTruthy();
    });

    it('a colour changed while Solid comes back as the picked stop’s colour, the other stops as they were', async () => {
      const { user, onChange } = renderEditor(gradient('#000000', '#111111', '#222222', '#333333'));

      await user.click(stop(3));
      await user.click(mode('Solid'));
      fireEvent.change(screen.getByLabelText('Hex'), { target: { value: '#abcdef' } });
      await user.click(mode('Gradient'));

      expect(lastFill(onChange)).toEqual(gradient('#000000', '#111111', '#abcdef', '#333333'));
    });

    it('keeps the colour being edited on the way there and back: c, then [c, c], stop 2 set to d, Solid d, Gradient [c, d]', async () => {
      const { user, onChange } = renderEditor(hex('#123456'));

      await user.click(mode('Gradient'));
      fireEvent.change(screen.getByLabelText('Hex, stop 2'), { target: { value: '#abcdef' } });
      await user.click(mode('Solid'));
      expect(lastFill(onChange)).toEqual(hex('#abcdef'));
      expect((screen.getByLabelText('Hex') as HTMLInputElement).value).toBe('#abcdef');

      await user.click(mode('Gradient'));
      expect(lastFill(onChange)).toEqual(at(['#123456', 0], ['#abcdef', 100]));
      expect(picked(2)).toBe(true);
    });

    it('remembers the gradient and its picked stop through the ref it is given, across an unmount; a fresh ref starts from [c, c]', async () => {
      const user = userEvent.setup();
      const lastGradient: RefObject<KeptGradient | null> = { current: null };
      const kept = gradient('#000000', '#111111', '#222222', '#333333');
      const first = render(<Harness initial={kept} lastGradient={lastGradient} />);
      await user.click(stop(3));
      await user.click(mode('Solid'));
      first.unmount();

      // The remount picks Stop 1, as a reopened popover does: the way back is the ref's stop.
      const onChange = vi.fn<(fill: Fill) => void>();
      const second = render(<Harness initial={hex('#222222')} lastGradient={lastGradient} onChange={onChange} />);
      await user.click(mode('Gradient'));
      expect((lastFill(onChange) as Gradient).equals(kept)).toBe(true);
      expect(picked(3)).toBe(true);
      second.unmount();

      const fresh = vi.fn<(fill: Fill) => void>();
      render(<Harness initial={hex('#000000')} lastGradient={{ current: null }} onChange={fresh} />);
      await user.click(mode('Gradient'));
      expect(lastFill(fresh)).toEqual(at(['#000000', 0], ['#000000', 100]));
    });

    it('follows a value changed from outside without a change of its own, and keeps nothing of the gradient it left', () => {
      const lastGradient: RefObject<KeptGradient | null> = { current: null };
      const onChange = vi.fn();
      const props = { hexLabel: 'Hex', typeLabel: 'Color type', lastGradient, onChange };
      const { rerender } = render(<FillEditor {...props} value={gradient('#000000', '#ffffff')} />);
      expect(mode('Gradient').getAttribute('aria-checked')).toBe('true');

      rerender(<FillEditor {...props} value={hex('#000000')} />);

      expect(mode('Solid').getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByRole('group', { name: 'Gradient stops' })).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
      expect(lastGradient.current).toBeNull();
    });

    it.each([
      ['Solid', hex('#ff6d00')],
      ['Gradient', gradient('#000000', '#ffffff')],
    ] as const)('a press on the checked %s is a press on the fill: onActivate once, no change', async (name, value) => {
      const onActivate = vi.fn();
      const { user, onChange } = renderEditor(value, { onActivate });

      await user.click(mode(name));

      expect(onActivate).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('is one Tab stop on the checked option from either side; the arrow keys move focus only, Space switches', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn<(fill: Fill) => void>();
      render(
        <>
          <button type="button">before</button>
          <Harness initial={gradient('#000000', '#ffffff')} onChange={onChange} />
        </>,
      );
      expect(mode('Solid').getAttribute('tabindex')).toBe('-1');

      await user.tab();
      await user.tab();
      expect(document.activeElement).toBe(mode('Gradient'));
      await user.tab();
      expect(document.activeElement).toBe(stop(1));
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(mode('Gradient'));

      await user.keyboard('{ArrowLeft}');
      expect(document.activeElement).toBe(mode('Solid'));
      await user.keyboard('{ArrowRight}');
      expect(document.activeElement).toBe(mode('Gradient'));
      await user.keyboard('{ArrowLeft}');
      expect(onChange).not.toHaveBeenCalled();

      await user.keyboard(' ');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(hex('#000000'));
      expect(document.activeElement).toBe(mode('Solid'));
      expect(mode('Solid').hasAttribute('tabindex') && mode('Solid').getAttribute('tabindex')).not.toBe('-1');
      expect(mode('Gradient').getAttribute('tabindex')).toBe('-1');
    });

    it('keeps the DOM shape style.css (.fill-mode) slides the thumb by: two options as the only children', () => {
      renderEditor(hex('#ff6d00'));

      expect(Array.from(modeGroup().children).map((child) => [child.getAttribute('role'), child.textContent])).toEqual([
        ['radio', 'Solid'],
        ['radio', 'Gradient'],
      ]);
      expect(modeGroup().classList.contains('fill-mode')).toBe(true);
      expect(mode('Solid').classList.contains('toggle-button')).toBe(true);
      expect(mode('Solid').getAttribute('data-selected')).toBe('true');
    });

    it('has neither the switch, nor the rows, nor a mode under solidOnly', () => {
      renderEditor(hex('#ff6d00'), { solidOnly: true });

      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(screen.queryByRole('group', { name: 'Gradient stops' })).toBeNull();
      const hexInput = screen.getByLabelText('Hex');
      expect(hexInput.closest('.fill-editor')?.hasAttribute('data-mode')).toBe(false);
    });
  });

  describe('stops', () => {
    it('makes the ends buttons and the inner stops sliders, in stop order', () => {
      renderEditor(at(['#000000', 0], ['#111111', 40], ['#222222', 100]));

      expect(stop(1).tagName).toBe('BUTTON');
      expect(stop(3).tagName).toBe('BUTTON');
      const inner = within(stopsRow()).getByRole('slider', { name: 'Stop 2' });
      expect(inner).toBe(stop(2));
      expect(
        ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].map((a) => inner.getAttribute(a)),
      ).toEqual(['1', '99', '40', '40%']);
      expect(inner.style.left).toBe(beadLeft(40));
      expect(picked(1)).toBe(true);
      expect(stop(1).getAttribute('aria-pressed')).toBe('true');
      expect(inner.getAttribute('aria-current')).toBeNull();

      fireEvent.click(inner);
      expect(inner.getAttribute('aria-current')).toBe('true');
      expect(stop(1).getAttribute('aria-pressed')).toBe('false');
    });

    it('picks no stop on Tab focus; Enter or Space on an inner stop picks it, with onActivate once', async () => {
      const onActivate = vi.fn();
      const { user } = renderEditor(at(['#000000', 0], ['#111111', 40], ['#222222', 60], ['#333333', 100]), {
        onActivate,
      });

      act(() => stop(2).focus());
      expect(picked(1)).toBe(true);
      await user.keyboard('{Enter}');
      expect(picked(2)).toBe(true);
      expect(onActivate).toHaveBeenCalledTimes(1);

      act(() => stop(3).focus());
      await user.keyboard(' ');
      expect(picked(3)).toBe(true);
      expect(onActivate).toHaveBeenCalledTimes(2);
    });

    it('hands a primary press on the strip or on a stop to onActivate, once each', async () => {
      const onActivate = vi.fn();
      const { user } = renderEditor(at(['#000000', 0], ['#111111', 50], ['#222222', 100]), { onActivate });

      fireEvent.pointerDown(strip(), { button: 0 });
      expect(onActivate).toHaveBeenCalledTimes(1);

      await user.click(stop(3));
      expect(onActivate).toHaveBeenCalledTimes(2);

      // The inner stop's own press, not the strip's as well.
      await user.click(stop(2));
      expect(onActivate).toHaveBeenCalledTimes(3);
      expect(picked(2)).toBe(true);

      await user.click(addButton());
      expect(onActivate).toHaveBeenCalledTimes(3);
    });

    it('picks an inner stop on a click alone (assistive technology), and does nothing for the picked one', () => {
      const onActivate = vi.fn();
      renderEditor(at(['#000000', 0], ['#111111', 50], ['#222222', 100]), { onActivate });

      fireEvent.click(stop(2));
      expect(picked(2)).toBe(true);
      expect(onActivate).toHaveBeenCalledTimes(1);

      fireEvent.click(stop(2));
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('paints the strip with longhands: the first stop as the colour, the gradient in the beads’ box as the image', () => {
      const value = gradient('#ff6d00', '#1a73e8');
      renderEditor(value);

      expect(['#ff6d00', 'rgb(255, 109, 0)']).toContain(strip().style.backgroundColor);
      expect(strip().style.backgroundImage).toBe(normalised('backgroundImage', fillStripImage(value, 13)));
    });

    it('moves focus neither on mount nor when the value changes from outside', () => {
      const props = { hexLabel: 'Hex', typeLabel: 'Color type', lastGradient: { current: null }, onChange: () => {} };
      const { rerender } = render(<FillEditor {...props} value={gradient('#000000', '#111111', '#222222')} />);
      expect(document.activeElement).toBe(document.body);

      rerender(<FillEditor {...props} value={gradient('#000000', '#111111')} />);
      expect(document.activeElement).toBe(document.body);
    });

    it('keeps the last stop picked when the value shrinks from outside', async () => {
      const user = userEvent.setup();
      const props = { hexLabel: 'Hex', typeLabel: 'Color type', lastGradient: { current: null }, onChange: () => {} };
      const { rerender } = render(<FillEditor {...props} value={gradient('#000000', '#111111', '#222222')} />);
      await user.click(stop(3));

      rerender(<FillEditor {...props} value={gradient('#000000', '#111111')} />);

      expect(picked(2)).toBe(true);
      expect((screen.getByLabelText('Hex, stop 2') as HTMLInputElement).value).toBe('#111111');
    });

    it('edits the picked stop through the hex input, named after the stop', async () => {
      const { user, onChange } = renderEditor(gradient('#000000', '#111111'));
      expect(screen.getByLabelText('Hex, stop 1')).toBeTruthy();

      await user.click(stop(2));
      fireEvent.change(screen.getByLabelText('Hex, stop 2'), { target: { value: '#abcdef' } });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0]![0]).toEqual(gradient('#000000', '#abcdef'));
    });

    it('calls onDone for Enter in the hex input', async () => {
      const onDone = vi.fn();
      const { user } = renderEditor(gradient('#000000', '#111111'), { onDone });

      await user.click(screen.getByLabelText('Hex, stop 1'));
      await user.keyboard('{Enter}');

      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard moves', () => {
    const three = () => at(['#000000', 0], ['#111111', 50], ['#222222', 100]);

    it.each([
      ['ArrowRight', {}, 51],
      ['ArrowUp', {}, 51],
      ['ArrowLeft', {}, 49],
      ['ArrowDown', {}, 49],
      ['ArrowRight', { shiftKey: true }, 60],
      ['ArrowLeft', { shiftKey: true }, 40],
      ['PageUp', {}, 60],
      ['PageDown', {}, 40],
      ['Home', {}, 1],
      ['End', {}, 99],
    ])('%s %o moves the stop to %i on screen, and saves it once on keyup', (key, modifiers, position) => {
      const { onChange } = renderEditor(three());

      const handled = fireEvent.keyDown(stop(2), { key, ...modifiers });
      // Prevented, so the dialog does not scroll.
      expect(handled).toBe(false);
      expect(stop(2).getAttribute('aria-valuenow')).toBe(String(position));
      expect(onChange).not.toHaveBeenCalled();

      fireEvent.keyUp(stop(2), { key, ...modifiers });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', position], ['#222222', 100]));
    });

    it('a held key moves the stop on screen and saves once, on keyup', () => {
      const { onChange } = renderEditor(three());

      for (let i = 0; i < 5; i++) fireEvent.keyDown(stop(2), { key: 'ArrowRight', repeat: i > 0 });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.keyUp(stop(2), { key: 'ArrowRight' });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 55], ['#222222', 100]));
    });

    it('picks a stop penned in by its neighbours, which a key cannot move, and saves nothing', () => {
      const { onChange } = renderEditor(
        at(['#000000', 0], ['#111111', 49], ['#222222', 50], ['#333333', 51], ['#444444', 100]),
      );

      fireEvent.keyDown(stop(3), { key: 'ArrowRight' });
      fireEvent.keyUp(stop(3), { key: 'ArrowRight' });

      expect(picked(3)).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('dragging', () => {
    const POINTER = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
    // A 200px strip: 176px of travel between the bead centres, so 1.76px a percent.
    function renderDragged() {
      const rendered = renderEditor(at(['#000000', 0], ['#111111', 50], ['#222222', 100]));
      Object.defineProperty(strip(), 'clientWidth', { configurable: true, value: 200 });
      fireEvent.pointerDown(stop(2), { ...POINTER, clientX: 100 });
      return rendered;
    }
    const shownAt = (position: number) => {
      expect(stop(2).getAttribute('aria-valuenow')).toBe(String(position));
      expect(stop(2).style.left).toBe(beadLeft(position));
    };

    it('follows the pointer past 3px on screen only, and saves once on release', () => {
      const { onChange } = renderDragged();
      expect(picked(2)).toBe(true);

      fireEvent.pointerMove(window, { ...POINTER, clientX: 102 });
      shownAt(50);
      fireEvent.pointerMove(window, { ...POINTER, clientX: 100 + 17.6 });
      shownAt(60);
      expect(positionInput().value).toBe('60');
      fireEvent.pointerMove(window, { ...POINTER, clientX: 100 + 35.2 });
      shownAt(70);
      expect(onChange).not.toHaveBeenCalled();

      fireEvent.pointerUp(window, { ...POINTER, clientX: 100 + 35.2 });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 70], ['#222222', 100]));

      // The capture let go after the release is not a cancel, and nothing more is saved.
      fireEvent(stop(2), new Event('lostpointercapture'));
      fireEvent.pointerMove(window, { ...POINTER, clientX: 0 });
      expect(onChange).toHaveBeenCalledTimes(1);
      shownAt(70);
    });

    it('stays between its neighbours', () => {
      const { onChange } = renderDragged();

      fireEvent.pointerMove(window, { ...POINTER, clientX: 400 });
      shownAt(99);
      fireEvent.pointerUp(window, { ...POINTER, clientX: 400 });

      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 99], ['#222222', 100]));
    });

    it.each([
      ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
      ['a cancelled pointer', () => fireEvent.pointerCancel(window, POINTER)],
      ['a lost capture', () => fireEvent(stop(2), new Event('lostpointercapture'))],
      ['the window losing focus', () => fireEvent.blur(window)],
    ])('puts the stop back unsaved on %s', (_case, end) => {
      const { onChange } = renderDragged();
      fireEvent.pointerMove(window, { ...POINTER, clientX: 100 + 17.6 });
      shownAt(60);

      end();
      shownAt(50);
      fireEvent.pointerUp(window, { ...POINTER, clientX: 100 + 17.6 });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the Escape that ends a drag from the popover', () => {
      renderDragged();
      fireEvent.pointerMove(window, { ...POINTER, clientX: 100 + 17.6 });
      const outside = vi.fn();
      document.addEventListener('keydown', outside);

      fireEvent.keyDown(document.body, { key: 'Escape' });

      document.removeEventListener('keydown', outside);
      expect(outside).not.toHaveBeenCalled();
    });
  });

  describe('position input', () => {
    it('is a text field for digits, disabled at an end with the end’s position', async () => {
      const { user } = renderEditor(at(['#000000', 0], ['#111111', 40], ['#222222', 100]));

      expect(positionInput().type).toBe('text');
      expect(positionInput().inputMode).toBe('numeric');
      expect(positionInput().getAttribute('aria-label')).toBe('Stop 1 position');
      expect(positionInput().disabled).toBe(true);
      expect(positionInput().value).toBe('0');

      await user.click(stop(3));
      expect(positionInput().disabled).toBe(true);
      expect(positionInput().value).toBe('100');

      await user.click(stop(2));
      expect(positionInput().getAttribute('aria-label')).toBe('Stop 2 position');
      expect(positionInput().disabled).toBe(false);
      expect(positionInput().value).toBe('40');
    });

    it('saves a position once it is complete: "4" between 31 and 69 is a draft, "45" saves', async () => {
      const { user, onChange } = renderEditor(
        at(['#000000', 0], ['#111111', 31], ['#222222', 50], ['#333333', 69], ['#444444', 100]),
      );
      await user.click(stop(3));

      await user.clear(positionInput());
      await user.type(positionInput(), '4');
      expect(positionInput().value).toBe('4');
      expect(stop(3).getAttribute('aria-valuenow')).toBe('50');
      expect(onChange).not.toHaveBeenCalled();

      await user.type(positionInput(), '5');
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(
        at(['#000000', 0], ['#111111', 31], ['#222222', 45], ['#333333', 69], ['#444444', 100]),
      );
    });

    it('shows a valid position short of complete on the strip, and saves it on Enter', async () => {
      const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 30], ['#222222', 100]));
      await user.click(stop(2));

      await user.clear(positionInput());
      await user.type(positionInput(), '5');
      expect(stop(2).getAttribute('aria-valuenow')).toBe('5');
      expect(onChange).not.toHaveBeenCalled();
      await user.type(positionInput(), '{Enter}');

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 5], ['#222222', 100]));
      expect(positionInput().value).toBe('5');
    });

    it('"50" in the room 1 to 99 is complete and saves at once', async () => {
      const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 30], ['#222222', 100]));
      await user.click(stop(2));

      await user.clear(positionInput());
      await user.type(positionInput(), '50');

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 50], ['#222222', 100]));
    });

    it('saves a valid draft on leaving the field', async () => {
      const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 30], ['#222222', 100]));
      await user.click(stop(2));

      await user.clear(positionInput());
      await user.type(positionInput(), '5');
      await user.tab();

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 5], ['#222222', 100]));
    });

    it('marks a draft no more digits can make a position, with the room for assistive technology', async () => {
      const { user } = renderEditor(at(['#000000', 0], ['#111111', 33], ['#222222', 67], ['#333333', 100]));
      await user.click(stop(3));
      await user.clear(positionInput());
      expect(positionInput().getAttribute('aria-invalid')).toBeNull();

      // "2" between 34 and 99 is a dead end, "4" is on its way to 40 to 49.
      await user.type(positionInput(), '2');
      expect(positionInput().getAttribute('aria-invalid')).toBe('true');
      expect(positionInput().className).toContain('text-danger');
      const hint = document.getElementById(positionInput().getAttribute('aria-describedby') ?? '');
      expect(hint?.textContent).toBe('Enter a position from 34 to 99');

      await user.clear(positionInput());
      await user.type(positionInput(), '4');
      expect(positionInput().getAttribute('aria-invalid')).toBeNull();
      expect(positionInput().getAttribute('aria-describedby')).toBeNull();
    });

    it('drops a draft when the value turns Solid from outside, so the next gradient neither shows nor saves it', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const props = { hexLabel: 'Hex', typeLabel: 'Color type', lastGradient: { current: null }, onChange };
      const value = at(['#000000', 0], ['#111111', 30], ['#222222', 100]);
      const { rerender } = render(<FillEditor {...props} value={value} />);
      await user.click(stop(2));
      await user.clear(positionInput());
      await user.type(positionInput(), '5');
      expect(stop(2).getAttribute('aria-valuenow')).toBe('5');

      rerender(<FillEditor {...props} value={hex('#000000')} />);
      rerender(<FillEditor {...props} value={value} />);

      expect(stop(2).getAttribute('aria-valuenow')).toBe('30');
      fireEvent.click(stop(2));
      expect(positionInput().value).toBe('30');
      // A press and release that does not move saves the move pending, if one were left.
      const press = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 0 };
      fireEvent.pointerDown(stop(2), press);
      fireEvent.pointerUp(window, press);
      expect(onChange).not.toHaveBeenCalled();
    });

    it.each(['', '0', '-5', '4x'])(
      'saves nothing for %j and shows the stop’s position again on leaving',
      async (text) => {
        const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 30], ['#222222', 100]));
        await user.click(stop(2));

        await user.clear(positionInput());
        if (text) await user.type(positionInput(), text);
        expect(stop(2).getAttribute('aria-valuenow')).toBe('30');
        await user.tab();

        expect(onChange).not.toHaveBeenCalled();
        expect(positionInput().value).toBe('30');
      },
    );
  });

  describe('Add and Remove', () => {
    it.each([
      ['the one gap of an end', [0, 100], 1, 50, 2],
      ['the wider gap, on the left', [0, 90, 100], 2, 45, 2],
      ['the wider gap, on the right', [0, 10, 100], 2, 55, 3],
      ['the widest gap on the bar, when the stop has no room', [0, 49, 50, 51, 100], 3, 75, 5],
    ])(
      'Add stop splits %s: %j from stop %i puts the new stop at %i, picked and focused',
      async (_case, positions, from, position, n) => {
        const { user, onChange } = renderEditor(spaced(...positions));
        await user.click(stop(from));

        await user.click(addButton());

        expect(onChange).toHaveBeenCalledTimes(1);
        const grown = lastFill(onChange) as Gradient;
        expect(grown.stops.map((s) => s.position)).toEqual([...positions, position].sort((a, b) => a - b));
        // With the colour already there, so the bar does not change.
        expect(grown.stops[n - 1]!.color).toEqual((spaced(...positions) as Gradient).colorAt(position));
        expect(picked(n)).toBe(true);
        expect(document.activeElement).toBe(stop(n));
      },
    );

    it('disables Add stop at eight stops and Remove stop at two', () => {
      renderEditor(spaced(0, 14, 28, 42, 56, 70, 84, 100));
      expect(addButton().hasAttribute('disabled')).toBe(true);
      expect(removeButton().hasAttribute('disabled')).toBe(false);
      cleanup();

      renderEditor(gradient('#000000', '#ffffff'));
      expect(addButton().hasAttribute('disabled')).toBe(false);
      expect(removeButton().hasAttribute('disabled')).toBe(true);
    });

    it('says why Remove stop is disabled at two stops', async () => {
      const { user } = renderEditor(gradient('#000000', '#ffffff'));

      await user.hover(removeButton().parentElement!);

      expect((await screen.findByRole('tooltip', {}, { timeout: 2000 })).textContent).toBe('At least 2 stops');
    });

    it('Add stop on the seventh stop focuses the new stop as Add stop becomes disabled', async () => {
      const { user, onChange } = renderEditor(spaced(0, 17, 33, 50, 67, 83, 100));

      await user.click(stop(7));
      await user.click(addButton());

      expect((lastFill(onChange) as Gradient).stops.map((s) => s.position)).toEqual([0, 17, 33, 50, 67, 83, 91, 100]);
      expect(document.activeElement).toBe(stop(7));
      expect(addButton().hasAttribute('disabled')).toBe(true);
    });

    it('Remove stop on an end moves its neighbour to the end, and picks and focuses the stop before it', async () => {
      const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 50], ['#222222', 100]));

      await user.click(stop(3));
      await user.click(removeButton());

      expect(lastFill(onChange)).toEqual(at(['#000000', 0], ['#111111', 100]));
      expect(document.activeElement).toBe(stop(2));
      expect(picked(2)).toBe(true);
    });

    it('Remove stop on the first stop moves the next one to 0, with stop 1 picked', async () => {
      const { user, onChange } = renderEditor(at(['#000000', 0], ['#111111', 30], ['#222222', 100]));

      await user.click(removeButton());

      expect(lastFill(onChange)).toEqual(at(['#111111', 0], ['#222222', 100]));
      expect(document.activeElement).toBe(stop(1));
      expect(picked(1)).toBe(true);
    });
  });
});
