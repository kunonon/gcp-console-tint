import type { ColorValue } from '@heroui/react';
import { ColorArea, ColorSlider, parseColor } from '@heroui/react';
import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { Color } from '../../../../../domain/color';

interface ColorEditorProps {
  /** Accessible name of the hex input: "Hex" in a palette row's popover, "Custom color" in a
   * surface picker's. */
  hexLabel: string;
  /** '#rrggbb', lowercase (a domain Color's toHex()). */
  value: string;
  /** Every change, as a domain Color: each pointer move of a drag, each arrow key, each
   * complete hex typed. */
  onChange: (color: Color) => void;
  /** Among alternatives (the surface pickers), whether this colour is the one in use: rings
   * the hex control. Leave undefined where there are no alternatives. */
  active?: boolean;
  /** A press on the hex control while it is not the choice: pick this colour as it is. */
  onActivate?: () => void;
  /** Enter in the hex input with nothing left to commit: the user is done. `changed` says that
   * this same Enter called onChange (a shorthand expanded): the parent has not re-rendered since,
   * so a second update from here would be built on the settings from before that change. */
  onDone?: (changed: boolean) => void;
}

const toHex = (c: ColorValue) => c.toString('hex').toLowerCase();
const toHsb = (hex: string) => parseColor(hex).toFormat('hsb');

// Text that can still become a hex by typing more: an optional '#' and up to six hex digits.
// Anything else (a 'z', a seventh digit, 'rgb(...)') is a draft that cannot be committed.
const PARTIAL_HEX = /^#?[0-9a-f]{0,6}$/i;
// A pasted value may carry whitespace and may lack its '#'.
const parseHex = (text: string) => {
  const trimmed = text.trim();
  return Color.fromHex(trimmed.startsWith('#') ? trimmed : `#${trimmed}`);
};
// The 3-digit shorthand (#fff) is a complete value too, but only once the user says so (Enter
// or leaving the field): expanding it as it is typed would tint the console #dd9933 on the way
// to #d93025.
const SHORT_HEX = /^#?([0-9a-f]{3})$/i;
const expandShortHex = (text: string) => {
  const digits = SHORT_HEX.exec(text.trim())?.[1];
  return digits ? Color.fromHex(`#${[...digits].map((d) => d + d).join('')}`) : undefined;
};

