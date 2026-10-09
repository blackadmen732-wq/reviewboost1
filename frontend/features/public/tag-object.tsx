import { Nfc } from "lucide-react";
import QRCode from "qrcode";

import { LogoMark } from "@/components/brand/logo-mark";
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

/**
 * The QR as one SVG path, built synchronously from the library's module grid
 * so this renders anywhere — a server component, a client tree, a test.
 */
function qrSvg(text: string): string {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = modules.size;
  let d = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path fill="#171a18" d="${d}"/></svg>`;
}

export function TagObject({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string | undefined;
}) {
  const svg = qrSvg(DEMO_TARGET);

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

/** A round NFC Tag: the tap-only form of the same Tag. */
export function NfcPuck({ className }: { className?: string | undefined } = {}) {
  return (
    <figure
      className={cn(
        "rb-tag grid size-[176px] place-items-center rounded-full border border-black/5 bg-white sm:size-[196px]",
        className,
      )}
      aria-label="A round NFC Tag with the ReviewBoost mark"
    >
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={46} />
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[#171a18]">
          <Nfc className="size-4" aria-hidden="true" />
          Tap
        </span>
      </div>
    </figure>
  );
}
