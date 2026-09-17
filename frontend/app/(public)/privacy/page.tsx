import type { Metadata } from "next";

import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Privacy",
  description: "How ReviewBoost handles your data and your customers' data.",
};

const LAST_UPDATED = "15 September 2026";
const CONTACT_EMAIL = "privacy@reviewboost.fit";
const SUPPORT_EMAIL = "help@reviewboost.fit";

/**
 * The real policy, inside the public site.
 *
 * This is the document the app stores and U.S. customers are entitled to — the
 * SMS section, the deletion route, the named contacts. It replaced a shorter
 * marketing summary that still described optional notes and Team Praise, which
 * the V1 customer page no longer collects. A privacy policy that overstates
 * what is collected is the one kind of copy that cannot be "close enough".
 */
export default function PrivacyPage() {
  return (
    <PublicArticle
      title="Privacy Policy"
      lede={`Last updated ${LAST_UPDATED}.`}
    >
      <p>
        ReviewBoost (&ldquo;we&rdquo;, &ldquo;our&rdquo;) operates the ReviewBoost app and
        website. This policy explains what data we collect, why we collect it, and how you
        can control it.
      </p>

      <h2>What we collect from business owners</h2>
      <p>When you create an account we collect:</p>
      <ul>
        <li>Your email address (used to sign in and contact you)</li>
        <li>Your business name and location name</li>
        <li>Your Google review link (the URL you supply)</li>
        <li>Billing data processed by Stripe — we never see your full card number</li>
        <li>Phone numbers you upload for SMS review requests, subject to your consent practices</li>
      </ul>

      <h2>What we collect from your customers</h2>
      <p>
        Almost nothing. When a customer scans your ReviewBoost Tag or QR code, we record
        the star rating they gave and nothing else. There is no name field, no phone
        number, no email address, and no message box — one tap is the whole interaction.
      </p>
      <p>
        Ratings are stored against the Tag, not against a person. We have no way to tell
        that two ratings came from the same customer, and we do not try to find out.
      </p>
      <p>
        Notes attached to a rating by the business itself, and any historical customer
        notes collected by earlier versions, are encrypted at rest. Only the business can
        read them; ReviewBoost employees cannot.
      </p>

      <h2>SMS and phone numbers</h2>
      <p>
        Phone numbers you upload for Text Requests are stored only to send the messages
        you schedule. We honour opt-outs immediately and permanently. Numbers are never
        shared with third parties or used for any purpose other than the messages you
        explicitly send through the app.
      </p>

      <h2>How we use your data</h2>
      <ul>
        <li>To provide and improve the ReviewBoost service</li>
        <li>To process payments through Stripe</li>
        <li>To send transactional emails about your account (not marketing, unless you opt in)</li>
        <li>To send SMS review requests on your behalf, when you use Text Requests</li>
      </ul>

      <h2>Data sharing</h2>
      <p>We share data only with the processors that operate the service:</p>
      <ul>
        <li>
          <strong>Supabase</strong> — database and authentication hosting
        </li>
        <li>
          <strong>Stripe</strong> — payment processing
        </li>
        <li>
          <strong>Twilio</strong> — SMS delivery
        </li>
        <li>
          <strong>Vercel</strong> — web application hosting
        </li>
      </ul>
      <p>We do not sell data. We do not share data with advertisers.</p>

      <h2>Data retention</h2>
      <p>
        We keep your account data for as long as your account is open. After account
        deletion we retain records required by law (typically billing records) for up to
        seven years; all other data is deleted within 30 days.
      </p>
      <p>
        Customer ratings and notes are kept for as long as your account exists. Deleting
        your account deletes all associated customer data.
      </p>

      <h2>Your rights</h2>
      <p>
        You can request a copy of your data, correction of inaccuracies, or deletion of
        your account at any time by emailing{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
        . We respond within 30 days.
      </p>
      <p>
        To delete your account from inside the app, go to{" "}
        <strong>Settings → Delete account</strong>. Your data and all associated customer
        data will be permanently deleted within 30 days.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        We use a single session cookie set by Supabase Auth to keep you signed in. We do
        not use advertising cookies or tracking pixels. The app uses browser local storage
        for offline support only.
      </p>

      <h2>Children</h2>
      <p>
        ReviewBoost is not directed at children under 13. We do not knowingly collect data
        from anyone under 13.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We post material changes here at least 14 days before they take effect and notify
        you by email.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-brand underline underline-offset-4">
          {CONTACT_EMAIL}
        </a>
      </p>
      <p>
        General support:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
      </p>
    </PublicArticle>
  );
}
