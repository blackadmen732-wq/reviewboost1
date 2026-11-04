import type { Metadata } from "next";
import Link from "next/link";

import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Account deleted",
  description: "Your ReviewBoost account has been deleted.",
  robots: { index: false, follow: false },
};

/**
 * Where a deletion lands.
 *
 * Public, and deliberately so: the account that would have been needed to see
 * a signed-in confirmation no longer exists. It is short, it does not ask for
 * feedback on the way out, and it does not offer to win anyone back — someone
 * who has just deleted their business has answered that question.
 *
 * The one useful fact is the Tags, because they are physical and still on a
 * counter somewhere.
 */
export default function GoodbyePage() {
  return (
    <PublicArticle title="Your account is deleted" lede="Everything in it has been removed.">
      <p>
        Your ratings, your Tags and your business details are gone, and your
        subscription was cancelled as part of this.
      </p>
      <p>
        The Tags themselves will no longer open anything, so they can come off
        the counter.
      </p>
      <p>
        If you ever want to start again,{" "}
        <Link href="/login" className="font-medium text-ink underline underline-offset-4">
          create a new account
        </Link>
        . It starts from scratch — nothing from before can be recovered.
      </p>
    </PublicArticle>
  );
}
