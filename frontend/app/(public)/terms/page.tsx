import type { Metadata } from "next";

import { PublicArticle } from "@/features/public/public-article";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "ReviewBoost terms of service.",
};

export default function TermsPage() {
  return (
    <PublicArticle
      title="Terms of Service"
      lede="By using ReviewBoost you agree to these terms."
    >
      <p>
        ReviewBoost provides a platform for businesses to collect customer feedback
        and facilitate Google reviews. These terms govern your use of the service.
      </p>

      <h2>Account</h2>
      <p>
        You must provide accurate information when creating an account. You are
        responsible for keeping your credentials secure. One account per person;
        one organization per business location (or more on higher plans).
      </p>

      <h2>Subscription and billing</h2>
      <p>
        Plans are billed monthly. Each plan includes a 7-day free trial. Your card
        is charged at the end of the trial unless you cancel before then. Cancellation
        takes effect at the end of the current billing period.
      </p>

      <h2>Text Requests</h2>
      <p>
        You are responsible for obtaining proper consent before sending text messages
        through ReviewBoost. You must comply with all applicable laws including the
        TCPA and CAN-SPAM. We may suspend your account if we detect abuse.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Do not use ReviewBoost to send unsolicited messages, fake reviews, or content
        that violates any law. Do not attempt to circumvent rate limits, security
        controls, or access restrictions.
      </p>

      <h2>Data</h2>
      <p>
        Customer ratings and messages are stored securely and visible only to the
        business owner. We do not sell customer data. See our Privacy page for details.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        ReviewBoost is provided as-is. We are not liable for indirect, incidental,
        or consequential damages. Our total liability is limited to the amount you
        paid us in the 12 months before the claim.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. Material changes will be communicated by email
        at least 30 days in advance.
      </p>

      <p className="mt-8 text-sm text-muted">
        Questions? Email{" "}
        <a href="mailto:help@reviewboost.app" className="text-brand-text underline">
          help@reviewboost.app
        </a>
      </p>
    </PublicArticle>
  );
}
