import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  [
    "button relative inline-flex w-full select-none items-center justify-center gap-2 overflow-hidden",
    "rounded-[var(--radius-control)] border px-5 font-semibold tracking-[-0.01em]",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
    "disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:active:scale-100",
  ],
  {
    variants: {
      variant: {
        // The one filled button in the product is ink, not green. Green is
        // the brand's voice; the CTA is the product's hand — quiet, black,
        // unmistakable. `primary` and `action` are the same fill: two names
        // kept so existing call sites read as they always did.
        primary:
          "border-action bg-action text-on-action shadow-[var(--shadow-button)] hover:border-action-hover hover:bg-action-hover hover:shadow-[var(--shadow-button-hover)] active:bg-action-pressed",
        action:
          "border-action bg-action text-on-action shadow-[var(--shadow-button)] hover:border-action-hover hover:bg-action-hover hover:shadow-[var(--shadow-button-hover)] active:bg-action-pressed",
        secondary:
          "border-border bg-surface text-ink shadow-[var(--shadow-control)] hover:border-[color:var(--rb-border-strong)] hover:bg-quiet",
        outline:
          "border-[color:var(--rb-border-strong)] bg-transparent text-ink hover:border-[color:var(--rb-ink)] hover:bg-quiet",
        ghost: "border-transparent bg-transparent text-ink hover:bg-quiet",
        destructive:
          "border-danger bg-danger text-white shadow-[var(--shadow-control)] hover:brightness-95",
      },
      size: {
        sm: "min-h-10 px-4 text-sm",
        default: "min-h-12 text-[0.9375rem]",
        lg: "min-h-13 px-6 text-base",
        icon: "h-11 min-h-11 w-11 px-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  children: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      asChild = false,
      loading = false,
      loadingLabel,
      disabled,
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <LoaderCircle
              className="size-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span>{loadingLabel ?? "Loading…"}</span>
          </>
        ) : (
          children
        )}
      </Component>
    );
  },
);
