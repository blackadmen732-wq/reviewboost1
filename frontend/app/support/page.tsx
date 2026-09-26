import type { Metadata } from "next";
import Link from "next/link";

import { PublicShell } from "@/features/public/public-shell";

export const metadata: Metadata = {
  title: "Support",
  description: "Help with Tags, NFC, your Google link, billing and your account.",
};

/**
 * Help for the things that actually go wrong.
 *
 * The previous version promised "we read every message", said cancelling left
 * everything running, and described NFC as an iOS-app feature needing iPhone 7
 * and iOS 14. The first was a commitment nobody had made, the second was the
 * opposite of what the entitlement does, and the third was wrong about which
 * platforms can program a Tag.
 */

interface Topic {
  question: string;
  answer: React.ReactNode;
}

const TOPICS: Topic[] = [
  {
    question: "My customers scan the code and nothing happens",
    answer: (
      <>
        Open the Tag in ReviewBoost and use Preview customer page. If that opens
        correctly the code is fine and the problem is the phone that scanned it.
        If it does not open, check Billing — a subscription that has lapsed stops
        the customer page loading.
      </>
    ),
  },
  {
    question: "A star does not send anyone to Google",
    answer: (
      <>
        That means no Google link is saved. Add it in Settings, then use Test
        Google link to confirm it opens your own review page and not your
        listing. Until it is set, ratings are still recorded — customers just are
        not offered anywhere to post them.
      </>
    ),
  },
  {
    question: "Which phones can program an NFC Tag?",
    answer: (
      <>
        The ReviewBoost app on iPhone or Android, or Chrome on Android. Other
        browsers cannot write to NFC at all, which is a limitation of the browser
        rather than the Tag. You supply your own blank tags; any unlocked NDEF
        tag works, and ReviewBoost reads one before writing so it will never
        silently replace something already on it.
      </>
    ),
  },
  {
    question: "The QR code stopped working after I changed something",
    answer: (
      <>
        Changing your Google link never breaks a code — the Tag carries a
        ReviewBoost address, not the destination. Rotating a Tag&apos;s code does
        break it, deliberately: that is what rotation is for. If you rotate, print
        the new code and replace the old one.
      </>
    ),
  },
  {
    question: "I ran out of texts",
    answer: (
      <>
        The monthly allowance is added each time a month is paid for and is spent
        before anything you have bought separately. Billing shows what is left.
        Unused monthly allowance does not carry into the next month.
      </>
    ),
  },
  {
    question: "How do I cancel?",
    answer: (
      <>
        Settings, then Billing, then Manage subscription. Cancelling stops the
        next charge and your Tags keep working until the period you have paid for
        ends. After that the page they open stops loading, so take them off the
        counter — your account and your ratings are still there if you come back.
      </>
    ),
  },
  {
    question: "How do I delete my account?",
    answer: (
      <>
        If you own the business, delete it yourself: Settings, then Delete
        account on the web, or Account, then Delete account in the ReviewBoost
        app. It is immediate and cancels the subscription first. If you cannot
        sign in, email{" "}
        <a
          href="mailto:privacy@reviewboost.fit?subject=Delete%20my%20account"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          privacy@reviewboost.fit
        </a>{" "}
        from the address you signed up with.{" "}
        <Link
          href="/delete-account"
          className="font-medium text-ink underline underline-offset-2 hover:no-underline"
        >
          What deleting removes
        </Link>
        .
      </>
    ),
  },
  {
    question: "Do my customers need an app?",
    answer: (
      <>
        No. The page opens in whatever browser their phone already has. There is
        nothing to install and nothing to sign up for.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-[44rem] px-5 py-16 sm:px-8 sm:py-20">
        <h1 className="text-[2rem] font-semibold tracking-[-0.03em] text-ink">Support</h1>
        <p className="mt-3 text-base leading-relaxed text-muted">
          Most problems are one of the things below. If yours is not, email{" "}
          <a
            href="mailto:help@reviewboost.fit"
            className="font-medium text-ink underline underline-offset-2 hover:no-underline"
          >
            help@reviewboost.fit
          </a>{" "}
          with what you are stuck on and we will get back to you.
        </p>

        <div className="mt-10 divide-y divide-border border-y border-border">
          {TOPICS.map((topic) => (
            <details key={topic.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
                {topic.question}
                <span
                  aria-hidden="true"
                  className="shrink-0 text-muted transition-transform duration-150 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-muted">
                {topic.answer}
              </p>
            </details>
          ))}
        </div>

        <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            href="/privacy"
            className="font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Terms
          </Link>
          <Link
            href="/security"
            className="font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Security
          </Link>
        </p>
      </main>
    </PublicShell>
  );
}
