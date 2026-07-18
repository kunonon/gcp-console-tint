import { Button, Popover, Tooltip } from '@heroui/react';

interface DeleteConfirmPopoverProps {
  /** Plain-language question, e.g. "Delete this rule?" (kept separate from `target` so a
   * regex pattern or color name never runs into the surrounding sentence). */
  question: string;
  /** The specific item being acted on, e.g. a rule's pattern or a palette entry's name.
   * Rendered on its own line in a monospace, muted style so it reads as data, not prose. */
  target: string;
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
//
// Concentric corners: the popover's own radius is min(32px, --radius-3xl) = 24px (confirmed
// in @heroui/styles' generated CSS), and Popover.Dialog's padding here is p-3 = 12px, so the
// confirm button's radius is pinned to 24 - 12 = 12px (= --radius-xl, an existing step in
// this theme's radius scale) via `rounded-xl`, overriding the Button component's own default
// (24px) so its corners trace the same center point as the popover's outer corners.
export default function DeleteConfirmPopover({
  question,
  target,
  confirmLabel,
  tooltipLabel,
  onConfirm,
  children,
}: DeleteConfirmPopoverProps) {
  return (
    <Tooltip delay={500}>
      <Tooltip.Trigger tabIndex={-1}>
        <Popover>
          {/* tabIndex={-1} here removes Popover.Trigger's own Pressable wrapper div
              (role="button", tabbable by default) from the Tab order, for the same reason and
              via the same mergeProps(..., child.props) last-wins mechanism as Tooltip.Trigger's
              own tabIndex={-1} above — see IconButtonTooltip in App.tsx. Without it, tabbing hit
              both the wrapper and the real button inside `children` as two separate stops. */}
          <Popover.Trigger tabIndex={-1}>{children}</Popover.Trigger>
          <Popover.Content>
            <Popover.Arrow />
            <Popover.Dialog className="flex max-w-64 flex-col gap-2 p-3">
              <span className="text-sm">{question}</span>
              <span className="truncate font-mono text-sm text-muted">{target}</span>
              <Button
                slot="close"
                variant="danger"
                size="sm"
                className="w-full rounded-xl"
                onPress={onConfirm}
              >
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
