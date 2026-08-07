import { cn } from "@/lib/utils/cn";
export function ReviewBoostWordmark({
  prefix,
  className,
}: {
  prefix?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium text-muted",
        className,
      )}
    >
      {prefix ? <span>{prefix}</span> : null}
      <span className="font-semibold tracking-[-0.02em] text-ink">
        ReviewBoost
      </span>
    </span>
  );
}
