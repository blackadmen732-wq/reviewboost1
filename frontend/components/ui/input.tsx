import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "input min-h-14 w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 text-base text-ink shadow-[var(--shadow-control)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted hover:border-[color:var(--rb-border-strong)] focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:cursor-not-allowed disabled:bg-quiet disabled:opacity-60",
        invalid &&
          "input--invalid border-danger focus-visible:border-danger focus-visible:ring-[color:var(--rb-danger-soft)]",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});
