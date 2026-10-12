import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFrame } from "@/features/auth/auth-frame";
import { SignInFlow } from "@/features/auth/sign-in-flow";
import { isGetStartedNext } from "@/features/public/public-copy";
import { enabledOAuthProviders, oauthErrorCode } from "@/lib/auth/oauth-providers";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { publicFrontendUrl } from "@/lib/server/env";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<Metadata> {
  const { next } = await searchParams;
  const destination = safeInternalPath(next, publicFrontendUrl());
  return {
    title: isGetStartedNext(destination) ? "Get started" : "Sign in",
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await currentUser();
  const { next, error } = await searchParams;

  // The guarded accessor rather than a silent localhost fallback: in
  // production it throws if PUBLIC_FRONTEND_URL is unset instead of validating
  // redirects against a localhost origin. In development it returns localhost.
  const destination = safeInternalPath(next, publicFrontendUrl());

  if (user) redirect(destination);

  return (
    <AuthFrame>
      <SignInFlow
        next={destination}
        intent={isGetStartedNext(destination) ? "start" : "signin"}
        providers={enabledOAuthProviders()}
        oauthError={oauthErrorCode(error)}
      />
    </AuthFrame>
  );
}
