import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";
export const Section = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function Section({ className, ...props }, ref) {
    return (
      <section
        ref={ref}
        className={cn("py-12 sm:py-16", className)}
        {...props}
      />
    );
  },
);
