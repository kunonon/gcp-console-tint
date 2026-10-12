import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color } from '../../../../../../domain/color';
import { PaletteEntry, PaletteEntryId } from '../../../../../../domain/palette';
import PaletteColorPicker from '../PaletteColorPicker';

afterEach(() => {
  cleanup();
});

const defaultEntryId = PaletteEntryId.recreate('default');
const palette = [PaletteEntry.recreate(defaultEntryId, 'Primary', Color.fromHex('#ff6d00')!)];

async function openDialog(user: ReturnType<typeof userEvent.setup>, triggerLabel: string) {
  await user.click(screen.getByRole('button', { name: triggerLabel }));
  return screen.getByRole('dialog');
}

describe('PaletteColorPicker', () => {
  describe('trigger', () => {
    const renderBetweenButtons = () =>
      render(
        <>
          <button type="button">before</button>
          <PaletteColorPicker
            ariaLabel="Test color"
            paletteEnabled
            palette={palette}
            paletteId={defaultEntryId}
            customColor="#123456"
            effectiveColor="#ff6d00"
            onSelectPaletteEntry={() => {}}
            onSelectCustomColor={() => {}}
          />
          <button type="button">after</button>
        </>,
      );

    it("is one Tab stop: Popover.Trigger's own wrapper is taken out of the Tab order", async () => {
      const user = userEvent.setup();
      renderBetweenButtons();

      for (const name of ['before', 'Test color', 'after']) {
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name }));
      }
    });

    it('says on the button that takes focus that it opens a dialog and whether that dialog is open', async () => {
      const user = userEvent.setup();
      renderBetweenButtons();

      const trigger = screen.getByLabelText('Test color');
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      await user.click(trigger);

      screen.getByRole('dialog');
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('trigger label', () => {
    it('shows the referenced palette entry name when paletteId references a valid entry', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={defaultEntryId}
          customColor="#123456"
          effectiveColor="#ff6d00"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toContain('Primary');
    });

    it('shows the custom hex color when paletteId is undefined (no reference)', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={undefined}
          customColor="#123456"
          effectiveColor="#123456"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toContain('#123456');
    });

    it('shows "Auto" when autoSelected is true, taking priority over a paletteId reference', () => {
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={palette}
          paletteId={defaultEntryId}
          customColor="#123456"
          effectiveColor="#ff6d00"
          onSelectPaletteEntry={() => {}}
          onSelectCustomColor={() => {}}
          supportsAuto
          autoSelected
          onSelectAuto={() => {}}
        />,
      );

      expect(screen.getByRole('button', { name: 'Test color' }).textContent).toBe('Auto');
    });
  });

  it('when autoSelected is true and paletteId references a valid entry, the popover shows Auto active while neither the matching palette swatch nor Custom gets an active ring (exclusivity)', async () => {
    const user = userEvent.setup();
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={palette}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
        supportsAuto
        autoSelected
        onSelectAuto={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    const autoButton = within(dialog).getByRole('button', { name: 'Auto Match contrast' });
    expect(autoButton.className).toContain('ring-2');

    // "default" is the entry paletteId references; it must NOT show an active ring while Auto
    // is selected, since Auto and a palette reference are mutually exclusive states.
    const paletteSwatch = within(dialog).getByRole('button', { name: 'Primary' });
    expect(paletteSwatch.className).not.toContain('ring-2');

    const customInput = within(dialog).getByLabelText('Custom color');
    const customLabel = customInput.closest('label');
    expect(customLabel).toBeTruthy();
    expect(customLabel!.className).not.toContain('ring-2');
  });

  it("offsets the selected palette option's ring from the dot with a gap in the popover's surface colour (\"ring-offset-2 ring-offset-overlay\"), so the ring stays visible whatever the dot's colour", async () => {
    const user = userEvent.setup();
    const twoEntries = [
      ...palette,
      PaletteEntry.recreate(PaletteEntryId.recreate('second'), 'Secondary', Color.fromHex('#d50000')!),
    ];
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={twoEntries}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    const selected = within(dialog).getByRole('button', { name: 'Primary' });
    for (const className of ['ring-2', 'ring-focus', 'ring-offset-2', 'ring-offset-overlay']) {
      expect(selected.classList.contains(className), className).toBe(true);
    }
    const other = within(dialog).getByRole('button', { name: 'Secondary' });
    for (const className of ['ring-2', 'ring-offset-2']) {
      expect(other.classList.contains(className), className).toBe(false);
    }
  });

  it('marks the trigger and the "Match contrast" button with "outlined-control", and the trigger\'s dot and every palette option with "color-chip", the hooks style.css uses for the dark-theme control border and the bead rim', async () => {
    const user = userEvent.setup();
    const twoEntries = [
      ...palette,
      PaletteEntry.recreate(PaletteEntryId.recreate('second'), 'Secondary', Color.fromHex('#d50000')!),
    ];
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled
        palette={twoEntries}
        paletteId={defaultEntryId}
        customColor="#123456"
        effectiveColor="#ff6d00"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
        supportsAuto
        onSelectAuto={() => {}}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Test color' });
    expect(trigger.classList.contains('outlined-control')).toBe(true);
    const dot = trigger.querySelector('[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    expect(dot!.classList.contains('color-chip')).toBe(true);

    const dialog = await openDialog(user, 'Test color');

    expect(
      within(dialog).getByRole('button', { name: 'Auto Match contrast' }).classList.contains('outlined-control'),
    ).toBe(true);
    for (const name of ['Primary', 'Secondary']) {
      expect(within(dialog).getByRole('button', { name }).classList.contains('color-chip')).toBe(true);
    }
  });

  it('hides the Palette section in the popover when paletteEnabled is false, even with palette entries present', async () => {
    const user = userEvent.setup();
    render(
      <PaletteColorPicker
        ariaLabel="Test color"
        paletteEnabled={false}
        palette={palette}
        paletteId={undefined}
        customColor="#123456"
        effectiveColor="#123456"
        onSelectPaletteEntry={() => {}}
        onSelectCustomColor={() => {}}
      />,
    );

    const dialog = await openDialog(user, 'Test color');

    expect(within(dialog).queryByText('Palette')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Primary' })).toBeNull();
    // Custom is still shown regardless of paletteEnabled.
    expect(within(dialog).getByLabelText('Custom color')).toBeTruthy();
  });

  describe('choices', () => {
    const secondEntryId = PaletteEntryId.recreate('second');
    const twoEntries = [...palette, PaletteEntry.recreate(secondEntryId, 'Secondary', Color.fromHex('#d50000')!)];

    // A picker with Auto and two palette entries whose kept custom colour is #123456; `props`
    // says which choice is in use. Returns the open dialog and the three selection callbacks.
    async function openPickerWith(props: Partial<ComponentProps<typeof PaletteColorPicker>> = {}) {
      const user = userEvent.setup();
      const onSelectPaletteEntry = vi.fn<(id: PaletteEntryId) => void>();
      const onSelectCustomColor = vi.fn<(color: Color) => void>();
      const onSelectAuto = vi.fn();
      render(
        <PaletteColorPicker
          ariaLabel="Test color"
          paletteEnabled
          palette={twoEntries}
          paletteId={undefined}
          customColor="#123456"
          effectiveColor="#123456"
          onSelectPaletteEntry={onSelectPaletteEntry}
          onSelectCustomColor={onSelectCustomColor}
          supportsAuto
          autoSelected={false}
          autoColor="#000000"
          onSelectAuto={onSelectAuto}
          {...props}
        />,
      );
      const dialog = await openDialog(user, 'Test color');
      const customInput = within(dialog).getByLabelText('Custom color') as HTMLInputElement;
      return { user, dialog, customInput, onSelectPaletteEntry, onSelectCustomColor, onSelectAuto };
    }

    const customHexes = (onSelectCustomColor: { mock: { calls: [Color][] } }) =>
      onSelectCustomColor.mock.calls.map(([color]) => color.toHex());

    // Keyboard focus without a pointer press, as Tab gives it.
    function focus(element: HTMLElement) {
      act(() => {
        element.focus();
      });
    }

    it('names the dialog after its trigger and labels nothing in it with a section heading', async () => {
      const { dialog } = await openPickerWith();

      expect(screen.getByRole('dialog', { name: 'Test color' })).toBe(dialog);
      expect(within(dialog).queryByText('Palette')).toBeNull();
      expect(within(dialog).queryByText('Custom')).toBeNull();
      // The only "Auto" is the option's own text, and the option is named by all of its text.
      const auto = within(dialog).getByRole('button', { name: 'Auto Match contrast' });
      expect(within(dialog).getAllByText('Auto')).toEqual([auto]);
      expect(auto.hasAttribute('aria-label')).toBe(false);
      // The dialog scrolls inside the popover, the element react-aria caps the height of.
      expect(dialog.className).toContain('min-h-0');
      expect(dialog.className).toContain('max-w-[calc(100vw-24px)]');
      expect(dialog.className).toContain('overflow-y-auto');
      expect(dialog.closest('[data-placement]')?.className).toContain('flex flex-col');
    });

    it('holds the editor of the custom colour: its hex input, the face and the hue strip, whichever choice is in use', async () => {
      const { dialog, customInput } = await openPickerWith({ paletteId: defaultEntryId });

      expect(customInput.tagName).toBe('INPUT');
      expect(customInput.value).toBe('#123456');
      expect(within(dialog).getByRole('group', { name: /Saturation and brightness/ })).toBeTruthy();
      expect(within(dialog).getByRole('group', { name: 'Hue' })).toBeTruthy();
    });

    it.each([
      ['a palette entry is in use', { paletteId: defaultEntryId }, ['false', 'true', 'false']],
      ['the custom colour is in use', {}, ['false', 'false', 'false']],
      ['Auto is in use', { autoSelected: true }, ['true', 'false', 'false']],
      [
        'Auto is in use over a kept palette reference',
        { autoSelected: true, paletteId: defaultEntryId },
        ['true', 'false', 'false'],
      ],
      ['autoSelected is not passed', { autoSelected: undefined }, ['false', 'false', 'false']],
    ])(
      'exposes the choice in use through aria-pressed on Auto and every palette bead when %s',
      async (_case, props, pressed) => {
        const { dialog } = await openPickerWith(props);

        expect(
          ['Auto Match contrast', 'Primary', 'Secondary'].map((name) =>
            within(dialog).getByRole('button', { name }).getAttribute('aria-pressed'),
          ),
        ).toEqual(pressed);
      },
    );

    it("fills the Auto option's bead with autoColor", async () => {
      const { dialog } = await openPickerWith({ autoColor: '#ffffff' });

      const bead = within(dialog)
        .getByRole('button', { name: 'Auto Match contrast' })
        .querySelector('span[aria-hidden="true"]');
      expect(bead).toBeTruthy();
      expect((bead as HTMLElement).classList.contains('color-chip')).toBe(true);
      expect(['#ffffff', 'rgb(255, 255, 255)']).toContain((bead as HTMLElement).style.backgroundColor);
    });

    it('selects a palette entry or Auto with one call each', async () => {
      const { user, dialog, onSelectPaletteEntry, onSelectCustomColor, onSelectAuto } = await openPickerWith();

      await user.click(within(dialog).getByRole('button', { name: 'Secondary' }));
      expect(onSelectPaletteEntry.mock.calls.map(([id]) => id.toString())).toEqual(['second']);

      await user.click(within(dialog).getByRole('button', { name: 'Auto Match contrast' }));
      expect(onSelectAuto).toHaveBeenCalledTimes(1);
      expect(onSelectCustomColor).not.toHaveBeenCalled();
    });

    it.each([
      ['a palette entry', { paletteId: defaultEntryId }],
      ['Auto', { autoSelected: true }],
    ])(
      'a primary press on the custom control while %s is in use re-selects the kept custom colour unchanged, once, and keeps the popover open',
      async (_case, props) => {
        const { user, customInput, onSelectPaletteEntry, onSelectCustomColor, onSelectAuto } =
          await openPickerWith(props);

        await user.click(customInput);

        expect(customHexes(onSelectCustomColor)).toEqual(['#123456']);
        expect(onSelectCustomColor.mock.calls[0]![0]).toBeInstanceOf(Color);
        expect(onSelectPaletteEntry).not.toHaveBeenCalled();
        expect(onSelectAuto).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(document.activeElement).toBe(customInput);
      },
    );

    it('a press on the bead of the custom control re-selects the kept custom colour as well', async () => {
      const { user, customInput, onSelectCustomColor } = await openPickerWith({ paletteId: defaultEntryId });

      await user.click(customInput.closest('label')!.querySelector('span[aria-hidden="true"]')!);

      expect(customHexes(onSelectCustomColor)).toEqual(['#123456']);
    });

    it('a secondary-button press on the custom control (a right click to paste) selects nothing', async () => {
      const { user, customInput, onSelectCustomColor } = await openPickerWith({ paletteId: defaultEntryId });

      await user.pointer({ keys: '[MouseRight]', target: customInput });

      expect(onSelectCustomColor).not.toHaveBeenCalled();
    });

    it('a press on the custom control while the custom colour is already in use selects nothing', async () => {
      const { user, customInput, onSelectCustomColor } = await openPickerWith();

      await user.click(customInput);

      expect(onSelectCustomColor).not.toHaveBeenCalled();
    });

    it.each([
      ['a palette entry', { paletteId: defaultEntryId }],
      ['Auto', { autoSelected: true }],
    ])(
      'Enter in the custom input while %s is in use re-selects the kept custom colour once and closes the popover',
      async (_case, props) => {
        const { user, customInput, onSelectCustomColor } = await openPickerWith(props);

        focus(customInput);
        expect(onSelectCustomColor).not.toHaveBeenCalled();
        await user.keyboard('{Enter}');

        expect(customHexes(onSelectCustomColor)).toEqual(['#123456']);
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).toBeNull();
          expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Test color' }));
        });
      },
    );

    it('Enter in the custom input while the custom colour is in use only closes the popover', async () => {
      const { user, customInput, onSelectCustomColor } = await openPickerWith();

      focus(customInput);
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(onSelectCustomColor).not.toHaveBeenCalled();
    });

    it.each(['12', 'abc', '#fff'])(
      'Enter on the draft %j while a palette entry is in use marks it as wrong, keeps the popover open and selects nothing',
      async (text) => {
        const { user, customInput, onSelectCustomColor, onSelectPaletteEntry } = await openPickerWith({
          paletteId: defaultEntryId,
        });

        focus(customInput);
        await user.keyboard(`${text}{Enter}`);

        expect(onSelectCustomColor).not.toHaveBeenCalled();
        expect(onSelectPaletteEntry).not.toHaveBeenCalled();
        expect(customInput.value).toBe(text);
        expect(customInput.getAttribute('aria-invalid')).toBe('true');
        expect(screen.getByRole('dialog')).toBeTruthy();
      },
    );

    it('a complete hex in the custom input selects that colour once, whichever choice was in use', async () => {
      const { customInput, onSelectCustomColor } = await openPickerWith({ paletteId: defaultEntryId });

      fireEvent.change(customInput, { target: { value: '#654321' } });

      expect(customHexes(onSelectCustomColor)).toEqual(['#654321']);
    });

    it('typing the kept custom colour itself while a palette entry is in use selects nothing until Enter', async () => {
      const { user, customInput, onSelectCustomColor } = await openPickerWith({ paletteId: defaultEntryId });

      focus(customInput);
      await user.keyboard('123456');
      expect(onSelectCustomColor).not.toHaveBeenCalled();

      await user.keyboard('{Enter}');
      expect(customHexes(onSelectCustomColor)).toEqual(['#123456']);
    });

    it('a change of the well while a palette entry is in use selects the changed colour once', async () => {
      const { user, dialog, onSelectCustomColor } = await openPickerWith({ paletteId: defaultEntryId });

      focus(within(within(dialog).getByRole('group', { name: 'Hue' })).getByRole('slider'));
      await user.keyboard('{ArrowRight}');

      expect(onSelectCustomColor).toHaveBeenCalledTimes(1);
      expect(customHexes(onSelectCustomColor)[0]).not.toBe('#123456');
    });

    it('Tab walks the choices in the order they are laid out, comes round again, and selects nothing', async () => {
      const { user, dialog, customInput, onSelectPaletteEntry, onSelectCustomColor, onSelectAuto } =
        await openPickerWith({ paletteId: defaultEntryId });
      const inDialog = within(dialog);
      const auto = inDialog.getByRole('button', { name: 'Auto Match contrast' });
      const stops = [
        auto,
        ...twoEntries.map((entry) => inDialog.getByRole('button', { name: entry.name })),
        customInput,
        within(inDialog.getByRole('group', { name: /Saturation and brightness/ })).getByRole('slider'),
        within(inDialog.getByRole('group', { name: 'Hue' })).getByRole('slider'),
        auto,
      ];

      for (const stop of stops) {
        await user.tab();
        expect(document.activeElement).toBe(stop);
      }

      expect(onSelectPaletteEntry).not.toHaveBeenCalled();
      expect(onSelectCustomColor).not.toHaveBeenCalled();
      expect(onSelectAuto).not.toHaveBeenCalled();
    });

    describe('the ring on the custom control', () => {
      const ringed = (customInput: HTMLElement) => customInput.parentElement!.classList.contains('ring-2');

      it.each([
        ['the palette offers an alternative', { supportsAuto: false }],
        ['Auto is the only alternative', { paletteEnabled: false }],
        ['Auto is the only alternative and the palette is empty', { palette: [] }],
      ])('rings it with the gapped ring while the custom colour is in use and %s', async (_case, props) => {
        const { customInput } = await openPickerWith(props);

        for (const className of ['ring-2', 'ring-focus', 'ring-offset-2', 'ring-offset-overlay']) {
          expect(customInput.parentElement!.classList.contains(className), className).toBe(true);
        }
      });

      it.each([
        ['the palette is off and there is no Auto', { supportsAuto: false, paletteEnabled: false }],
        ['the palette is empty and there is no Auto', { supportsAuto: false, palette: [] }],
        [
          'the palette is off, there is no Auto, and a palette reference is kept',
          { supportsAuto: false, paletteEnabled: false, paletteId: defaultEntryId },
        ],
      ])('never rings it when there is nothing to choose between: %s', async (_case, props) => {
        const { customInput } = await openPickerWith(props);

        expect(ringed(customInput)).toBe(false);
      });

      it.each([
        ['a palette entry', { paletteId: defaultEntryId }],
        ['Auto', { autoSelected: true }],
      ])('does not ring it while %s is in use', async (_case, props) => {
        const { customInput } = await openPickerWith(props);

        expect(ringed(customInput)).toBe(false);
      });

      it('treats a reference to an entry that no longer exists as the custom colour in use', async () => {
        const { customInput, dialog } = await openPickerWith({ paletteId: PaletteEntryId.recreate('gone') });

        expect(ringed(customInput)).toBe(true);
        expect(within(dialog).getByRole('button', { name: 'Primary' }).getAttribute('aria-pressed')).toBe('false');
      });
    });
  });
});
