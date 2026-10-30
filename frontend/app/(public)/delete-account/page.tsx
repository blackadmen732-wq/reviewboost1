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
 * It now describes a real self-service route, because there is one: Settings
 * then Delete account, which cancels the subscription and removes everything
 * without anybody having to ask us first. Email survives as the path for
 * somebody who can no longer sign in, which is a smaller case than it used to
 * be but not an empty one.
 */
export default function DeleteAccountPage() {
  return (
    <PublicArticle
      title="Delete your account"
      lede="How to do it, what goes, and what happens to the Tags on your counter."
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

      <h2>Delete it yourself</h2>
      <p>
        Sign in, open{" "}
        <Link
          href="/settings/delete"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          Settings then Delete account
        </Link>
        {" "}on the web, or Account then Delete account in the ReviewBoost iPhone or
        Android app, and type your business name to confirm. It happens
        immediately: your subscription is cancelled, and the business, its Tags
        and every rating are removed. Nobody has to approve it and there is no waiting period.
      </p>
      <p>
        Only an owner can delete a business. If you are on someone else&rsquo;s
        team, or you signed in and never set up a business, you can still
        delete your own account: open{" "}
        <Link
          href="/settings/delete-my-account"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          Delete my account
        </Link>{" "}
        on the web, or Account then Delete account in the app, and type
        &ldquo;delete&rdquo;. Your sign-in and your place on every team are
        removed straight away. The businesses keep their ratings, and notes you
        wrote stay, marked &ldquo;Former team member&rdquo;. If you are the
        only owner of a business, delete that business first.
      </p>

      <h2>If you cannot sign in</h2>
      <p>
        Email{" "}
        <a
          href="mailto:privacy@reviewboost.fit?subject=Delete%20my%20account"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          privacy@reviewboost.fit
        </a>{" "}
        from the address you signed in with. Sending from that address is how we
        know the request is yours — we will not delete an account for somebody
        who does not control its email.
      </p>

      <h2>What happens to your Tags</h2>
      <p>
        They stop working. The page a customer opens when they scan or tap is
        tied to the account, so once the account is gone the code on the counter
        leads nowhere. Take your Tags down first, or expect to.
      </p>

      <h2>Your subscription</h2>
      <p>
        Deleting cancels it. That happens before anything is removed, and if the
        cancellation fails nothing is deleted at all — you would be told to
        cancel from Billing and try again. A business still being charged for an
        account that no longer exists is the one outcome worth refusing.
      </p>
      <p>
        Invoices already issued are kept. Both sides are required to keep
        records of money that has moved, so Stripe still holds those.
      </p>

      <h2>If other people use the account</h2>
      <p>
        Deleting the business deletes it for everyone on the team, and their
        access goes with it. Your own sign-in is removed too, unless you own
        another business on ReviewBoost — in that case it survives, because it
        is still in use.
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
