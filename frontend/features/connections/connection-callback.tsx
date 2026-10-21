"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { InlineNotice } from "@/components/ui/inline-notice";
import { connectionsApi, errorMessage } from "@/features/connections/connections-api";

interface ConnectionCallbackProps {
  providerId: string;
  providerName: string;
  state: string | null;
  code: string | null;
  error: string | null;
}

/** Hands the provider's answer to the server once, then goes back to the app's page. */
export function ConnectionCallback({ providerId, providerName, state, code, error }: ConnectionCallbackProps) {
  const router = useRouter();
  const sent = useRef(false);
  const [failure, setFailure] = useState<string | null>(state ? null : "That link is incomplete. Please start again.");

  useEffect(() => {
    // The state is single-use, so this must run once even under StrictMode.
    if (sent.current || !state) return;
    sent.current = true;
    window.history.replaceState(null, "", `/settings/connections/${providerId}/callback`);

    connectionsApi(`/api/v1/connections/providers/${providerId}/callback`, {
      method: "POST",
      body: { state, ...(code ? { code } : {}), ...(error ? { error: error.slice(0, 200) } : {}) },
    }).then(
      () => {
        router.replace(`/settings/connections/${providerId}`);
        router.refresh();
      },
      (caught: unknown) => setFailure(errorMessage(caught)),
    );
  }, [providerId, state, code, error, router]);

  if (failure) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{providerName} wasn&apos;t connected</h1>
        <InlineNotice kind="error">{failure}</InlineNotice>
        <Link href={`/settings/connections/${providerId}`} className={buttonVariants({ variant: "primary" })}>
          Back to {providerName}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 py-8 text-base text-muted" role="status">
      <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      Connecting {providerName}…
    </div>
  );
}
