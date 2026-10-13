import { Fragment } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * The text as the customer's phone shows it: one grey bubble in a message
 * thread.
 *
 * It draws only what the server rendered (`body`), so what an owner sees here
 * is exactly what is sent, business name and STOP line included. Until there
 * is a preview it says so, rather than drawing a guess at the message.
 *
 * Decorative chrome is hidden from assistive technology; the message itself is
 * ordinary text.
 */

const URL_RE = /(https?:\/\/[^\s]+)/g;

function withLinks(text: string) {
  return text.split(URL_RE).map((part, index) =>
    /^https?:\/\//.test(part) ? (
      <span key={index} className="break-all text-[color:var(--rb-focus)] underline underline-offset-2">
        {part}
      </span>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

export function MessagePhone({
  body,
  lastFour,
  compact = false,
  className,
}: {
  /** The exact message from the server, or null before a preview. */
  body: string | null;
  lastFour: string | null;
  /** On a phone: the bubble alone, so the Send button stays close. */
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return body ? (
      <figure className={cn("flex flex-col gap-2", className)} data-message-phone="compact">
        <figcaption className="text-sm font-medium text-muted">
          {lastFour ? `What ••• ${lastFour} gets` : "What your customer gets"}
        </figcaption>
        <p
          className="max-w-[92%] whitespace-pre-wrap break-words rounded-[1.25rem] rounded-bl-md bg-quiet px-3.5 py-2.5 text-[15px] leading-snug text-ink"
          data-message-body
        >
          {withLinks(body)}
        </p>
      </figure>
    ) : null;
  }

  return (
    <figure
      className={cn(
        "mx-auto w-full max-w-[18rem] rounded-[2.25rem] border border-border bg-surface p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-16px_rgb(0_0_0/0.18)]",
        className,
      )}
      data-message-phone
    >
      <div className="overflow-hidden rounded-[1.75rem] border border-border bg-canvas">
        <div className="flex flex-col items-center gap-0.5 border-b border-border bg-surface px-4 pb-3 pt-4">
          <span aria-hidden="true" className="mb-2 h-1.5 w-14 rounded-full bg-[color:var(--rb-border-strong)]" />
          <span className="text-xs text-muted">Text message</span>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {lastFour ? `To ••• ${lastFour}` : "To your customer"}
          </span>
        </div>

        <div className="flex min-h-56 flex-col gap-2 px-3 py-4">
          {body ? (
            <>
              <span className="self-center text-[11px] text-muted">Preview</span>
              <p
                className="max-w-[88%] self-start whitespace-pre-wrap break-words rounded-[1.25rem] rounded-bl-md bg-quiet px-3.5 py-2.5 text-[15px] leading-snug text-ink"
                data-message-body
              >
                {withLinks(body)}
              </p>
            </>
          ) : (
            <p className="m-auto max-w-[14rem] text-center text-sm text-muted">
              Preview the text to see exactly what your customer gets.
            </p>
          )}
        </div>

        <div aria-hidden="true" className="flex items-center gap-2 border-t border-border bg-surface px-3 py-2.5">
          <span className="h-8 flex-1 rounded-full border border-border bg-canvas" />
        </div>
      </div>
    </figure>
  );
}
