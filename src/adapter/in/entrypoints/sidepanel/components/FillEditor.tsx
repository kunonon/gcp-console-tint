import { Button, ToggleButton, ToggleButtonGroup, Tooltip } from '@heroui/react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type Fill, Gradient } from '../../../../../domain/gradient';
import { fillStripImage } from '../../../fill-css';
import ColorEditor from './ColorEditor';

/** What a switch to Solid leaves for a switch back: the gradient and the stop it had picked. */
export interface KeptGradient {
  gradient: Gradient;
  index: number;
}

interface FillEditorProps {
  /** Accessible name of the hex input, as for ColorEditor. With two or more stops it is followed
   * by the stop being edited: "Custom color, stop 2". */
  hexLabel: string;
  /** Accessible name of the Solid | Gradient switch: what the switch sets the type of. */
  typeLabel: string;
  value: Fill;
  /** Every change, once per gesture: a stop's colour, a stop added or removed, a switch between
   * Solid and Gradient, a stop moved (when a drag, a held key or a typed position ends). */
  onChange: (fill: Fill) => void;
  /** No Solid | Gradient switch and no stops rows: the value stays one colour (the Platform Bar
   * text cannot be a gradient). */
  solidOnly?: boolean;
  /** The gradient a switch to Solid left, for a switch back. The caller owns it so that it outlives
   * this popover's content (unmounted on close, with the picked stop) and dies with the surface's
   * picker; never saved. */
  lastGradient: RefObject<KeptGradient | null>;
  active?: boolean;
  /** A primary press on the strip, a stop, the checked mode or the hex control: the caller decides
   * whether that picks this fill as it is (see ColorEditor). */
  onActivate?: () => void;
  onDone?: () => void;
}

// A position shown on the strip, the beads and the input but not yet saved: the stop being
// dragged, nudged by a held key or typed. Saved once, when the gesture ends.
interface PendingMove {
  index: number;
  position: number;
}

// The beads' centres run from BEAD_INSET px to 100% - BEAD_INSET px of the strip's padding box, so
// even an end bead stays whole inside it. The strip's image is laid over the border box, 1px further
// out, hence fillStripImage(…, BEAD_INSET + 1).
const BEAD_INSET = 12;
// A press that wanders less than this is a press, not a drag (as in useRowReorder).
const DRAG_THRESHOLD = 3;

// Where Add stop puts the new stop: in the middle of the wider of the gaps beside the stop being
// edited (an end has one; the right one on a tie), or, when that gap has no whole percent inside
// it, of the widest gap on the bar (the rightmost on a tie). Seven stops leave a gap of 17 or more,
// so Add is only ever refused for the count.
function addPosition(gradient: Gradient, current: number): number {
  const positions = gradient.stops.map((stop) => stop.position);
  const width = (gap: number) => (positions[gap + 1] ?? 0) - (positions[gap] ?? 0);
  const widest = (gaps: number[]) => gaps.reduce((best, gap) => (width(gap) >= width(best) ? gap : best));
  let gap = widest([current - 1, current].filter((g) => g >= 0 && g < positions.length - 1));
  if (width(gap) < 2) gap = widest(positions.slice(1).map((_, g) => g));
  return Math.floor(((positions[gap] ?? 0) + (positions[gap + 1] ?? 0)) / 2);
}

// Whether no more digits can turn `text` into a position between `min` and `max`: "2" between 34
// and 99 (20 to 29 fall short, 200 and on go past). An empty field is on its way to one.
function deadEnd(text: string, min: number, max: number): boolean {
  if (text === '') return false;
  if (!/^\d+$/.test(text)) return true;
  // With k more digits, the text reaches from n·10^k to n·10^k + 10^k − 1.
  for (let low = Number(text), high = low; low <= max; low *= 10, high = high * 10 + 9) {
    if (high >= min) return false;
  }
  return true;
}

// Where a key sends an inner stop at `position` between `min` and `max`; undefined for a key that
// does not move it.
function keyedPosition(e: ReactKeyboardEvent, position: number, min: number, max: number): number | undefined {
  const step = e.shiftKey ? 10 : 1;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return position + step;
    case 'ArrowLeft':
    case 'ArrowDown':
      return position - step;
    case 'PageUp':
      return position + 10;
    case 'PageDown':
      return position - 10;
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return undefined;
  }
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

