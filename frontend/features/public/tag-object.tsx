import { Nfc } from "lucide-react";
import QRCode from "qrcode";

import { ReviewBoostLogo } from "@/components/brand/reviewboost-logo";
import { cn } from "@/lib/utils/cn";

/**
 * A ReviewBoost Tag, drawn as the physical object on the counter.
 *
 * The QR is real and scannable: it carries the public site's own address, so
 * a visitor who points a camera at the page lands somewhere true rather than
 * on a made-up demo link. The NFC mark says the same Tag can be tapped.
 *
 * Presentation only — the owner's real Tags are generated per business in
 * Tags, with their own token behind the code.
 */

const DEMO_TARGET = "https://reviewboost.fit";

export async function TagObject({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string | undefined;
}) {
  const svg = await QRCode.toString(DEMO_TARGET, {
    type: "svg",
    margin: 0,
    errorCorrectionLevel: "M",
    color: { dark: "#171a18", light: "#ffffff" },
  });

  const width = size === "lg" ? "w-[248px]" : size === "sm" ? "w-[148px]" : "w-[200px]";

  return (
    <figure
      className={cn(
        "rb-tag flex flex-col items-center rounded-[26px] border border-black/5 bg-white text-center",
        size === "sm" ? "gap-2.5 p-4" : "gap-4 p-6",
        width,
        className,
      )}
      aria-label="A ReviewBoost Tag: scan the code or tap the NFC mark"
    >
      <ReviewBoostLogo pose="full" size={size === "sm" ? "poweredBy" : "footer"} />
      <div
        className="aspect-square w-full [&>svg]:h-full [&>svg]:w-full"
        // The QR library returns a complete, static SVG string.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption
        className={cn(
          "flex items-center gap-1.5 font-semibold tracking-[-0.01em] text-[#171a18]",
          size === "sm" ? "text-xs" : "text-sm",
        )}
      >
        <Nfc className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden="true" />
        Tap or scan
      </figcaption>
    </figure>
  );
}
