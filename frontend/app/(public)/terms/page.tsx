import type { Metadata } from "next";
import Link from "next/link";

import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Terms",
  description: "The agreement between ReviewBoost and the businesses that use it.",
};

const LAST_UPDATED = "16 September 2026";
const SUPPORT_EMAIL = "help@reviewboost.fit";

/**
 * Terms of Service.
 *
 * The public site linked to this page and the app stores require it, but no
 * such page existed — the link 404'd. The substance here is the product as it
 * actually behaves: we route customers to a review destination, we never write
 * or filter a review, and we never route by rating.
 */
export default function TermsPage() {
  return (
    <PublicArticle title="Terms of Service" lede={`Last updated ${LAST_UPDATED}.`}>
      <p>
        These terms cover your use of ReviewBoost. By creating an account you agree to
        them. If you are accepting on behalf of a business, you confirm you are allowed to
        bind that business.
      </p>

      <h2>What ReviewBoost does</h2>
      <p>
        ReviewBoost gives your customers a page to rate their visit, keeps that rating
        privately for you, and then sends them to the public review destination you
        configured. That is the whole service.
      </p>

      <h2>What ReviewBoost does not do</h2>
      <ul>
        <li>We do not write, post, buy, or solicit fake reviews.</li>
        <li>
          We do not route customers by rating. Someone who taps one star is offered the
          same destination as someone who taps five.
        </li>
        <li>We do not filter, suppress, or gate reviews based on what a customer chose.</li>
        <li>We do not read, alter, or access your customers&rsquo; accounts on Google.</li>
      </ul>
      <p>
        These are commitments, not settings. You cannot switch them off, and neither can
        we.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>
          Configure a review destination that genuinely belongs to your business, and keep
          it accurate.
        </li>
        <li>
          Follow the rules of whichever review platform you send customers to, including
          its policies on asking for reviews.
        </li>
        <li>
          For Text Requests, only send to numbers that have consented to receive messages
          from you, and honour every opt-out. You are the sender of record.
        </li>
        <li>Do not offer payment or rewards in exchange for a particular rating.</li>
        <li>Keep your sign-in address secure. Anyone who can read your email can sign in.</li>
      </ul>

      <h2>Billing</h2>
      <p>
        Paid plans begin after the free trial. Payment is handled by Stripe; we never see
        your full card number. Plans renew automatically until cancelled, and cancelling
        takes effect at the end of the period you have already paid for. We do not refund
        partial periods except where the law requires it.
      </p>
      <p>
        Message allowances attached to a plan are consumed as messages are sent. Unused
        allowance does not carry over beyond what your plan states.
      </p>

      <h2>Suspension</h2>
      <p>
        We may suspend an account that is used to send messages without consent, to solicit
        dishonest reviews, or in a way that puts the service or other businesses at risk.
        Where we can, we will tell you why and give you a chance to correct it first.
      </p>

      <h2>Your content and data</h2>
      {/* "your notes" is accurate — a business can write notes on a rating, and
          ActionThread posts them to /customer-responses/{id}/notes. The false
          claim was the other half: "you can export ... at any time", when no
          export exists. I nearly removed the true part too, having generalised
          "no note field" from the customer flow to the whole product. */}
      <p>
        Your business details, your ratings, the notes you write on them and the
        artwork you upload remain yours. We process them to run the service, as
        described in the Privacy Policy.
      </p>
      <p>
        You can delete your account and everything in it yourself, from Settings —
        see{" "}
        <Link href="/delete-account" className="text-brand underline underline-offset-4">
          Delete your account
        </Link>
        . There is no self-service export today. If you need your ratings in a
        file, ask before you delete, because afterwards there is nothing left to
        send.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep ReviewBoost available, but we do not promise uninterrupted service.
        Printed Tags keep working across deploys because the link they carry is stable —
        changing your review destination does not invalidate anything already printed.
      </p>

      <h2>Liability</h2>
      <p>
        ReviewBoost is provided as is. To the extent the law allows, our total liability
        for any claim is limited to what you paid us in the twelve months before it arose.
        We are not liable for lost profits or for the decisions a review platform makes
        about your listing.
      </p>

      <h2>Changes</h2>
      <p>
        We post material changes to these terms here at least 14 days before they take
        effect and notify you by email. Continuing to use the service after that means you
        accept the new terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </PublicArticle>
  );
}
