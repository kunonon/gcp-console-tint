import { Button, Popover, Tooltip } from '@heroui/react';

interface DeleteConfirmPopoverProps {
  message: string;
  confirmLabel: string;
  tooltipLabel: string;
  onConfirm: () => void;
  children: React.ReactNode;
}

// A shared "click a destructive icon button -> confirm in an anchored popover" pattern, used
// for both rule Delete and palette Remove color. There is no Cancel button by design: the
// popover's own dismiss behavior (outside click or Escape) *is* cancel. The confirm button
// carries slot="close" so react-aria's Dialog closes the popover as part of handling the
// press, in addition to running onConfirm.
//
// Combines a HeroUI Tooltip (hover hint, matching every other icon button in the app) with a
// Popover (click-to-confirm) on the same trigger: Tooltip.Trigger wraps the whole Popover
// tree rather than just the Button, which works because Tooltip.Trigger only needs some
// element to track hover/focus on and doesn't care what's nested inside. tabIndex={-1} on
// Tooltip.Trigger removes its wrapper from the Tab order for the same reason as
// IconButtonTooltip in App.tsx (the child Button is already focusable).
export default function DeleteConfirmPopover({
  message,
  confirmLabel,
  tooltipLabel,
  onConfirm,
  children,
}: DeleteConfirmPopoverProps) {
  return (
    <Tooltip delay={500}>
      <Tooltip.Trigger tabIndex={-1}>
        <Popover>
          <Popover.Trigger>{children}</Popover.Trigger>
          <Popover.Content>
            <Popover.Dialog className="flex max-w-64 flex-col gap-2 p-3">
              <span className="text-sm">{message}</span>
              <Button slot="close" variant="danger" size="sm" className="self-end" onPress={onConfirm}>
                {confirmLabel}
              </Button>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </Tooltip.Trigger>
      <Tooltip.Content>{tooltipLabel}</Tooltip.Content>
    </Tooltip>
  );
}
