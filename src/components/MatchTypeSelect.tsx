import { ListBox, Select } from '@heroui/react';
import type { MatchType } from '../types';
import { MATCH_TYPES } from '../utils/settings';

// Shared between the detail page's Pattern card and AddRuleModal so both surfaces speak the
// same match-type vocabulary (previously the modal used a separate radio list with its own
// wording — one control, one set of labels, used everywhere).
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  prefix: 'Starts with',
  suffix: 'Ends with',
  exact: 'Exact',
  regex: 'Regex',
};

interface MatchTypeSelectProps {
  value: MatchType;
  onChange: (matchType: MatchType) => void;
  ariaLabel?: string;
}

// Renders only the Select control, not its row label — call sites place it in their own
// label/control row (e.g. the app's `flex min-h-8 items-center justify-between gap-2` idiom).
export default function MatchTypeSelect({ value, onChange, ariaLabel = 'Match type' }: MatchTypeSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      value={value}
      onChange={(key) => {
        if (key != null) onChange(key as MatchType);
      }}
    >
      {/* No gap utility here: Select.Indicator is absolutely positioned (see the
          .select__trigger override in style.css), so flex gap between it and Select.Value has
          no effect — spacing comes from that unlayered CSS instead. */}
      <Select.Trigger className="flex h-8 min-w-0 items-center rounded-md border border-border bg-transparent px-2 text-sm">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {MATCH_TYPES.map((type) => (
            <ListBox.Item key={type} id={type} textValue={MATCH_TYPE_LABELS[type]}>
              {MATCH_TYPE_LABELS[type]}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
