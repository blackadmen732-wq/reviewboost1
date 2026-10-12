import { InlineNotice } from "@/components/ui/inline-notice";
import { SignOutButton } from "@/features/dashboard/sign-out-button";

/**
 * Shown on setup when the person arrived through Apple or Google.
 *
 * Supabase links a new Apple or Google sign-in to an existing account only when
 * the provider confirms the *same* email. Apple's "Hide My Email" sends a
 * private relay address instead, and a different Google account has a
 * different address, so either can land an existing owner here with an empty
 * account. Setup would then let them create a second copy of their business.
 * Say which account this is before they start, and give them the way back.
 */
export function ProviderAccountNotice({
  provider,
  email,
}: {
  provider: "apple" | "google";
  email: string | null;
}) {
  const hidden = email?.toLowerCase().endsWith("@privaterelay.appleid.com") ?? false;
  const name = provider === "apple" ? "Apple" : "Google";

  return (
    <div className="mb-8 flex flex-col gap-3" data-provider-account-notice={provider}>
      <InlineNotice title={`Signed in with ${name}`}>
        <p>
          {hidden
            ? "Apple is hiding your email, so this is a new ReviewBoost account."
            : `This is a new ReviewBoost account for ${email ?? "this sign-in"}.`}{" "}
          Already on ReviewBoost? Sign out and use the email you signed up with.
        </p>
      </InlineNotice>
      <div className="self-start">
        <SignOutButton />
      </div>
    </div>
  );
}
