"use client";

import { Toaster as Sonner, toast } from "sonner";

/**
 * Toasts.
 *
 * Positioned top-centre on mobile and bottom-right on desktop, which is not a
 * style choice: the bottom of a phone is where the navigation bar and the
 * thumb already are, so a toast there covers the thing the person just used.
 * On desktop the bottom-right corner is empty and out of the reading path.
 *
 * Used for confirmations that need no decision — "Saved", "Copied". Anything
 * the owner must act on belongs on the page, not in a message that disappears
 * after four seconds while they are looking at something else.
 *
 * Errors get longer on screen than successes. Reading "Saved" takes a glance;
 * reading what went wrong and deciding what to do takes real time.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      // Duplicate suppression: a double-tapped save should read as one event.
      visibleToasts={3}
      offset={16}
      toastOptions={{
        duration: 4000,
        classNames: {
          toast:
            "!rounded-[var(--radius-control)] !border !border-border !bg-surface !text-ink !shadow-[var(--shadow-card)] !font-sans",
          title: "!text-[0.9375rem] !font-semibold",
          description: "!text-sm !text-muted",
          success: "!border-brand",
          error: "!border-danger",
        },
      }}
      className="lg:!bottom-6 lg:!right-6 lg:!top-auto lg:!left-auto"
    />
  );
}

/**
 * The app's toast vocabulary.
 *
 * Wrapped rather than importing `toast` directly at call sites, so the
 * durations and the tone stay consistent and a future change to the toast
 * library touches one file.
 */
export const notify = {
  success: (message: string, description?: string) =>
    toast.success(message, description === undefined ? undefined : { description }),

  error: (message: string, description?: string) =>
    // Longer, because an error asks the reader to decide something.
    toast.error(message, {
      duration: 6000,
      ...(description === undefined ? {} : { description }),
    }),

  /** For work that takes long enough that silence would look broken. */
  promise: <T,>(
    work: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => toast.promise(work, messages),
};
