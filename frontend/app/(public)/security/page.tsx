import type { Metadata } from "next";
import Link from "next/link";

import { SECURITY } from "@/features/public/public-copy";
import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Security",
  description: "Owner pages need a signed-in session. Customer pages stay anonymous.",
};

/**
 * Every claim here points at something in the codebase.
 *
 * The temptation on a security page is to write what sounds reassuring. What
 * follows was written the other way round — by reading what the code enforces
 * and describing only that. The "What we do not claim" section stays, because
 * the absence of a badge is worth more than a badge nobody audited.
 */
export default function SecurityPage() {
  return (
    <PublicArticle title={SECURITY.headline} lede={SECURITY.lede}>
      <h2>Owner access</h2>
      <p>
        Home, Feedback, Text Requests, Tags and Settings all require a signed-in
        session. Signing in is an emailed code, so there is no password here to
        be stolen or reused.
      </p>
      <p>
        Every owner request carries its own token, and the database decides what
        that token may read. One business cannot query another&apos;s ratings,
        Tags or phone numbers — not because the interface hides them, but because
        the row is not returned.
      </p>

      <h2>Customer access</h2>
      <p>
        The page behind a Tag is public on purpose. It does not ask who they are.
        It does not attach a name, a phone number or an email to a rating, and
        there is no field on it for anything but the star.
      </p>
      <p>
        That page is rate limited. If the limiter itself cannot be reached, the
        page refuses rather than waving requests through — the safe failure is
        the inconvenient one.
      </p>

      <h2>Where a rating goes</h2>
      <p>
        The review link a business saves is validated before it is ever handed to
        a customer&apos;s browser. An unchecked one would turn a printed code into
        a way to send people somewhere they did not choose, so addresses that
        merely look like Google — credentials smuggled into the host, lookalike
        domains — are refused. The Tag itself carries a ReviewBoost address, not
        the destination, so changing where it points never means reprinting.
      </p>

      <h2>Payments</h2>
      <p>
        Card details are handled by Stripe and never reach us. Billing changes
        are applied only from webhooks whose signature is verified before
        anything is written, so what a browser claims on a success page grants
        nothing on its own.
      </p>

      <h2>Keys</h2>
      <p>
        The credentials that bypass those database rules are server-only, and the
        build fails if one is ever named so that it could be bundled into a
        browser. Customer notes and the reprintable copy of Tag codes are
        encrypted with a key that is never sent to a client.
      </p>

      <h2>What we do not claim</h2>
      <p>
        We do not list audit badges we have not earned. There is no SOC 2 report,
        no ISO certification and no penetration-test letter behind this page, and
        saying otherwise would be the least trustworthy thing on it. If you need a
        security review for your own compliance work, write to us from Settings
        once you have an account.
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
