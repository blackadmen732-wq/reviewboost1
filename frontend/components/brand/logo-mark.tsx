import { cn } from "@/lib/utils/cn";

/**
 * THE mark graphic. Replace this file when Marc pastes the Figma asset.
 *
 * Keep the export name and the `size` contract. ReviewBoostLogo and the
 * favicon path read this slot; nothing else should draw a second mark.
 */
export function LogoMarkPlaceholder({
  size,
  className,
}: {
  size: number;
  className?: string | undefined;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <rect width="24" height="24" rx="6" fill="var(--rb-brand)" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fill="var(--rb-on-brand)"
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
      >
        B
      </text>
    </svg>
  );
}
