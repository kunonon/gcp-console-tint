import { Popover } from '@heroui/react';
import { useState } from 'react';
import { type Fill, Gradient } from '../../../../../domain/gradient';
import type { PaletteEntry, PaletteEntryId } from '../../../../../domain/palette';
import { fillBackground } from '../../../fill-css';
import FillEditor from './FillEditor';

interface PaletteColorPickerProps {
  ariaLabel: string;
  paletteEnabled: boolean;
  palette: readonly PaletteEntry[];
  paletteId: PaletteEntryId | undefined;
  /** The kept custom fill: what the custom choice paints, and the way back from an entry. */
  custom: Fill;
  /** What the surface paints right now (Auto aside): the entry in use or the custom fill. */
  effective: Fill;
  onSelectPaletteEntry: (id: PaletteEntryId) => void;
  onSelectCustomColor: (fill: Fill) => void;
  /** The custom choice stays one colour: no stops row (the Platform Bar text). */
  solidOnly?: boolean;
  supportsAuto?: boolean;
  autoSelected?: boolean;
  onSelectAuto?: () => void;
  /** '#rrggbb' Auto resolves to right now; fills the Auto option's bead. */
  autoColor?: string;
}

// The one selection mark of this panel: a 2px accent ring, held off the fill by a 2px gap of
// the popover surface (a ring touching the fill vanished on red and on accent-blue beads).
const SELECTED = 'ring-2 ring-focus ring-offset-2 ring-offset-overlay';

// A bead's fill as longhands, never the `background` shorthand: it would reset the
// background-origin .color-chip sets in style.css.
const chipStyle = (fill: Fill) => {
  const { color, image } = fillBackground(fill);
  return { backgroundColor: color, backgroundImage: image };
};

export default function PaletteColorPicker({
  ariaLabel,
  paletteEnabled,
  palette,
  paletteId,
  custom,
  effective,
  onSelectPaletteEntry,
  onSelectCustomColor,
  solidOnly,
  supportsAuto,
  autoSelected,
  onSelectAuto,
  autoColor,
}: PaletteColorPickerProps) {
  // Controlled so Enter in the hex input can close it (focus then returns to the trigger).
  const [open, setOpen] = useState(false);

  const referencedEntry = paletteEnabled && paletteId ? palette.find((e) => e.id.equals(paletteId)) : undefined;
  const isCustomActive = !autoSelected && !referencedEntry;
  // With neither Auto nor a palette to choose from, custom is not a choice to mark as taken.
  const hasAlternatives = supportsAuto || (paletteEnabled && palette.length > 0);
  const triggerLabel = autoSelected
    ? 'Auto'
    : referencedEntry
      ? referencedEntry.name || '(unnamed)'
      : effective instanceof Gradient
        ? 'Gradient'
        : effective.toHex();

  // A reference the palette no longer honours (a gradient entry on the text picker, or an id no
  // entry carries) still sits on the selection and would re-link if an entry answered to it again,
  // so a press on the custom control drops it; only a selection that already is the bare custom
  // has nothing to do.
  const stale = paletteEnabled && paletteId !== undefined && !referencedEntry;
  // The way back to the kept custom fill from a palette entry or Auto without changing it: a
  // press on the custom control (its strip, a stop or the hex control), or Enter in its hex input.
  const selectKeptCustom = () => {
    if (isCustomActive && !stale) return;
    onSelectCustomColor(custom);
  };

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
          <span aria-hidden="true" className="color-chip h-5 w-5 rounded-full border" style={chipStyle(effective)} />
          <span className="font-mono text-sm text-muted">{triggerLabel}</span>
        </button>
      </Popover.Trigger>
      {/* react-aria caps the popover's height when the panel is too short for it on either side of
          the trigger. The dialog then scrolls inside the popover (a flex column, so the dialog can
          be shorter than its content) instead of running past the surface. The scroller is the
          square dialog, not the rounded popover: clipping to the 24px corners changed how Chrome
          rasterises the well's gradients. Of the 12px around the content, 4px are the popover's
          own (py-1), so scrolled content is cut inside the corners' curve; the rings and the
          beads' focus outline still fit in the dialog's 8px. max-w: in a panel narrower than the
          dialog's 14rem plus react-aria's 12px margins (a large UI font, a zoomed or very narrow
          panel) the dialog narrows with the panel instead of running out of it. */}
      <Popover.Content className="flex flex-col py-1">
        {/* Every choice is a bead and the one in use wears the ring: Auto (filled with the colour
            it resolves to now), each palette entry, and the custom control with its well. The
            popover keeps one height while it is open, so nothing in it moves under the pointer
            when a choice is made. */}
        <Popover.Dialog
          aria-label={ariaLabel}
          className="flex min-h-0 w-56 max-w-[calc(100vw-24px)] flex-col gap-3 overflow-y-auto px-3 py-2"
        >
          {supportsAuto && (
            // shrink-0: in a capped dialog this row keeps its 32px (its text alone is 22px tall).
            <button
              type="button"
              aria-pressed={autoSelected === true}
              onClick={() => onSelectAuto?.()}
              className={`outlined-control flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border px-2 text-sm ${
                autoSelected ? SELECTED : ''
              }`}
            >
              <span
                aria-hidden="true"
                className="color-chip h-5 w-5 shrink-0 rounded-full border"
                style={{ backgroundColor: autoColor }}
              />
              {/* The button is named by this text, "Auto Match contrast" (the space keeps the
                  two apart in the name). In a wide UI font the muted part gives way, on one line. */}
              Auto <span className="truncate text-muted">Match contrast</span>
            </button>
          )}
          {paletteEnabled && palette.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {palette.map((entry) => {
                const selected = !autoSelected && paletteId?.equals(entry.id) === true;
                return (
                  <button
                    key={entry.id.toString()}
                    type="button"
                    aria-label={entry.name || '(unnamed)'}
                    aria-pressed={selected}
                    onClick={() => onSelectPaletteEntry(entry.id)}
                    className={`color-chip h-7 w-7 cursor-pointer rounded-full border ${selected ? SELECTED : ''}`}
                    style={chipStyle(entry.color)}
                  />
                );
              })}
            </div>
          )}
          {/* Every edit of the custom fill (a stop's colour, a stop added or removed) is one
              selection of the edited fill, which also leaves an entry or Auto, as a hex does. */}
          <FillEditor
            hexLabel="Custom color"
            value={custom}
            solidOnly={solidOnly}
            active={hasAlternatives && isCustomActive}
            onChange={onSelectCustomColor}
            onActivate={selectKeptCustom}
            onDone={() => {
              selectKeptCustom();
              setOpen(false);
            }}
          />
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
