import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '../../../../../../domain/color';
import { type Fill, Gradient } from '../../../../../../domain/gradient';
import FillEditor from '../FillEditor';

afterEach(() => {
  cleanup();
});

const hex = (value: string) => Color.fromHex(value)!;
const gradient = (...hexes: string[]) => Gradient.fromStops(hexes.map(hex))!;

// FillEditor is controlled: the stops it adds only show once the parent holds the new fill, as
// App's synchronous save does. `onChange` records every call.
function Harness({ initial, ...props }: { initial: Fill } & Partial<ComponentProps<typeof FillEditor>>) {
  const [value, setValue] = useState(initial);
  return (
    <FillEditor
      hexLabel="Hex"
      {...props}
      value={value}
      onChange={(fill) => {
        props.onChange?.(fill);
        setValue(fill);
      }}
    />
  );
}

function renderEditor(initial: Fill, props: Partial<ComponentProps<typeof FillEditor>> = {}) {
  const user = userEvent.setup();
  const onChange = vi.fn<(fill: Fill) => void>();
  render(<Harness initial={initial} onChange={onChange} {...props} />);
  return { user, onChange };
}

const stopsRow = () => screen.getByRole('group', { name: 'Gradient stops' });
const stop = (n: number) => within(stopsRow()).getByRole('button', { name: `Stop ${n}` });
const addButton = () => screen.getByRole('button', { name: 'Add stop' });
const removeButton = () => screen.getByRole('button', { name: 'Remove stop' });

describe('FillEditor', () => {
  it('shows a colour as one stop that is not a control: no stop button and nothing pressed', () => {
    renderEditor(hex('#ff6d00'));

    expect(within(stopsRow()).queryAllByRole('button', { name: /^Stop/ })).toEqual([]);
    expect(stopsRow().querySelector('[aria-pressed]')).toBeNull();
    expect(screen.getByLabelText('Hex')).toBeTruthy();
  });

  it('Add stop on a colour makes a gradient of it twice in one change, with stop 2 picked and focused', async () => {
    const { user, onChange } = renderEditor(hex('#ff6d00'));

    await user.click(addButton());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual(gradient('#ff6d00', '#ff6d00'));
    expect(stop(2).getAttribute('aria-pressed')).toBe('true');
    expect(stop(2).className).toContain('h-5 w-5');
    expect(stop(1).getAttribute('aria-pressed')).toBe('false');
    expect(stop(1).className).toContain('h-4 w-4');
    // The picked stop is marked by size, never by the ring that means "in use".
    expect(stop(2).className).not.toContain('ring-2');
    expect(document.activeElement).toBe(stop(2));
    expect(screen.getByLabelText('Hex, stop 2')).toBeTruthy();
  });

  it('Remove stop on two stops leaves the other colour in one change and moves focus to Add stop', async () => {
    const { user, onChange } = renderEditor(gradient('#ff6d00', '#1a73e8'));

    await user.click(stop(2));
    await user.click(removeButton());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual(hex('#ff6d00'));
    expect(document.activeElement).toBe(addButton());
    expect(removeButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('Hex')).toBeTruthy();
  });

  it('disables Add stop at four stops and Remove stop on a colour', () => {
    renderEditor(gradient('#000000', '#111111', '#222222', '#333333'));
    expect(addButton().hasAttribute('disabled')).toBe(true);
    expect(removeButton().hasAttribute('disabled')).toBe(false);
    cleanup();

    renderEditor(hex('#000000'));
    expect(addButton().hasAttribute('disabled')).toBe(false);
    expect(removeButton().hasAttribute('disabled')).toBe(true);
  });

  it('Add stop after the third stop focuses the new fourth stop, as Add stop becomes disabled', async () => {
    const { user, onChange } = renderEditor(gradient('#000000', '#111111', '#222222'));

    await user.click(stop(3));
    await user.click(addButton());

    expect(onChange.mock.calls.at(-1)![0]).toEqual(gradient('#000000', '#111111', '#222222', '#222222'));
    expect(document.activeElement).toBe(stop(4));
    expect(addButton().hasAttribute('disabled')).toBe(true);
  });

  it('Remove stop on the third of three stops picks and focuses stop 2', async () => {
    const { user, onChange } = renderEditor(gradient('#000000', '#111111', '#222222'));

    await user.click(stop(3));
    await user.click(removeButton());

    expect(onChange.mock.calls.at(-1)![0]).toEqual(gradient('#000000', '#111111'));
    expect(document.activeElement).toBe(stop(2));
    expect(stop(2).getAttribute('aria-pressed')).toBe('true');
  });

  it('moves focus neither on mount nor when the value changes from outside', () => {
    const props = { hexLabel: 'Hex', onChange: () => {} };
    const { rerender } = render(<FillEditor {...props} value={gradient('#000000', '#111111', '#222222')} />);
    expect(document.activeElement).toBe(document.body);

    rerender(<FillEditor {...props} value={gradient('#000000', '#111111')} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the last stop picked when the value shrinks from outside', async () => {
    const user = userEvent.setup();
    const props = { hexLabel: 'Hex', onChange: () => {} };
    const { rerender } = render(<FillEditor {...props} value={gradient('#000000', '#111111', '#222222')} />);
    await user.click(stop(3));

    rerender(<FillEditor {...props} value={gradient('#000000', '#111111')} />);

    expect(stop(2).getAttribute('aria-pressed')).toBe('true');
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

  it('hands a primary press on the strip or on a stop to onActivate, once each', async () => {
    const onActivate = vi.fn();
    const { user } = renderEditor(gradient('#000000', '#111111'), { onActivate });

    fireEvent.pointerDown(stopsRow().querySelector('.fill-strip')!, { button: 0 });
    expect(onActivate).toHaveBeenCalledTimes(1);

    await user.click(stop(2));
    expect(onActivate).toHaveBeenCalledTimes(2);

    await user.click(addButton());
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('paints the strip with longhands: the first stop as the colour and the gradient as the image', () => {
    renderEditor(gradient('#ff6d00', '#1a73e8'));

    const strip = stopsRow().querySelector('.fill-strip') as HTMLElement;
    expect(['#ff6d00', 'rgb(255, 109, 0)']).toContain(strip.style.backgroundColor);
    expect(strip.style.backgroundImage).toMatch(
      /^linear-gradient\(to right, (#ff6d00|rgb\(255, 109, 0\)), (#1a73e8|rgb\(26, 115, 232\))\)$/,
    );
  });

  it('has no stops row under solidOnly', () => {
    renderEditor(hex('#ff6d00'), { solidOnly: true });

    expect(screen.queryByRole('group', { name: 'Gradient stops' })).toBeNull();
    expect(screen.getByLabelText('Hex')).toBeTruthy();
  });

  it('calls onDone for Enter in the hex input', async () => {
    const onDone = vi.fn();
    const { user } = renderEditor(gradient('#000000', '#111111'), { onDone });

    await user.click(screen.getByLabelText('Hex, stop 1'));
    await user.keyboard('{Enter}');

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
