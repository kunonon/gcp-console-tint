import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppearanceCard from '../AppearanceCard';

afterEach(() => {
  cleanup();
});

const checkedStates = () => screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'));

describe('AppearanceCard', () => {
  it('renders a Theme radiogroup of Light, Auto and Dark, in order, with the current theme checked', () => {
    render(<AppearanceCard theme="dark" onChange={() => {}} />);

    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-label'))).toEqual([
      'Light',
      'Auto',
      'Dark',
    ]);
    expect(checkedStates()).toEqual(['false', 'false', 'true']);
  });

  it('names the current choice in the hint under the label', () => {
    const { rerender } = render(<AppearanceCard theme="auto" onChange={() => {}} />);
    expect(screen.getByText('Auto (follows system)')).toBeTruthy();
    expect(checkedStates()).toEqual(['false', 'true', 'false']);

    rerender(<AppearanceCard theme="light" onChange={() => {}} />);
    expect(screen.getByText('Light')).toBeTruthy();
    expect(checkedStates()).toEqual(['true', 'false', 'false']);
  });

  it('keeps the DOM shape style.css (.theme-switch) positions the thumb by: three radios as the only children', () => {
    render(<AppearanceCard theme="auto" onChange={() => {}} />);

    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group.classList.contains('theme-switch')).toBe(true);
    const children = Array.from(group.children);
    expect(children.map((child) => [child.getAttribute('role'), child.getAttribute('aria-label')])).toEqual([
      ['radio', 'Light'],
      ['radio', 'Auto'],
      ['radio', 'Dark'],
    ]);
    for (const child of children) {
      expect(child.querySelectorAll('svg')).toHaveLength(1);
      // Every glyph is drawn on a stroke-only root.
      expect(child.querySelector('svg')?.getAttribute('fill')).toBe('none');
    }
  });

  it('draws the sun and the moon as outlines and Auto as one disc with an unstroked currentColor half', () => {
    render(<AppearanceCard theme="auto" onChange={() => {}} />);

    // The half is the set's only filled shape, and it must stay unstroked or its straight edge
    // moves off x=12.
    const filled = screen
      .getAllByRole('radio')
      .map((child) =>
        Array.from(child.querySelectorAll('svg [fill]')).map((shape) => [
          shape.getAttribute('fill'),
          shape.getAttribute('stroke'),
        ]),
      );
    expect(filled).toEqual([[], [['currentColor', 'none']], []]);
  });

  it('reports the picked theme', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AppearanceCard theme="auto" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('light');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onChange).toHaveBeenLastCalledWith('dark');
  });

  it('does nothing when the already-selected theme is clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AppearanceCard theme="dark" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(checkedStates()).toEqual(['false', 'false', 'true']);
  });
});
