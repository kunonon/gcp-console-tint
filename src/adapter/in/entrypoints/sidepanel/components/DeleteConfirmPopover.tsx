import { Button, Popover, ScrollShadow, Tooltip } from '@heroui/react';
import { useState } from 'react';

export interface DeleteConfirmItem {
  id: string;
  /** The item itself: a rule's pattern or a color's name. A rule's empty pattern shows as a muted
   * "(empty pattern)", as the rule rows name it. */
  text: string;
  /** Small muted text at the row's end, e.g. the rule's match type. */
  detail?: string;
  /** A CSS color for a dot before the text (palette entries). */
  swatch?: string;
}

interface DeleteConfirmPopoverProps {
  /** Plain-language question, e.g. "Delete 4 rules?". It is the dialog's heading and labels it. */
  question: string;
  /** What goes, one row each, every row in full (wrapped, never cut). */
  items: readonly DeleteConfirmItem[];
  /** The item list's accessible name, e.g. "Rules to delete". */
  itemsLabel: string;
  /** Verb, and the count when there are several: "Delete", "Delete 4 rules", "Remove". */
  confirmLabel: string;
  tooltipLabel: string;
  /** Rule patterns read as data in monospace; a color's name does not. */
  monospace?: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
}

// A shared "click a destructive icon button -> confirm in an anchored popover" pattern, used for
// a rule's Delete, the rules' Delete selected and palette Remove color. The dialog says what it
// asks, that it is final, and lists every item that goes with its match type, so rules sharing a
// pattern stay apart. Cancel and the confirm button both carry slot="close", so react-aria's
// Dialog closes the popover as part of handling the press; Escape and an outside click cancel
// too. Layout and scrolling are style.css's `.confirm-*`: when react-aria gives the popover less
// height than its content, only the item list shrinks and scrolls inside the surface.
//
// Combines a HeroUI Tooltip (hover hint, matching every other icon button in the app) with a
// Popover (click-to-confirm) on the same trigger: Tooltip.Trigger wraps the whole Popover
// tree rather than just the Button, which works because Tooltip.Trigger only needs some
// element to track hover/focus on and doesn't care what's nested inside. tabIndex={-1} on
// Tooltip.Trigger removes its wrapper from the Tab order for the same reason as
// IconButtonTooltip in App.tsx (the child Button is already focusable).
//
// Concentric corners: the popover's own radius is min(32px, --radius-3xl) = 24px (confirmed
// in @heroui/styles' generated CSS), and Popover.Dialog's padding here is 12px, so the buttons'
// and the item list's radius is pinned to 24 - 12 = 12px (= --radius-xl, an existing step in
// this theme's radius scale) via `rounded-xl`, overriding the Button component's own default
// (24px) so their corners trace the same center point as the popover's outer corners.
export default function DeleteConfirmPopover({
  question,
  items,
  itemsLabel,
  confirmLabel,
  tooltipLabel,
  monospace = true,
  onConfirm,
  children,
}: DeleteConfirmPopoverProps) {
  // The list is a Tab stop only while it scrolls: Firefox does not scroll an overflowing box from
  // the keyboard unless it can take focus. ScrollShadow reports "none" when nothing overflows.
  const [scrollable, setScrollable] = useState(false);
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
          <Popover.Content className="confirm-popover">
            <Popover.Arrow />
            <Popover.Dialog className="confirm">
              <Popover.Heading className="confirm-heading text-sm">{question}</Popover.Heading>
              <p className="confirm-note">This can’t be undone.</p>
              <ScrollShadow
                size={12}
                className="confirm-list"
                tabIndex={scrollable ? 0 : undefined}
                onVisibilityChange={(visibility) => setScrollable(visibility !== 'none')}
              >
                <ul aria-label={itemsLabel}>
                  {items.map((item) => (
                    <li key={item.id}>
                      {item.swatch && (
                        <span className="confirm-swatch" style={{ background: item.swatch }} aria-hidden="true" />
                      )}
                      {item.text === '' ? (
                        <span className="confirm-item font-mono text-muted">(empty pattern)</span>
                      ) : (
                        <span className={monospace ? 'confirm-item font-mono' : 'confirm-item'}>{item.text}</span>
                      )}
                      {item.detail && <span className="confirm-detail">{item.detail}</span>}
                    </li>
                  ))}
                </ul>
              </ScrollShadow>
              <div className="confirm-actions">
                <Button slot="close" variant="tertiary" size="sm" className="rounded-xl">
                  Cancel
                </Button>
                <Button slot="close" variant="danger" size="sm" className="rounded-xl" onPress={onConfirm}>
                  {confirmLabel}
                </Button>
              </div>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </Tooltip.Trigger>
      <Tooltip.Content>{tooltipLabel}</Tooltip.Content>
    </Tooltip>
  );
}
