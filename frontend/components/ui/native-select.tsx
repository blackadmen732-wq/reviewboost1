import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * A native select drawn like `Input`: the same height, outline and focus, so a
 * form with a field and a choice reads as one form. Native on purpose — the
 * phone's own picker is the one an owner already knows how to use.
 */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          "min-h-14 w-full rounded-[var(--radius-control)] border border-[color:var(--rb-border-strong)] bg-surface px-4 text-base text-ink shadow-[var(--shadow-control)] outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-[color:var(--rb-focus)] focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:cursor-not-allowed disabled:bg-quiet disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);
