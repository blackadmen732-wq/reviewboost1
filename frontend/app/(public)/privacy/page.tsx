import type { Metadata } from "next";
import Link from "next/link";

import { PRIVACY } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Privacy",
  description: "The public page takes a star rating. We do not ask customers who they are.",
};

export default function PrivacyPage() {
  return (
    <PublicArticle title={PRIVACY.headline} lede={PRIVACY.lede}>
      <h2>On the customer page</h2>
      <p>
        A star rating. No name field, no phone, no email, no text input, no
        marketing box.
      </p>
      <h2>On the owner side</h2>
      <p>
        We keep the email you sign in with, the business name, the Google review
        link you paste, and the ratings from your Tags.
      </p>
      <h2>Google</h2>
      <p>
        If you add a Google review link, we send every customer to that same
        link after they rate. We do not read their Google account.
      </p>
      <p>
        <Link
          href="/security"
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          Security
        </Link>
      </p>
    </PublicArticle>
  );
}
