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
      className={cn("input", invalid && "input--invalid", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

