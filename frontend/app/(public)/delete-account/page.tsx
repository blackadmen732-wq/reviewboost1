import type { Metadata } from "next";
import Link from "next/link";

import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Delete your account",
  description:
    "How to delete your ReviewBoost account and what happens to your Tags, ratings and subscription.",
};

/**
 * The account-deletion resource, reachable without signing in.
 *
 * Both app stores require a publicly reachable URL that explains deletion, and
 * it has to be readable by somebody who has already lost access to their
 * account — which is exactly when people need it and exactly when a link buried
 * inside Settings is useless.
 *
 * This page describes the process that exists today: an emailed request,
 * confirmed before anything is removed. It does not promise a self-service
 * button, because there is not one yet, and a deletion page is the last place
 * to describe a feature optimistically.
 */
export default function DeleteAccountPage() {
  return (
    <PublicArticle
      title="Delete your account"
      lede="What to send, what goes, and what happens to the Tags on your counter."
    >
      <h2>Cancelling and deleting are different</h2>
      <p>
        If you only want the billing to stop, cancel instead — Settings, then
        Billing, then Manage subscription. Cancelling keeps your account and your
        ratings, so you can come back later without starting again.
      </p>
      <p>
        Deleting removes the account itself. It cannot be undone, and it is not
        the way to pause.
      </p>

      <h2>How to ask</h2>
      <p>
        Email{" "}
        <a
          href="mailto:privacy@reviewboost.fit?subject=Delete%20my%20account"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          privacy@reviewboost.fit
        </a>{" "}
        from the address you signed in with, with the subject &quot;Delete my
        account&quot;. Sending from that address is how we know the request is
        yours — we will not act on a request to delete an account from somebody
        who does not control its email.
      </p>
      <p>
        We confirm by email before anything is removed, and tell you what was
        deleted once it is done.
      </p>

      <h2>What happens to your Tags</h2>
      <p>
        They stop working. The page a customer opens when they scan or tap is
        tied to the account, so once the account is gone the code on the counter
        leads nowhere. Take your Tags down before you ask, or expect to.
      </p>

      <h2>If you have an active subscription</h2>
      <p>
        Cancel it first. Deleting the account does not by itself end a
        subscription you started through Stripe, and we would rather you stopped
        the billing yourself than trusted us to notice.
      </p>

      <h2>If other people use the account</h2>
      <p>
        An organization can have more than one member. Deleting your own login is
        not the same as deleting the business, and the last owner leaving is a
        different thing again — say which you mean in the email and we will
        confirm before acting.
      </p>

      <p>
        <Link
          href="/privacy"
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          Privacy
        </Link>
      </p>
    </PublicArticle>
  );
}
