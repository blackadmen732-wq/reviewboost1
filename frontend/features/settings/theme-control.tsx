"use client";

import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils/cn";

/**
 * Light, Dark or System — the Theme Control from the approved Figma frames.
 *
 * The stylesheet already answers `:root[data-theme="light"]` and
 * `:root[data-theme="dark"]` ahead of the system preference; this is the
 * switch that sets it. "System" removes the attribute, so the operating
 * system decides again.
 *
 * The choice is a per-device preference, like a phone's own dark mode, so it
 * lives in this browser's storage rather than on the account: an owner can
 * keep the counter iPad light and their own phone dark. `THEME_BOOT_SCRIPT`
 * (in `lib/theme.ts`) applies it before the first paint, so a dark choice
 * never flashes light.
 */

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function readChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Same-tab changes do not fire `storage`, so the control announces its own. */
const CHANGE_EVENT = "rb-theme-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  // The whole page changes colour in one frame. Left alone, every control
  // with a colour transition eased to the new theme over 150ms while the
  // rest snapped, so the switch shimmered across the screen in patches.
  root.setAttribute("data-theme-switching", "");
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  void root.offsetHeight;
  requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private windows and blocked storage: the choice holds for this visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function ThemeControl() {
  // "system" on the server, where there is no device to ask; the stored
  // choice on the client. The boot script has already applied the theme, so
  // only the control's highlighted option can change after hydration.
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as const);

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex gap-1 rounded-[12px] border border-border bg-quiet p-1"
    >
      {OPTIONS.map((option) => {
        const selected = choice === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => applyChoice(option.value)}
            className={cn(
              "min-h-10 min-w-[4.5rem] rounded-[9px] px-4 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]",
              selected
                ? "bg-brand-soft text-brand-text shadow-[var(--shadow-control)]"
                : "text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