// A fill opened for editing, in one of two modes, read from the value itself: Solid is the
// ColorEditor alone, Gradient adds two rows above it, a strip previewing the gradient with one bead
// per stop, and a row with the picked stop's position, Add stop and Remove stop. The ColorEditor
// edits the stop picked on the strip. A switch never changes the colour the ColorEditor shows
// (see switchTo); Solid gives the two rows' height to a taller face (style.css,
// `.fill-editor[data-mode="solid"]`), so the popover keeps one box across a switch.
//
// The end stops are buttons fixed at 0 and 100; the inner ones are sliders, moved by a drag, the
// keyboard or the position input, which all show the move at once and save it once, when the
// gesture ends (`pending`). Inner beads are drawn over the ends and the focused bead over all, so
// a pointer over an inner bead always reaches one that can be moved apart. Tab focus alone picks
// no stop: passing through would otherwise switch the hex input and the position to the last one.
//
// The stop being edited is marked by size, never by the accent ring: the ring is this panel's
// one "in use" mark, and a palette entry in use next to a kept gradient would otherwise show two
// rings that mean two things.
export default function FillEditor({
  hexLabel,
  typeLabel,
  value,
  onChange,
  solidOnly,
  lastGradient,
  active,
  onActivate,
  onDone,
}: FillEditorProps) {
  const mode = value instanceof Gradient ? 'gradient' : 'solid';
  const [selected, setSelected] = useState(0);
  const [pending, setPendingState] = useState<PendingMove | null>(null);
  // The position input's text while it is being typed; null shows the stop's position.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value instanceof Gradient && pending ? value.moveStop(pending.index, pending.position) : value;
  // A gradient shortened from outside (another rule, a palette edit) keeps the last stop in view.
  const current = shown instanceof Gradient ? Math.min(selected, shown.stops.length - 1) : 0;
  const editing = shown instanceof Gradient ? (shown.stops[current] ?? shown.stops[0]).color : shown;

  // A drag's window listeners outlive the render that started it, so the move is saved through
  // refs that always hold the latest value and the pending position.
  const pendingRef = useRef<PendingMove | null>(null);
  const latest = useRef({ value, onChange });
  useLayoutEffect(() => {
    latest.current = { value, onChange };
  });
  // A value turned Solid from outside (another window's save) takes the stops rows away with no
  // blur or keyup: a move or a draft left behind would come back on the next gradient, and be saved.
  useLayoutEffect(() => {
    if (mode !== 'solid') return;
    pendingRef.current = null;
    setPendingState(null);
    setDraft(null);
  }, [mode]);
  const setPending = (next: PendingMove | null) => {
    pendingRef.current = next;
    setPendingState(next);
  };
  const commit = () => {
    const move = pendingRef.current;
    if (!move) return;
    setPending(null);
    const { value: saved, onChange: save } = latest.current;
    if (!(saved instanceof Gradient)) return;
    const moved = saved.moveStop(move.index, move.position);
    if (moved !== saved) save(moved);
  };
  const cancel = () => setPending(null);

  // Add and Remove say where focus goes next; the effect below moves it once the new stops are
  // on screen (the parent saves synchronously, so they are in the same commit). Nothing else sets
  // this, so opening the popover, a clamp or an outside change leave react-aria's focus alone,
  // and a button that has just become disabled never drops focus to the page.
  const pendingFocus = useRef<number | null>(null);
  const rowRef = useRef<HTMLFieldSetElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    rowRef.current?.querySelector<HTMLElement>(`[aria-label="Stop ${target + 1}"]`)?.focus();
  });

  // The listeners of the drag in progress come off with it, or when the popover closes under it.
  const detachDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => detachDrag.current?.(), []);

  // A switch keeps the colour being edited: Solid takes the picked stop's colour, and Gradient comes
  // back with the picked stop wearing the colour Solid ended on. One change, saved at once.
  const switchTo = (next: 'solid' | 'gradient') => {
    if (next === mode) {
      onActivate?.();
      return;
    }
    if (value instanceof Gradient) {
      lastGradient.current = { gradient: value, index: current };
      onChange(editing);
      return;
    }
    const back = lastGradient.current;
    const index = back?.index ?? 1;
    const grown =
      back?.gradient.changeStop(index, value) ??
      Gradient.fromStops([
        { color: value, position: Gradient.MIN_POSITION },
        { color: value, position: Gradient.MAX_POSITION },
      ]);
    if (!grown) return;
    setSelected(index);
    onChange(grown);
  };

  // The new stop takes the colour already at its place, so the bar does not change until the user
  // edits it.
  const addStop = () => {
    if (!(value instanceof Gradient)) return;
    const position = addPosition(value, current);
    const grown = value.insertStop(position);
    if (grown === value) return;
    const index = grown.stops.findIndex((stop) => stop.position === position);
    setSelected(index);
    pendingFocus.current = index;
    onChange(grown);
  };

  // Disabled at two stops: the switch is the one way to a colour.
  const removeStop = () => {
    if (!(value instanceof Gradient)) return;
    const shrunk = value.removeStop(current);
    if (!(shrunk instanceof Gradient)) return;
    const next = Math.max(0, current - 1);
    setSelected(next);
    pendingFocus.current = next;
    onChange(shrunk);
  };

  // A press on a stop picks it for editing and, like a press on the hex control, is a press on
  // the custom choice. The strip's own pointer handler leaves presses on a stop to this one, so
  // one press activates once, from the pointer or the keyboard alike.
  const pickStop = (index: number) => {
    setSelected(index);
    onActivate?.();
  };

  // An inner stop follows the pointer from where it was pressed (in the strip's travel, the width
  // the bead centres span), and is saved on release only. Anything else that ends the gesture (a
  // cancelled pointer, a lost capture, the window losing focus, Escape) puts it back unsaved. The
  // listeners come off before the capture is let go, so letting go ourselves is not a loss.
  const startDrag = (index: number, e: ReactPointerEvent<HTMLElement>) => {
    if (!e.isPrimary || e.button !== 0 || detachDrag.current || !(shown instanceof Gradient)) return;
    pickStop(index);
    const bead = e.currentTarget;
    const { pointerId, clientX: startX } = e;
    const startPosition = shown.stops[index]?.position ?? 0;
    const travel = (stripRef.current?.clientWidth ?? 0) - 2 * BEAD_INSET;
    let moved = false;
    const ours = (event: PointerEvent) => event.pointerId === pointerId;
    const onMove = (event: PointerEvent) => {
      if (!ours(event) || travel <= 0) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      moved = true;
      setPending({ index, position: Math.round(startPosition + (dx / travel) * 100) });
    };
    const onUp = (event: PointerEvent) => {
      if (!ours(event)) return;
      detach();
      if ('hasPointerCapture' in bead && bead.hasPointerCapture(pointerId)) bead.releasePointerCapture(pointerId);
      commit();
    };
    const onLost = () => {
      detach();
      cancel();
    };
    const onCancel = (event: PointerEvent) => {
      if (ours(event)) onLost();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !moved) return;
      // Ours alone: the popover must not close on the same Escape.
      event.preventDefault();
      event.stopPropagation();
      onLost();
    };
    const detach = () => {
      detachDrag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onLost);
      bead.removeEventListener('lostpointercapture', onLost);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onLost);
    bead.addEventListener('lostpointercapture', onLost);
    detachDrag.current = detach;
    // jsdom has no pointer capture; the window listeners work either way.
    if ('setPointerCapture' in bead) bead.setPointerCapture(pointerId);
  };

  // A moving key picks the stop even when it cannot move (penned in by its neighbours, the
  // keyboard is then the way to reach it), shows the move at once and saves it on keyup, so a
  // held key saves once. Handled keys do not scroll the dialog.
  const onStopKeyDown = (index: number, min: number, max: number, e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickStop(index);
      return;
    }
    if (!(shown instanceof Gradient)) return;
    const position = keyedPosition(e, shown.stops[index]?.position ?? min, min, max);
    if (position === undefined) return;
    e.preventDefault();
    setSelected(index);
    setPending({ index, position });
  };

  // The window losing focus (another window, the console's page) is not leaving the control, which
  // is then still the document's active element: a drag is cancelled by its own listener, and a
  // held key or a typed position stays as it is until focus really moves on.
  const leftControl = (e: React.FocusEvent<HTMLElement>) => document.activeElement !== e.currentTarget;

  // Typed digits move the stop on the strip as soon as they are a position it can take, and save
  // once the position is complete: one more digit would take it past the stop's room, so "4" on
  // the way to "45" between 31 and 69 is only a draft, and "45" saves. Enter, Escape or leaving the
  // field saves a valid position typed short of that; anything else is not saved, and leaving shows
  // the stop's position again. No clamping while typing: "9" on the way to "95" would turn into 89.
  // Escape goes on to close the popover, which unmounts the field without a blur, so it saves here:
  // the position on the strip is the one saved, however the popover closes.
  const onPositionChange = (text: string, min: number, max: number) => {
    setDraft(text);
    const position = Number(text);
    if (!/^\d+$/.test(text) || position < min || position > max) {
      cancel();
      return;
    }
    setPending({ index: current, position });
    if (position * 10 > max) commit();
  };
  const endPosition = () => {
    commit();
    setDraft(null);
  };
  const rangeHintId = useId();

  const strip = (gradient: Gradient) => {
    const last = gradient.stops.length - 1;
    const editedStop = gradient.stops[current] ?? gradient.stops[0];
    const isEnd = current === 0 || current === last;
    const room = {
      min: (gradient.stops[current - 1]?.position ?? Gradient.MIN_POSITION - 1) + 1,
      max: (gradient.stops[current + 1]?.position ?? Gradient.MAX_POSITION + 1) - 1,
    };
    // A draft that cannot become a position is marked as the hex input marks one, since leaving the
    // field would otherwise put the stop's position back without a word.
    const invalid = draft !== null && deadEnd(draft, room.min, room.max);
    return (
      // A fieldset is the group role's own element; min-w-0 undoes its min-content width, so the
      // rows narrow with a narrow dialog (Tailwind's preflight already drops its border and
      // padding). Its 32 + 8 + 32px, and the 12px gap under it, are what the solid face's 224px in
      // style.css stands for: change one and change the other.
      <fieldset ref={rowRef} aria-label="Gradient stops" className="flex min-w-0 shrink-0 flex-col gap-2">
        {/* Longhands, never the `background` shorthand: it would reset the background-origin
            .fill-strip sets in style.css. */}
        <div
          ref={stripRef}
          className="fill-strip relative h-8 w-full rounded-md border"
          style={{
            backgroundColor: gradient.stops[0].color.toHex(),
            backgroundImage: fillStripImage(gradient, BEAD_INSET + 1),
          }}
          onPointerDown={(e) => {
            if (e.button === 0 && !(e.target as Element).closest('button, [role="slider"]')) onActivate?.();
          }}
        >
          {gradient.stops.map((stop, i) => {
            const isSelected = i === current;
            const bead = `color-chip absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
              isSelected ? 'h-5 w-5' : 'h-4 w-4'
            }`;
            const style = {
              left: `calc(${BEAD_INSET}px + (100% - ${2 * BEAD_INSET}px) * ${stop.position / 100})`,
              backgroundColor: stop.color.toHex(),
            };
            if (i === 0 || i === last) {
              return (
                <button
                  // Stops have no identity beyond their place in the row.
                  // biome-ignore lint/suspicious/noArrayIndexKey: see above
                  key={i}
                  type="button"
                  aria-label={`Stop ${i + 1}`}
                  aria-pressed={isSelected}
                  data-selected={isSelected}
                  onClick={() => pickStop(i)}
                  className={`${bead} cursor-pointer`}
                  style={style}
                />
              );
            }
            const min = (gradient.stops[i - 1]?.position ?? 0) + 1;
            const max = (gradient.stops[i + 1]?.position ?? 0) - 1;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: as for the ends
                key={i}
                role="slider"
                tabIndex={0}
                aria-label={`Stop ${i + 1}`}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={stop.position}
                aria-valuetext={`${stop.position}%`}
                // The ends say it with aria-pressed, which a slider cannot take.
                aria-current={isSelected || undefined}
                data-selected={isSelected}
                onPointerDown={(e) => startDrag(i, e)}
                onKeyDown={(e) => onStopKeyDown(i, min, max, e)}
                onKeyUp={(e) => {
                  if (keyedPosition(e, stop.position, min, max) !== undefined) commit();
                }}
                onBlur={(e) => {
                  if (leftControl(e)) commit();
                }}
                // A press without a pointer (VoiceOver's VO+Space, voice control) clicks only; a
                // real press has already picked the stop on pointerdown.
                onClick={() => {
                  if (i !== current) pickStop(i);
                }}
                className={`${bead} cursor-ew-resize ${isSelected ? 'z-10' : 'z-[1]'}`}
                style={style}
              />
            );
          })}
        </div>
        <div className="flex h-8 items-center gap-2">
          {/* type="text", not "number": a number input's spin buttons, which Firefox shows even when
              it is disabled, hide the third digit of "100" in 56px, and its arrow keys would save at
              every step. The stops' keys move by 1 and 10 instead. Unlike the Height input, then,
              it has no spin buttons. */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label={`Stop ${current + 1} position`}
            autoComplete="off"
            disabled={isEnd}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? rangeHintId : undefined}
            value={draft ?? String(editedStop.position)}
            onChange={(e) => onPositionChange(e.target.value, room.min, room.max)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') endPosition();
            }}
            onBlur={(e) => {
              if (leftControl(e)) endPosition();
            }}
            className={`outlined-control h-8 w-14 rounded-md border border-border bg-transparent px-2 text-sm disabled:opacity-50 ${
              invalid ? 'text-danger' : ''
            }`}
          />
          <span className="text-sm text-muted">%</span>
          <span id={rangeHintId} className="sr-only">
            {`Enter a position from ${room.min} to ${room.max}`}
          </span>
          {/* The same tooltip pairing as DeleteConfirmPopover: tabIndex={-1} keeps the trigger's
              own wrapper out of the Tab order next to the button. */}
          <Tooltip delay={500}>
            <Tooltip.Trigger tabIndex={-1} className="ml-auto">
              <Button
                isIconOnly
                variant="outline"
                size="sm"
                aria-label="Add stop"
                isDisabled={gradient.stops.length >= Gradient.MAX_STOPS}
                onPress={addStop}
              >
                <PlusIcon />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {gradient.stops.length >= Gradient.MAX_STOPS ? `Up to ${Gradient.MAX_STOPS} stops` : 'Add stop'}
            </Tooltip.Content>
          </Tooltip>
          <Tooltip delay={500}>
            <Tooltip.Trigger tabIndex={-1}>
              <Button
                isIconOnly
                variant="outline"
                size="sm"
                aria-label="Remove stop"
                isDisabled={gradient.stops.length <= Gradient.MIN_STOPS}
                onPress={removeStop}
              >
                <MinusIcon />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>
              {gradient.stops.length <= Gradient.MIN_STOPS ? `At least ${Gradient.MIN_STOPS} stops` : 'Remove stop'}
            </Tooltip.Content>
          </Tooltip>
        </div>
      </fieldset>
    );
  };

  return (
    <div className="fill-editor flex flex-col gap-3" data-mode={solidOnly ? undefined : mode}>
      {!solidOnly && (
        <ToggleButtonGroup
          aria-label={typeLabel}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[mode]}
          size="sm"
          className="fill-mode"
          // Pressing the checked option re-reports its own key (react-stately's toggleKey builds a
          // new Set under disallowEmptySelection, and useControlledState compares by Object.is):
          // that is a press on the custom control, like a press on the strip; only the other key
          // switches.
          onSelectionChange={(keys) => {
            const [key] = keys;
            if (key === 'solid' || key === 'gradient') switchTo(key);
          }}
        >
          {/* Only the checked option is a Tab stop, as in a native radio group: useToolbar has no
              roving tabindex, so without this Tab would land on Solid whichever is checked. Arrow
              keys still reach both (the toolbar's focus manager walks focusable, not tabbable,
              elements). No aria-label: the text names each option. */}
          <ToggleButton id="solid" excludeFromTabOrder={mode !== 'solid'}>
            Solid
          </ToggleButton>
          <ToggleButton id="gradient" excludeFromTabOrder={mode !== 'gradient'}>
            Gradient
          </ToggleButton>
        </ToggleButtonGroup>
      )}
      {!solidOnly && shown instanceof Gradient && strip(shown)}
      <ColorEditor
        hexLabel={shown instanceof Gradient ? `${hexLabel}, stop ${current + 1}` : hexLabel}
        value={editing.toHex()}
        onChange={(c) => onChange(value instanceof Gradient ? value.changeStop(current, c) : c)}
        active={active}
        onActivate={onActivate}
        onDone={onDone}
      />
    </div>
  );
}
