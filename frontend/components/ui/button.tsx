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
        primary:
          "border-brand bg-brand text-[#071B10] shadow-[var(--shadow-button)] hover:border-brand-hover hover:bg-brand-hover hover:shadow-[var(--shadow-button-hover)]",
        secondary:
          "border-border bg-surface text-ink shadow-[var(--shadow-control)] hover:border-[color:var(--rb-border-strong)] hover:bg-quiet",
        outline:
          "border-[color:var(--rb-border-strong)] bg-transparent text-ink hover:border-brand hover:bg-brand-soft",
        ghost: "border-transparent bg-transparent text-ink hover:bg-quiet",
        destructive:
          "border-danger bg-danger text-white shadow-[var(--shadow-control)] hover:brightness-95",
      },
      size: {
        sm: "min-h-11 px-4 text-sm",
        default: "min-h-14 text-base",
        lg: "min-h-16 rounded-[16px] px-6 text-[1.0625rem]",
        icon: "h-12 min-h-12 w-12 px-0",
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
