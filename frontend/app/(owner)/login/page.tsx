import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInFlow } from "@/features/auth/sign-in-flow";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in — ReviewBoost",
  // Sign-in pages have no business in a search index.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await currentUser();
  const { next } = await searchParams;

  const origin = process.env.PUBLIC_FRONTEND_URL || "http://localhost:3000";
  const destination = safeInternalPath(next, origin);

  if (user) redirect(destination);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <SignInFlow next={destination} />
    </main>
  );
}
