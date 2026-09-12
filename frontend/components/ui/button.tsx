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
          // Customer flow still uses this variant. Brand green cannot carry a
          // white label (3.08:1). Owner CTAs use `action` instead.
          "border-brand bg-brand text-on-brand shadow-[var(--shadow-button)] hover:border-brand-hover hover:bg-brand-hover hover:shadow-[var(--shadow-button-hover)] active:bg-brand-active",
        action:
          // Constitution Action green. White on #007A4D is ~5.4:1 — AA for
          // normal text. Brand green (#00A86B) is never used here.
          "border-action bg-action text-on-action shadow-[var(--shadow-button)] hover:border-action-hover hover:bg-action-hover hover:shadow-[var(--shadow-button-hover)] active:bg-action-pressed focus-visible:ring-[color:var(--rb-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        secondary:
          "border-border bg-surface text-ink shadow-[var(--shadow-control)] hover:border-[color:var(--rb-border-strong)] hover:bg-quiet",
        outline:
          "border-[color:var(--rb-border-strong)] bg-transparent text-ink hover:border-brand hover:bg-brand-soft",
        ghost: "border-transparent bg-transparent text-ink hover:bg-quiet",
        destructive:
          "border-danger bg-danger text-white shadow-[var(--shadow-control)] hover:brightness-95",
        // Ink on white, for screens where the brand green would compete with
        // the thing being looked at — the Customer Page designer sits next to a
        // photograph, and its primary action has to stay out of the way.
        ink: [
          "border-ink bg-ink text-[color:var(--rb-surface)] shadow-[var(--shadow-button)]",
          "hover:bg-[color:color-mix(in_srgb,var(--rb-ink)_88%,var(--rb-canvas))] hover:shadow-[var(--shadow-button-hover)]",
          // Inactive rather than faded-out: a white label at half opacity on a
          // half-faded ink pill is unreadable, which reads as broken.
          "disabled:border-border disabled:bg-quiet disabled:text-muted",
        ].join(" "),
      },
      size: {
        sm: "min-h-11 px-4 text-sm",
        default: "min-h-14 text-base",
        lg: "min-h-16 rounded-[var(--radius-control)] px-6 text-[1.0625rem]",
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
