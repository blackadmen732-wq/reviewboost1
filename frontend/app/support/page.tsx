import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support — ReviewBoost",
  description: "Get help with ReviewBoost.",
};

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link
        href="/"
        className="mb-10 inline-flex items-center gap-2 text-sm text-muted underline-offset-4 hover:underline"
      >
        ← ReviewBoost
      </Link>

      <h1 className="mb-2 text-3xl font-bold tracking-tight text-ink">Support</h1>
      <p className="mb-10 text-base text-muted">
        We&apos;re a small team and we read every message.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold text-ink">Contact us</h2>
        <p className="mb-4 text-base text-muted">
          Email{" "}
          <a
            href="mailto:help@reviewboost.app"
            className="font-medium text-ink underline underline-offset-2 hover:no-underline"
          >
            help@reviewboost.app
          </a>{" "}
          and we&apos;ll reply within one business day.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold text-ink">Common questions</h2>

        <details className="mb-4 rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium text-ink">
            How does a customer leave a review?
          </summary>
          <p className="mt-3 text-base text-muted">
            They scan your QR code or tap your NFC tag. A page appears showing your business name
            and a row of stars. They tap a star and are taken straight to your Google review page.
            No account, no download, no friction.
          </p>
        </details>

        <details className="mb-4 rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium text-ink">
            What NFC tags do you support?
          </summary>
          <p className="mt-3 text-base text-muted">
            NTAG213 and NTAG215 tags work with the iOS app. You source your own blank tags — they
            are widely available online for a few cents each. The app programmes them with your
            review URL over NFC (iPhone 7 or later, iOS 14 or later required).
          </p>
        </details>

        <details className="mb-4 rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium text-ink">
            How do I cancel my subscription?
          </summary>
          <p className="mt-3 text-base text-muted">
            Go to Settings in the app and tap &quot;Manage subscription&quot;. You can cancel any
            time. Your account and data remain until you choose to delete them.
          </p>
        </details>

        <details className="mb-4 rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium text-ink">
            How do I delete my account?
          </summary>
          <p className="mt-3 text-base text-muted">
            Email{" "}
            <a
              href="mailto:privacy@reviewboost.app?subject=Delete%20my%20account"
              className="font-medium text-ink underline underline-offset-2 hover:no-underline"
            >
              privacy@reviewboost.app
            </a>{" "}
            with the subject &quot;Delete my account&quot;. We will delete your organization,
            ratings data, and login within 30 days and confirm by email.
          </p>
        </details>

        <details className="mb-4 rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium text-ink">
            Do customers have to download an app?
          </summary>
          <p className="mt-3 text-base text-muted">
            No. The customer-facing flow runs entirely in the browser. Customers scan a code, tap
            a star, and land on Google — no download required.
          </p>
        </details>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold text-ink">Privacy</h2>
        <p className="text-base text-muted">
          Read our{" "}
          <Link href="/privacy" className="font-medium text-ink underline underline-offset-2 hover:no-underline">
            Privacy Policy
          </Link>{" "}
          to understand how we handle your data and your customers&apos; data.
        </p>
      </section>
    </main>
  );
}
