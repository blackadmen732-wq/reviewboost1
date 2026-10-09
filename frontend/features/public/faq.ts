import { PUBLIC_PLANS, TRIAL } from "@/features/public/pricing-plans";

/**
 * The questions a local business owner actually asks, answered from what the
 * code does.
 *
 * Every answer here was checked against the implementation rather than written
 * from what would sound good:
 *
 * - Cancelling: Stripe sets `cancel_at_period_end`, so the subscription stays
 *   active until the period is paid out. `resolve_public_stand` then requires
 *   `app.entitlement_allows_service`, which is false once the status is
 *   cancelled — that is why the Tags stop *after* the paid period, not at the
 *   moment somebody clicks cancel.
 * - Changing the Google link: the Tag carries `/q/{token}`, never the
 *   destination, so the destination changes without touching the chip.
 * - Rotating the code: that *does* change the token, which is why it is the one
 *   action that makes a printed code stop working.
 *
 * If one of these stops being true, the answer is wrong and has to change with
 * the code. That is the cost of writing a real FAQ instead of a vague one.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

const cheapest = PUBLIC_PLANS[0]!;

export const FAQ: readonly FaqEntry[] = [
  {
    question: "Does my customer need an app?",
    answer:
      "No. They scan the code or tap the Tag with their phone, the page opens in their browser, and they tap a star. There is nothing to install and nothing to sign up for.",
  },
  {
    question: "What is a Tag?",
    answer:
      "The thing you put where customers pay. It carries a QR code, an NFC chip, or both — all of them opening the same ReviewBoost page.",
  },
  {
    question: "Do I need special hardware?",
    answer:
      "No. A printed QR code works on any phone with a camera. NFC is optional, and you can add it to the same Tag later.",
  },
  {
    question: "Can I use NFC tags I already have?",
    answer:
      "Yes, as long as they are blank and not locked. ReviewBoost reads a Tag before writing to it and will not overwrite something already on it without asking you first.",
  },
  {
    question: "Do you hide Google from unhappy customers?",
    answer:
      "No. One star and five stars are offered the same Google link, in the same place, in the same way. There is no version of this product that routes an unhappy customer somewhere quieter.",
  },
  {
    question: "Can I change my Google link later?",
    answer:
      "Yes, from Settings, and your Tags keep working. The Tag carries a ReviewBoost address, not a Google one, so changing where it sends people never means reprinting a code or rewriting a chip.",
  },
  {
    question: "Is there a free plan?",
    answer: `No. ${TRIAL.plan} has a ${TRIAL.days}-day trial with one Tag, then plans start at $${cheapest.price} a month. Growth and Pro have no trial.`,
  },
  {
    question: "Do I need a card to start the trial?",
    answer: `Yes. The trial is on ${TRIAL.plan} only. Nothing is charged until the ${TRIAL.days} days are up, and you can cancel before then without paying anything.`,
  },
  {
    question: "What happens if I cancel?",
    answer:
      "Cancelling stops the next charge. Your Tags keep working until the period you have already paid for ends — after that the page they open stops loading, so take them off the counter.",
  },
  {
    question: "Do unused texts roll over?",
    answer:
      "No. The monthly allowance is added when each month is paid for and is spent first; anything left at the end of the period expires. Texts you buy separately do not expire.",
  },
] as const;
