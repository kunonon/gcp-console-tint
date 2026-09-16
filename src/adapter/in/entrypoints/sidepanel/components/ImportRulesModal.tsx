import { Alert, Button, Checkbox, Modal, Tooltip } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { ProjectRule } from '../../../../../domain/project-rule';
import type { TintSettings } from '../../../../../domain/tint-settings';

interface ImportRulesModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Name of the picked file, shown so the user can tell which file they are importing. */
  fileName: string;
  /** Rules parsed out of that file, in file order. */
  incoming: readonly ProjectRule[];
  /** The rules already configured, used only to mark which incoming rules would replace one. */
  current: TintSettings;
  onImport: (selected: readonly ProjectRule[]) => void;
}

function TriangleAlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-warning-soft-foreground"
      role="img"
      aria-label="Replaces an existing rule"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// Confirmation step between picking a settings file and merging it: the user sees every rule the
// file carries, which of them would overwrite a rule they already have, and picks what to take.
//
// Unlike AddRuleModal this modal is opened programmatically (there is no button to hang a
// Modal.Trigger on — it opens after a file is read), so it is fully controlled via isOpen /
// onOpenChange. HeroUI's Modal root is a react-aria DialogTrigger, which takes those two props
// directly and only uses a trigger child as an additional way to open itself, so leaving the
// trigger out is supported.
export default function ImportRulesModal({
  isOpen,
  onOpenChange,
  fileName,
  incoming,
  current,
  onImport,
}: ImportRulesModalProps) {
  // Selection is by position rather than by rule id: ids come from the imported file, which is
  // free to repeat them, while positions are unique by construction.
  const [selected, setSelected] = useState<readonly boolean[]>([]);

  // Reset to "everything selected" on every open, not just on mount, since the modal instance is
  // reused across imports (same reason as AddRuleModal's reset effect).
  useEffect(() => {
    if (isOpen) setSelected(incoming.map(() => true));
  }, [isOpen, incoming]);

  const isSelectedAt = (index: number) => selected[index] ?? false;
  const isDuplicate = (rule: ProjectRule) => current.projectRules.some((existing) => existing.isDuplicateOf(rule));

  const selectedRules = incoming.filter((_, index) => isSelectedAt(index));
  const selectedCount = selectedRules.length;
  const replacedCount = selectedRules.filter(isDuplicate).length;

  const toggleAt = (index: number) => (isChecked: boolean) => {
    setSelected(incoming.map((_, i) => (i === index ? isChecked : isSelectedAt(i))));
  };

  const toggleAll = (isChecked: boolean) => {
    setSelected(incoming.map(() => isChecked));
  };

  const commit = () => {
    onImport(selectedRules);
    onOpenChange(false);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Import rules</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-2">
              <span className="truncate font-mono text-sm">{fileName}</span>

              <div className="flex min-h-8 items-center justify-between gap-2">
                <Checkbox
                  isSelected={selectedCount === incoming.length && incoming.length > 0}
                  isIndeterminate={selectedCount > 0 && selectedCount < incoming.length}
                  onChange={toggleAll}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    Select all
                  </Checkbox.Content>
                </Checkbox>
                <span className="shrink-0 text-xs text-muted">
                  {selectedCount} of {incoming.length} selected
                </span>
              </div>

              <div className="flex flex-col gap-1 border-t border-border pt-2">
                {incoming.map((rule, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for the lifetime of one import (never reordered, inserted into or filtered), and the rules' own ids come from the imported file, which is free to repeat them
                  <div key={index} className="flex min-h-6 items-center gap-3">
                    <Checkbox aria-label={rule.pattern} isSelected={isSelectedAt(index)} onChange={toggleAt(index)}>
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                    <span className="min-w-0 flex-1 truncate font-mono text-sm">{rule.pattern}</span>
                    {isDuplicate(rule) && (
                      // The icon itself is not interactive, so unlike IconButtonTooltip in App.tsx
                      // this trigger keeps its default tabIndex: the focusable wrapper it renders is
                      // the only way to reach the explanation by keyboard.
                      <Tooltip delay={500}>
                        <Tooltip.Trigger className="shrink-0">
                          <TriangleAlertIcon />
                        </Tooltip.Trigger>
                        <Tooltip.Content>
                          Replaces your existing rule with the same match type and pattern.
                        </Tooltip.Content>
                      </Tooltip>
                    )}
                    <span className="shrink-0 text-xs text-muted">{rule.matchType}</span>
                  </div>
                ))}
              </div>

              {replacedCount > 0 && (
                <Alert status="warning" className="bg-warning-soft">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>
                      Replaces {replacedCount} existing {replacedCount === 1 ? 'rule' : 'rules'}
                    </Alert.Title>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="primary" className="w-full" isDisabled={selectedCount === 0} onPress={commit}>
                Import {selectedCount} {selectedCount === 1 ? 'rule' : 'rules'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
