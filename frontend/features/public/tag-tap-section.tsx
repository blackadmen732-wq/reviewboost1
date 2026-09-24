"use client";

import { useEffect, useState } from "react";

import { ReaderIndicator, SuccessCheck } from "@/features/tags/nfc-visuals";
import { PRODUCT } from "@/features/public/public-copy";

/**
 * The one signature moment on the marketing site.
 *
 * Reuses the real programming glyphs from the Tag Detail sheet — same green,
 * same rings, same check — rather than drawing a second, fictional version of
 * what tapping a Tag looks like. The loop is decorative (`aria-hidden`); the
 * real four-state flow it is drawn from lives in Tag Detail, gated by an
 * actual read-before-write.
 */
type Phase = "ready" | "writing" | "success";

const SEQUENCE: Array<{ phase: Phase; duration: number }> = [
  { phase: "ready", duration: 1800 },
  { phase: "writing", duration: 1600 },
  { phase: "success", duration: 2200 },
];

export function TagTapSection() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const current = SEQUENCE[index % SEQUENCE.length]!;
    const timer = window.setTimeout(() => {
      setIndex((value) => value + 1);
    }, current.duration);
    return () => window.clearTimeout(timer);
  }, [index]);

  const phase = SEQUENCE[index % SEQUENCE.length]!.phase;

  return (
    <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">Product</p>
        <h2 className="mt-4 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-[#1b4332]">
          {PRODUCT.headline}
        </h2>
        <p className="mt-4 max-w-[38ch] text-lg leading-relaxed text-[#4a5d4e]">{PRODUCT.lede}</p>
        <ul className="mt-8 flex flex-col gap-5">
          {PRODUCT.items.map((item) => (
            <li key={item.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="mt-1 inline-flex size-2 shrink-0 rounded-full bg-[#2d6a4f]"
              />
              <div>
                <h3 className="text-base font-semibold text-[#1b4332]">{item.title}</h3>
                <p className="mt-1 max-w-[36ch] text-base leading-relaxed text-[#4a5d4e]">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="relative flex items-center justify-center overflow-hidden rounded-[2rem] border border-[#e1e5dc] bg-white py-20"
        role="img"
        aria-label="A Tag being tapped and read, then confirmed"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 45%, rgba(45,106,79,0.08), transparent 60%)",
          }}
        />
        <div className="relative">
          {phase === "success" ? <SuccessCheck /> : <ReaderIndicator active={phase === "writing"} />}
        </div>
        <p className="absolute bottom-7 left-0 right-0 text-center text-sm font-medium text-[#4a5d4e]">
          {phase === "ready" ? "Ready to tap" : phase === "writing" ? "Reading the Tag" : "Same link, every time"}
        </p>
      </div>
    </div>
  );
}
