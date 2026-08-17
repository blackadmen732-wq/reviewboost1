"use client";

import { Share, X } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

/**
 * "Add to Home Screen".
 *
 * The moment that turns a demo into a customer: the owner installs it while you
 * are standing there, and it lives on their phone afterwards.
 *
 * The two platforms need different handling and there is no way around it.
 * Android fires `beforeinstallprompt`, so there is a real button. iOS never
 * fires it and Apple provides no API at all, so the only honest option is to
 * show the three taps — which is why the iOS branch describes the Share menu
 * rather than pretending a button exists.
 *
 * Dismissal is remembered. Nagging someone who already said no on every visit is
 * how a helpful prompt becomes the reason they stop opening the app.
 *
 * WHY useSyncExternalStore RATHER THAN AN EFFECT
 * ----------------------------------------------
 * Everything this component needs — display mode, user agent, localStorage —
 * lives outside React and cannot be read while rendering on the server. Reading
 * it in an effect and calling setState works, but costs a second render pass on
 * every dashboard load and is exactly the cascading-render pattern React now
 * flags.
 *
 * `useSyncExternalStore` is the supported way to read a browser fact:
 * `getServerSnapshot` returns "not eligible", so the server and the first client
 * render agree and hydration is clean, and the real value arrives without a
 * setState in an effect body. The subscribe function is a no-op because none of
 * these facts change while the page is open.
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "reviewboost:install-dismissed";

type Eligibility = "no" | "ios" | "android";

function subscribeToNothing(): () => void {
  return () => {};
}

function readEligibility(): Eligibility {
  // Already installed. `standalone` is the non-standard iOS flag; the media
  // query covers everyone else.
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true;

  if (installed) return "no";

  try {
    if (window.localStorage.getItem(DISMISSED_KEY)) return "no";
  } catch {
    // Private browsing can throw on localStorage. Showing the prompt is the safe
    // failure here.
  }

  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) ? "ios" : "android";
}

export function InstallPrompt() {
  const eligibility = useSyncExternalStore(
    subscribeToNothing,
    readEligibility,
    // Server and first client render agree on "nothing to show", so there is no
    // hydration mismatch and no flash of a card that then disappears.
    () => "no" as const,
  );

  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (eligibility !== "android") return;

    function capture(event: Event) {
      // Preventing the default is what lets us show this at a sensible moment
      // instead of Chrome's own banner appearing over the dashboard.
      event.preventDefault();
      setDeferred(event as InstallEvent);
    }

    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, [eligibility]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Not remembering is a minor annoyance, not a failure worth handling.
    }
  }, []);

  // Android only earns the card once the browser has told us an install is
  // actually possible; showing a button that cannot install is worse than
  // showing nothing.
  const visible =
    !dismissed && (eligibility === "ios" || (eligibility === "android" && deferred !== null));

  if (!visible) return null;

  const isIos = eligibility === "ios";

  return (
    <div className="mb-6 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)] lg:hidden">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-[22%] bg-brand text-lg font-bold text-on-brand">
          B
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">Put this on your home screen</p>
          <p className="mt-0.5 text-sm text-muted">
            {isIos
              ? "Open your phone's share menu, then Add to Home Screen."
              : "One tap. Opens like a normal app."}
          </p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          className="-mr-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-quiet hover:text-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {isIos ? (
        <p className="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] bg-quiet px-3 py-2.5 text-sm text-ink">
          <Share className="size-4 shrink-0 text-muted" aria-hidden="true" />
          Tap <span className="font-semibold">Share</span>, then{" "}
          <span className="font-semibold">Add to Home Screen</span>
        </p>
      ) : (
        <Button
          className="mt-3"
          onClick={async () => {
            if (!deferred) return;
            await deferred.prompt();
            await deferred.userChoice;
            // The event is single-use, so the card goes either way.
            setDeferred(null);
            dismiss();
          }}
        >
          Add to home screen
        </Button>
      )}
    </div>
  );
}
