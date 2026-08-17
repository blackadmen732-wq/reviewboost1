"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * Dialogs.
 *
 * Two variants with deliberately different manners:
 *
 * `Dialog` is for a task — rename this, choose that. It closes on Escape and on
 * an outside click, because losing an unfinished task costs a retry.
 *
 * `AlertDialog` is for a decision that cannot be undone. It does **not** close
 * on an outside click, its confirming button says what will happen rather than
 * "OK", and the safe choice is the one already under the thumb. A misplaced tap
 * should never destroy something.
 *
 * On phones both slide up from the bottom rather than appearing centred. A
 * centred modal on a phone is a desktop pattern wearing a smaller size, and the
 * bottom is where the hand already is.
 */

export const DialogRoot = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

function Overlay({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[rgb(26_23_18_/_55%)] backdrop-blur-[2px]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        "motion-reduce:animate-none",
        className,
      )}
    />
  );
}

const PANEL = [
  "fixed z-50 flex flex-col gap-5 bg-surface text-ink",
  // Phone: a sheet from the bottom, safe-area padded, rounded only at the top.
  "inset-x-0 bottom-0 rounded-t-[24px] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]",
  // Desktop: a centred card.
  "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md",
  "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-card)] sm:p-7",
  "shadow-[var(--shadow-card)]",
  "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95",
  "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4 sm:data-[state=closed]:zoom-out-95",
  "motion-reduce:animate-none",
].join(" ");

export function DialogContent({
  title,
  description,
  children,
  showClose = true,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  showClose?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content className={PANEL}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-[-0.02em] text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-base leading-relaxed text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns without a description; this keeps the accessible
              // name complete without printing an empty paragraph.
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>

          {showClose ? (
            <DialogPrimitive.Close
              aria-label="Close"
              className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-quiet hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          ) : null}
        </div>

        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A sheet for choosing from a list.
 *
 * Different from `DialogContent` in the one way that matters on a phone: the
 * body scrolls inside a bounded panel instead of growing until the buttons are
 * under the fold. A roster of twenty people in a fixed dialog pushes "Add
 * someone new" off the bottom of the screen, and nobody scrolls a modal they did
 * not expect to be scrollable.
 *
 * It also carries a grab handle. Purely an affordance — the sheet is not
 * draggable — but it is the shape people have learned means "this came up from
 * the bottom and can go back down", and it makes the panel read as native rather
 * than as a web modal that happened to slide.
 *
 * Capped at 85vh so the page behind stays visible. A sheet that fills the screen
 * is a new page, and should have been one.
 */
export function SheetContent({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          PANEL,
          "max-h-[85dvh] gap-4 sm:max-h-[80dvh]",
          // The panel is the scroll container's parent, not the scroller
          // itself — the heading and footer stay put while the list moves.
          "overflow-hidden",
        )}
      >
        {/* Phone only: the sheet is a centred card on desktop, where a grab
            handle would be meaningless. */}
        <div
          aria-hidden="true"
          className="mx-auto -mt-2 h-1 w-10 shrink-0 rounded-full bg-[color:var(--rb-border-strong)] sm:hidden"
        />

        <div className="flex shrink-0 items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-[-0.02em] text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-base leading-relaxed text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>

          <DialogPrimitive.Close
            aria-label="Close"
            className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-quiet hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>

        {/* `overscroll-contain` stops a flick at the end of the list from
            scrolling the page underneath, which is the single thing that most
            gives away a web sheet on iOS. */}
        <div className="-mx-1 flex-1 overflow-y-auto overscroll-contain px-1">{children}</div>

        {footer ? <div className="shrink-0">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A destructive confirmation.
 *
 * `confirmLabel` must describe the outcome — "Yes, make a new code", not "OK".
 * A sentence gets read; "OK" gets tapped. That difference is the whole point of
 * the dialog.
 */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <Overlay />
        <DialogPrimitive.Content
          className={PANEL}
          role="alertdialog"
          // An outside click must not destroy anything, and neither should a
          // stray Escape while a confirmation is on screen.
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (loading) event.preventDefault();
          }}
        >
          <div className="flex flex-col gap-2">
            <DialogPrimitive.Title className="text-xl font-semibold tracking-[-0.02em] text-ink">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-base leading-relaxed text-muted">
              {description}
            </DialogPrimitive.Description>
          </div>

          {/* Cancel sits below on a phone — nearest the thumb — so the easiest
              tap is the one that changes nothing. */}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="destructive" loading={loading} onClick={onConfirm} className="sm:flex-1">
              {confirmLabel}
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)} className="sm:flex-1">
              {cancelLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
