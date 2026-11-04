"use client";

import { useEffect, useState, type ReactNode } from "react";

import { STILL_WORKING_AFTER_MS } from "@/lib/recovery/timing";
import { recoveryWords } from "@/lib/recovery/words";
import { cn } from "@/lib/utils/cn";

/**
 * A busy button's words. After four seconds they become "Still working…", so
 * a slow save never looks frozen; with Reduce Motion the spinner stands still,
 * and these words are what changes. The two labels share one grid cell, so
 * the button keeps its size when they swap.
 */
export function StillWorking({
  icon,
  children,
}: {
  /** The spinner, in each label, so either one is centred as a whole. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  const cell =
    "col-start-1 row-start-1 inline-flex items-center justify-center gap-2";
  return (
    <span className="grid" data-still-working={slow || undefined}>
      <span className={cn(cell, slow && "invisible")} aria-hidden={slow || undefined}>
        {icon}
        {children}
      </span>
      <span className={cn(cell, !slow && "invisible")} aria-hidden={!slow || undefined}>
        {icon}
        {recoveryWords.stillWorking}
      </span>
    </span>
  );
}
