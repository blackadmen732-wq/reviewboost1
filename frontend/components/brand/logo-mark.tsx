import { cn } from "@/lib/utils/cn";

/**
 * The ReviewBoost mark — the speech-bubble icon from the official brand.
 * Source: /Branding/Icon_only.svg
 */
export function LogoMark({
  size,
  className,
}: {
  size: number;
  className?: string | undefined;
}) {
  const h = Math.round(size * (181 / 193));
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 193 181"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <rect
        x="3.40039"
        width="189.125"
        height="173.714"
        rx="50"
        transform="rotate(1.12162 3.40039 0)"
        fill="var(--logo-brand, #035B3B)"
      />
      <path
        d="M39 56C39 39.4315 52.4315 26 69 26H120.574C137.143 26 150.574 39.4315 150.574 56V63.2291C150.574 79.7156 137.531 95.1558 121.159 97.0898C116.085 97.6892 109.052 98.1231 98.2124 98.166C85.4211 98.2166 73.7655 105.877 69.2386 117.841L62.1827 136.488L59.5611 141.522C54.2946 151.634 39 147.89 39 136.488V66.1037V56Z"
        fill="white"
      />
      <path
        d="M49.4426 59.4876C49.4426 46.7331 59.7822 36.3936 72.5366 36.3936H108.596C121.351 36.3936 131.69 46.7331 131.69 59.4876V59.4876C131.69 72.242 121.351 82.5816 108.596 82.5816H72.5366C59.7822 82.5816 49.4426 72.242 49.4426 59.4876V59.4876Z"
        fill="var(--logo-brand, #035B3B)"
      />
      <path
        d="M57.9148 99.4046L58.6058 75.204C58.6058 75.204 88.4982 52.8877 78.7008 75.134C68.9034 97.3804 57.9148 99.4046 57.9148 99.4046Z"
        fill="var(--logo-brand, #035B3B)"
        stroke="var(--logo-brand, #035B3B)"
        strokeWidth="10"
      />
      <path
        d="M90 104.379L117.418 103.358C123.281 103.139 129.054 105.217 133.311 109.076L167 139.625L133.126 140.887C130.095 141 127.117 139.885 124.974 137.836L90 104.379Z"
        fill="white"
      />
    </svg>
  );
}