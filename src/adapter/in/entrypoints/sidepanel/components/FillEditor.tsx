import { Button, Tooltip } from '@heroui/react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Color } from '../../../../../domain/color';
import { type Fill, Gradient } from '../../../../../domain/gradient';
import { fillBackground } from '../../../fill-css';
import ColorEditor from './ColorEditor';

interface FillEditorProps {
  /** Accessible name of the hex input, as for ColorEditor. With two or more stops it is followed
   * by the stop being edited: "Custom color, stop 2". */
  hexLabel: string;
  value: Fill;
  /** Every change, once per gesture: a stop's colour, a stop added or removed. */
  onChange: (fill: Fill) => void;
  /** No stops row: the value stays one colour (the Platform Bar text cannot be a gradient). */
  solidOnly?: boolean;
  active?: boolean;
  /** A primary press on the strip, a stop or the hex control: the caller decides whether that
   * picks this fill as it is (see ColorEditor). */
  onActivate?: () => void;
  onDone?: () => void;
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

// A fill opened for editing: a strip previewing it, carrying one bead per stop, and one
// ColorEditor for the stop picked on the strip. There is no solid/gradient mode: adding a stop to
// a colour is what makes a gradient, and removing one of two stops leaves a colour again, so the
// popover keeps one height whichever the fill is. Stops are evenly spaced and never moved.
//
// The stop being edited is marked by size, never by the accent ring: the ring is this panel's
// one "in use" mark, and a palette entry in use next to a kept gradient would otherwise show two
// rings that mean two things.
export default function FillEditor({
  hexLabel,
  value,
  onChange,
  solidOnly,
  active,
  onActivate,
  onDone,
}: FillEditorProps) {
  const stops: readonly [Color, ...Color[]] = value instanceof Gradient ? value.stops : [value];
  const [selected, setSelected] = useState(0);
  // A gradient shortened from outside (another rule, a palette edit) keeps the last stop in view.
  const current = Math.min(selected, stops.length - 1);
  const editing = stops[current] ?? stops[0];
  const { color, image } = fillBackground(value, false);

  // Add and Remove say where focus goes next; the effect below moves it once the new stops are
  // on screen (the parent saves synchronously, so they are in the same commit). Nothing else sets
  // this, so opening the popover, a clamp or an outside change leave react-aria's focus alone,
  // and a button that has just become disabled never drops focus to the page.
  const pendingFocus = useRef<number | 'add' | null>(null);
  const rowRef = useRef<HTMLFieldSetElement>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const label = target === 'add' ? 'Add stop' : `Stop ${target + 1}`;
    rowRef.current?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.focus();
  });

  // The new stop repeats the one being edited, right after it, so the bar does not change until
  // the user edits it; from a colour that makes [c, c].
  const addStop = () => {
    const grown =
      value instanceof Gradient ? value.insertStop(current + 1, editing) : Gradient.fromStops([value, value]);
    if (!grown) return;
    setSelected(current + 1);
    pendingFocus.current = current + 1;
    onChange(grown);
  };

  const removeStop = () => {
    if (!(value instanceof Gradient)) return;
    const shrunk = value.removeStop(current);
    const next = Math.max(0, current - 1);
    setSelected(next);
    // A colour has no stop to focus; Add stop is the control left in the row.
    pendingFocus.current = shrunk instanceof Gradient ? next : 'add';
    onChange(shrunk);
  };

  // A press on a stop picks it for editing and, like a press on the hex control, is a press on
  // the custom choice. The strip's own pointer handler leaves presses on a stop to this one, so
  // one press activates once, from the pointer or the keyboard alike.
  const pickStop = (index: number) => {
    setSelected(index);
    onActivate?.();
  };

  return (
    <div className="flex flex-col gap-3">
      {!solidOnly && (
        // A fieldset is the group role's own element; min-w-0 undoes its min-content width, so the
        // row narrows with a narrow dialog (Tailwind's preflight already drops its border and
        // padding).
        <fieldset ref={rowRef} aria-label="Gradient stops" className="flex h-8 min-w-0 shrink-0 items-center gap-2">
          {/* Longhands, never the `background` shorthand: it would reset the background-origin
              .fill-strip sets in style.css. The beads do not shrink and the padding is 2px, so four
              stops (20px + 3 × 16px) stay round and inside the 77px strip of the narrowest dialog
              (a 320px panel at 150% zoom, 213px wide). */}
          <div
            className="fill-strip flex h-8 min-w-0 flex-1 items-center justify-between rounded-md border px-0.5"
            style={{ backgroundColor: color, backgroundImage: image }}
            onPointerDown={(e) => {
              if (e.button === 0 && !(e.target as Element).closest('button')) onActivate?.();
            }}
          >
            {value instanceof Gradient ? (
              stops.map((stop, i) => (
                <button
                  // Stops have no identity beyond their place in the row.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={i}
                  type="button"
                  aria-label={`Stop ${i + 1}`}
                  aria-pressed={i === current}
                  onClick={() => pickStop(i)}
                  className={`color-chip shrink-0 cursor-pointer rounded-full border ${i === current ? 'h-5 w-5' : 'h-4 w-4'}`}
                  style={{ backgroundColor: stop.toHex() }}
                />
              ))
            ) : (
              // A colour's one stop: nothing to pick, so not a Tab stop and not pressed.
              <span
                aria-hidden="true"
                className="color-chip h-5 w-5 shrink-0 rounded-full border"
                style={{ backgroundColor: value.toHex() }}
              />
            )}
          </div>
          {/* The same tooltip pairing as DeleteConfirmPopover: tabIndex={-1} keeps the trigger's
              own wrapper out of the Tab order next to the button. */}
          <Tooltip delay={500}>
            <Tooltip.Trigger tabIndex={-1}>
              <Button
                isIconOnly
                variant="outline"
                size="sm"
                aria-label="Add stop"
                isDisabled={stops.length >= Gradient.MAX_STOPS}
                onPress={addStop}
              >
                <PlusIcon />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {stops.length >= Gradient.MAX_STOPS ? `Up to ${Gradient.MAX_STOPS} stops` : 'Add stop'}
            </Tooltip.Content>
          </Tooltip>
          <Tooltip delay={500}>
            <Tooltip.Trigger tabIndex={-1}>
              <Button
                isIconOnly
                variant="outline"
                size="sm"
                aria-label="Remove stop"
                isDisabled={!(value instanceof Gradient)}
                onPress={removeStop}
              >
                <MinusIcon />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Remove stop</Tooltip.Content>
          </Tooltip>
        </fieldset>
      )}
      <ColorEditor
        hexLabel={stops.length > 1 ? `${hexLabel}, stop ${current + 1}` : hexLabel}
        value={editing.toHex()}
        onChange={(c) => onChange(value instanceof Gradient ? value.changeStop(current, c) : c)}
        active={active}
        onActivate={onActivate}
        onDone={onDone}
      />
    </div>
  );
}
