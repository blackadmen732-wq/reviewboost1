import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils/cn";

/**
 * The "Powered by ReviewBoost" line on the customer page.
 *
 * Kept as its own component because the customer page has a different job from
 * the dashboard: the *business* must be the loudest thing on screen, and our
 * mark is a small credit underneath. So it renders the shared wordmark in the
 * mono tone — no brand green competing with the business's own identity.
 */
export function ReviewBoostWordmark({
  prefix,
  className,
}: {
  prefix?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-muted", className)}>
      {prefix ? <span>{prefix}</span> : null}
      <Wordmark size="sm" tone="mono" className="text-sm" />
    </span>
  );
}
