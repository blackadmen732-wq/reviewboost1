import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInFlow } from "@/features/auth/sign-in-flow";
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

  // Only a path, never an absolute URL. Taking `next` verbatim would turn the
  // sign-in page into an open redirect: a link that looks like ours and lands
  // on somebody else's login form.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  if (user) redirect(destination);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-12">
      <SignInFlow next={destination} />
    </main>
  );
}