// A colour opened for editing: the bead-and-hex control every picker's trigger already is,
// with the well under it, a saturation/brightness face and the hue strip fused into one rounded
// shape whose two thumbs are the same bead (style.css). Shared by the palette rows
// (ColorSwatchField) and the surface pickers (PaletteColorPicker); speaks the domain's lowercase
// '#rrggbb' in and out.
export default function ColorEditor({ hexLabel, value, onChange, active, onActivate, onDone }: ColorEditorProps) {
  // The well holds the HSB colour, not only the hex: a hex forgets its hue at saturation 0 or
  // brightness 0, and the thumb would snap to red on the way back out of a grey.
  const [color, setColor] = useState(() => toHsb(value));
  // Follow the parent only when it holds a different colour than ours (typed hex, palette
  // change, another rule). Render-time state adjustment; the hex comparison cannot loop.
  if (toHex(color) !== value) setColor(toHsb(value));
  // The hex input's text while it is being edited; null shows the current value. A draft Enter
  // could not commit is shown as wrong until it is edited again.
  const [draft, setDraft] = useState<string | null>(null);
  const [rejected, setRejected] = useState(false);
  const shown = draft ?? value;
  const invalid = rejected || !PARTIAL_HEX.test(shown.trim());
  const hintId = useId();

  // The same colour again (a trailing space, the value retyped) is not a change. Returns whether
  // onChange was called.
  const commit = (color: Color) => {
    if (color.toHex() === value) return false;
    onChange(color);
    return true;
  };

  const handleWellChange = (next: ColorValue) => {
    const hsb = next.toFormat('hsb');
    setColor(hsb);
    const parsed = Color.fromHex(toHex(hsb));
    if (parsed) commit(parsed);
  };

  // Every keystroke that forms a complete hex commits, so a pasted brand hex applies at once
  // (with or without its '#', in any case) and the field shows the canonical lowercase form. An
  // incomplete or wrong draft stays as typed while the field is focused.
  const handleHexChange = (text: string) => {
    const parsed = parseHex(text);
    if (parsed) commit(parsed);
    setDraft(parsed ? null : text);
    setRejected(false);
  };

  // Leaving the field: a shorthand draft is committed, any other draft is dropped. The window
  // losing focus (another window, the console's page) is not leaving the field, which is then
  // still the document's active element: the draft stays as typed, and coming back does not
  // select it (see onFocus), so the user types on.
  const handleHexBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (document.activeElement === e.currentTarget) return;
    const short = draft === null ? undefined : expandShortHex(draft);
    if (short) commit(short);
    setDraft(null);
    setRejected(false);
  };

  const handleHexKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // A six-digit hex was committed as it was typed, so a draft here is a shorthand (committed
    // now) or one that cannot be a colour (kept, shown as wrong, the popover stays open).
    let changed = false;
    if (draft !== null) {
      const short = expandShortHex(draft);
      if (!short) {
        setRejected(true);
        return;
      }
      changed = commit(short);
      setDraft(null);
    }
    onDone?.(changed);
  };

  return (
    <div className="color-editor flex flex-col gap-3">
      {/* A label, so a press on the bead or the border lands in the input with the caret ready.
          The primary button's press also picks this colour where it is one choice among others
          (a right click to paste must not). */}
      <label
        className={`hex-control outlined-control flex h-8 cursor-text items-center gap-2 rounded-md border border-border bg-transparent px-2 ${
          active ? 'ring-2 ring-focus ring-offset-2 ring-offset-overlay' : ''
        }`}
        onPointerDown={(e) => {
          if (e.button === 0 && !active) onActivate?.();
        }}
      >
        <span
          aria-hidden="true"
          className="color-chip h-5 w-5 shrink-0 rounded-full border"
          style={{ backgroundColor: value }}
        />
        <input
          type="text"
          aria-label={hexLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? hintId : undefined}
          autoComplete="off"
          spellCheck={false}
          value={shown}
          onChange={(e) => handleHexChange(e.target.value)}
          // A value is replaced, not edited: focusing selects it all, so a paste or retyping
          // lands over it.
          onFocus={(e) => {
            if (draft === null) e.currentTarget.select();
          }}
          onBlur={handleHexBlur}
          onKeyDown={handleHexKeyDown}
          className={`min-w-0 flex-1 bg-transparent font-mono text-sm outline-none ${
            invalid ? 'text-danger' : 'text-muted focus:text-foreground'
          }`}
        />
      </label>
      {/* What a draft marked as wrong should have been, for assistive technology (the mark itself
          is only the text colour). */}
      <span id={hintId} className="sr-only">
        Enter a hex color like #1a73e8
      </span>
      {/* A press on the well picks the colour under the pointer, so a draft is dropped before the
          press takes focus from the field; committed there, a shorthand would be written over
          the colour just picked. flushSync: the field's handler must see no draft by then. */}
      <div className="color-well" onPointerDownCapture={() => flushSync(() => setDraft(null))}>
        <ColorArea
          aria-label="Saturation and brightness"
          colorSpace="hsb"
          xChannel="saturation"
          yChannel="brightness"
          value={color}
          onChange={handleWellChange}
        >
          <ColorArea.Thumb />
        </ColorArea>
        <ColorSlider aria-label="Hue" channel="hue" colorSpace="hsb" value={color} onChange={handleWellChange}>
          <ColorSlider.Track>
            <ColorSlider.Thumb />
          </ColorSlider.Track>
        </ColorSlider>
      </div>
    </div>
  );
}
