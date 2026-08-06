import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn("textarea", invalid && "textarea--invalid", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

