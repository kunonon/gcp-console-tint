interface ColorSwatchFieldProps {
  ariaLabel: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  active?: boolean;
}

export default function ColorSwatchField({ ariaLabel, value, onChange, active }: ColorSwatchFieldProps) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-border bg-transparent px-2 py-1 ${
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
      <span className="font-mono text-sm text-muted">{value}</span>
    </label>
  );
}
