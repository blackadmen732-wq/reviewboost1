import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid = false, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "textarea min-h-36 w-full resize-y scroll-mb-36 rounded-[var(--radius-control)] border border-[color:var(--rb-border-strong)] bg-surface px-4 py-3.5 text-base leading-6 text-ink shadow-[var(--shadow-control)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted hover:border-muted focus-visible:border-[color:var(--rb-focus)] focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)] disabled:cursor-not-allowed disabled:bg-quiet disabled:opacity-60",
          invalid &&
            "textarea--invalid border-danger focus-visible:border-danger focus-visible:ring-[color:var(--rb-danger-soft)]",
          className,
        )}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  },
);
