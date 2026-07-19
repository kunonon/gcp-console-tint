interface ColorSwatchFieldProps {
  ariaLabel: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  active?: boolean;
  hexHidableOnNarrow?: boolean;
}

export default function ColorSwatchField({
  ariaLabel,
  value,
  onChange,
  active,
  hexHidableOnNarrow,
}: ColorSwatchFieldProps) {
  return (
    <label
      className={`flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-transparent px-2 ${
        active ? 'ring-2 ring-focus' : ''
      }`}
    >
      <input
        type="color"
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <span className={`font-mono text-sm text-muted ${hexHidableOnNarrow ? 'hidden @min-[220px]:inline' : ''}`}>
        {value}
      </span>
    </label>
  );
}
