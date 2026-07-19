import { Popover } from '@heroui/react';
import type { PaletteEntry } from '../types';
import ColorSwatchField from './ColorSwatchField';

interface PaletteColorPickerProps {
  ariaLabel: string;
  paletteEnabled: boolean;
  palette: PaletteEntry[];
  paletteId: string | null;
  customColor: string;
  effectiveColor: string;
  onSelectPaletteEntry: (id: string) => void;
  onSelectCustomColor: (color: string) => void;
  supportsAuto?: boolean;
  autoSelected?: boolean;
  onSelectAuto?: () => void;
}

export default function PaletteColorPicker({
  ariaLabel,
  paletteEnabled,
  palette,
  paletteId,
  customColor,
  effectiveColor,
  onSelectPaletteEntry,
  onSelectCustomColor,
  supportsAuto,
  autoSelected,
  onSelectAuto,
}: PaletteColorPickerProps) {
  const referencedEntry = paletteEnabled && paletteId ? palette.find((e) => e.id === paletteId) : undefined;
  const isCustomActive = !autoSelected && !referencedEntry;
  const triggerLabel = autoSelected ? 'Auto' : referencedEntry ? referencedEntry.name || '(unnamed)' : effectiveColor;

  return (
    <Popover>
      <Popover.Trigger>
        <button
          type="button"
          aria-label={ariaLabel}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-transparent px-2"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 rounded-full border border-border"
            style={{ backgroundColor: effectiveColor }}
          />
          <span className="font-mono text-sm text-muted">{triggerLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content>
        <Popover.Dialog className="flex w-56 flex-col gap-3 p-3">
          {supportsAuto && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted">Auto</span>
              <button
                type="button"
                aria-label="Auto"
                onClick={() => onSelectAuto?.()}
                className={`cursor-pointer rounded-md border border-border px-2 py-1 text-left text-sm ${
                  autoSelected ? 'ring-2 ring-focus' : ''
                }`}
              >
                Match contrast
              </button>
            </div>
          )}
          {paletteEnabled && palette.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm text-muted">Palette</span>
              <div className="flex flex-wrap gap-2">
                {palette.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-label={entry.name || '(unnamed)'}
                    onClick={() => onSelectPaletteEntry(entry.id)}
                    className={`h-7 w-7 cursor-pointer rounded-full border border-border ${
                      !autoSelected && paletteId === entry.id ? 'ring-2 ring-focus' : ''
                    }`}
                    style={{ backgroundColor: entry.color }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted">Custom</span>
            <ColorSwatchField
              ariaLabel="Custom color"
              value={customColor}
              onChange={(e) => onSelectCustomColor(e.target.value)}
              active={isCustomActive}
            />
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
