import type { Metadata } from "next";
import Link from "next/link";

import { SECURITY } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Security",
  description: "Owner pages need a signed-in session. Customer pages stay anonymous.",
};

export default function SecurityPage() {
  return (
    <PublicArticle title={SECURITY.headline} lede={SECURITY.lede}>
      <h2>Owner access</h2>
      <p>
        Home, Feedback, Tags, Team, and Settings require a signed-in session.
        Signing in is an email code — no password stored here.
      </p>
      <h2>Customer access</h2>
      <p>
        The page behind a Tag is public on purpose. It does not ask who they are.
        It does not attach a phone number or an email to a rating.
      </p>
      <h2>What we do not claim</h2>
      <p>
        We do not list audit badges we have not earned. If you need a security
        review for your own compliance work, write to us from Settings once you
        have an account.
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
