import { Popover } from '@heroui/react';
import { useState } from 'react';
import type { Color } from '../../../../../domain/color';
import ColorEditor from './ColorEditor';

interface ColorSwatchFieldProps {
  ariaLabel: string;
  /** '#rrggbb', lowercase. */
  value: string;
  onChange: (color: Color) => void;
  hexHidableOnNarrow?: boolean;
}

// A palette row's colour: the bead-and-hex control every tinted surface already uses as its
// trigger, opening the colour editor in a popover of the same family as the surface pickers.
export default function ColorSwatchField({ ariaLabel, value, onChange, hexHidableOnNarrow }: ColorSwatchFieldProps) {
  // Controlled so Enter in the hex input can close it (focus then returns to the trigger).
  const [open, setOpen] = useState(false);

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      {/* tabIndex={-1}: the trigger's own wrapper is not a Tab stop next to the button, as in
          DeleteConfirmPopover. The button is what takes focus, so it says itself that it opens a
          dialog and whether that dialog is open. */}
      <Popover.Trigger tabIndex={-1}>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="outlined-control flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-transparent px-2"
        >
          <span
            aria-hidden="true"
            className="color-chip h-5 w-5 rounded-full border"
            style={{ backgroundColor: value }}
          />
          <span className={`font-mono text-sm text-muted ${hexHidableOnNarrow ? 'hidden @min-[220px]:inline' : ''}`}>
            {value}
          </span>
        </button>
      </Popover.Trigger>
      {/* Aligned to the control's left edge and then shifted into the panel by react-aria, the
          popover lands in the same column as the surface pickers' popovers and on a whole pixel
          (centred under an odd-width control it sits on a half pixel and blurs its 1px edges).
          As in PaletteColorPicker, the dialog scrolls inside a popover whose height react-aria
          capped; see there for the classes, max-w included. */}
      <Popover.Content placement="bottom start" className="flex flex-col py-1">
        <Popover.Dialog
          aria-label={ariaLabel}
          className="flex min-h-0 w-56 max-w-[calc(100vw-24px)] flex-col overflow-y-auto px-3 py-2"
        >
          <ColorEditor hexLabel="Hex" value={value} onChange={onChange} onDone={() => setOpen(false)} />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
