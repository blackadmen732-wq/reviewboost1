"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sign out.
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
    <Button
      variant="secondary"
      loading={busy}
      loadingLabel="Signing out…"
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        window.location.assign("/login");
      }}
    >
      <LogOut className="size-5" aria-hidden="true" />
      Sign out
    </Button>
  );
}
