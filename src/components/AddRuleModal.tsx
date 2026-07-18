import { useEffect, useState } from 'react';
import { Button, Input, Modal, Radio, RadioGroup, Tooltip } from '@heroui/react';
import type { MatchType } from '../types';
import { MATCH_TYPES } from '../utils/settings';

// Shared with App.tsx's detail-page Match type Select so both surfaces speak the same labels.
export const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  prefix: 'Starts with',
  suffix: 'Ends with',
  exact: 'Exact',
  regex: 'Regex',
};

const valueInputClassName = 'h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-sm';

interface AddRuleModalProps {
  onAdd: (matchType: MatchType, pattern: string) => void;
  children: React.ReactNode;
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Opens a modal (rather than App's old inline row) so a match type can be picked alongside the
// pattern text. Follows DeleteConfirmPopover's trigger-composition idiom: a Tooltip wraps the
// whole overlay tree (not just the trigger button), and there is no Cancel button — dismissal
// (Esc / backdrop / the modal's own close trigger) is the only cancel path.
export default function AddRuleModal({ onAdd, children }: AddRuleModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [matchType, setMatchType] = useState<MatchType>('exact');
  const [value, setValue] = useState('');

  // Reset to defaults on every open, not just on mount, since the modal is reused across opens.
  useEffect(() => {
    if (isOpen) {
      setMatchType('exact');
      setValue('');
    }
  }, [isOpen]);

  const trimmed = value.trim();
  const isRegexInvalid = matchType === 'regex' && !isValidRegex(trimmed);
  const canAdd = trimmed !== '' && !isRegexInvalid;
  const valueLabel = matchType === 'regex' ? 'Pattern' : 'Project ID';

  const commit = () => {
    if (!canAdd) return;
    onAdd(matchType, trimmed);
    setIsOpen(false);
  };

  const handleValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return (
    <Tooltip delay={500}>
      <Tooltip.Trigger tabIndex={-1}>
        <Modal isOpen={isOpen} onOpenChange={setIsOpen}>
          <Modal.Trigger>{children}</Modal.Trigger>
          <Modal.Backdrop>
            <Modal.Container size="sm">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>Add project rule</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-2">
                  <RadioGroup
                    aria-label="Match type"
                    value={matchType}
                    onChange={(next) => setMatchType(next as MatchType)}
                    className="flex flex-col"
                  >
                    {MATCH_TYPES.map((type) => (
                      <Radio key={type} value={type}>
                        <Radio.Content className="flex min-h-8 w-full items-center gap-2">
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <span className="text-sm">{MATCH_TYPE_LABELS[type]}</span>
                        </Radio.Content>
                      </Radio>
                    ))}
                  </RadioGroup>
                  <div className="flex min-h-8 items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="text-sm">{valueLabel}</span>
                    <Input
                      aria-label={valueLabel}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      onKeyDown={handleValueKeyDown}
                      className={valueInputClassName}
                    />
                  </div>
                  {isRegexInvalid && <span className="text-sm text-danger">Invalid regular expression</span>}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="primary" className="w-full" isDisabled={!canAdd} onPress={commit}>
                    Add
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </Tooltip.Trigger>
      <Tooltip.Content>Add rule</Tooltip.Content>
    </Tooltip>
  );
}
