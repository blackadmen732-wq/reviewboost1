"use client";

import { useState } from "react";

import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign out, as a settings row.
 *
 * Not behind a confirmation. Signing out is trivially reversible — the worst
 * case is typing an email and a six-digit code — and a confirmation dialog on a
 * harmless action trains people to dismiss dialogs without reading, which is
 * exactly the habit that makes the *destructive* confirmations useless.
 *
 * A full page load rather than a client route change, so no stale
 * Server-Component output survives with the previous session's data in it.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();

        // A full document navigation, deliberately, not router.push(). Signing
        // out has to destroy every trace of the previous session, and the
        // client-side Router Cache holds rendered Server Component payloads
        // containing that owner's feedback and business name. A soft navigation
        // can serve those from memory to whoever signs in next on the same
        // phone — which, on a shared device behind a counter, is a real leak.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
        window.location.assign("/login");
      }}
      className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-quiet/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[color:var(--rb-focus-soft)] disabled:opacity-60"
    >
      <span className="text-base font-medium text-ink">
        {busy ? "Signing out…" : "Sign out"}
      </span>
    </button>
  );
}
