import { describe, expect, it } from "vitest";

import { FAQ } from "@/features/public/faq";
import { PUBLIC_PLANS, TRIAL } from "@/features/public/pricing-plans";

/**
 * An FAQ is where a product lies to itself most easily: the answers sound
 * reasonable, nobody checks them against the code, and they rot silently.
 *
 * These pin the answers that depend on real behaviour, so a change to
 * entitlements, the trial, or the one-tap contract breaks a test rather than
 * quietly making the marketing site wrong.
 */
describe("the FAQ answers match the product", () => {
  function answerTo(fragment: RegExp): string {
    const entry = FAQ.find((item) => fragment.test(item.question));
    expect(entry, `no question matching ${fragment}`).toBeDefined();
    return entry!.answer;
  }

  it("says customers install nothing, because they do not", () => {
    expect(answerTo(/app\?/i)).toMatch(/^No\./);
    expect(answerTo(/app\?/i).toLowerCase()).toContain("nothing to install");
  });

  it("denies review gating without hedging", () => {
    const answer = answerTo(/hide google/i);
    expect(answer).toMatch(/^No\./);
    expect(answer.toLowerCase()).toContain("same google link");
  });

  it("says the Google link can change without touching the Tag", () => {
    // True because the Tag carries /q/{token}, never the destination.
    const answer = answerTo(/change my google link/i);
    expect(answer).toMatch(/^Yes/);
    expect(answer.toLowerCase()).toMatch(/keep working|never means reprinting/);
  });

  it("states there is no free plan, and quotes the real entry price", () => {
    const answer = answerTo(/free plan/i);
    expect(answer).toMatch(/^No\./);
    expect(answer).toContain(`$${PUBLIC_PLANS[0]!.price}`);
    expect(answer).toContain(`${TRIAL.days}-day trial`);
  });

  it("says a card is required and nothing is charged during the trial", () => {
    const answer = answerTo(/card to start/i);
    expect(answer).toMatch(/^Yes/);
    expect(answer.toLowerCase()).toContain("nothing is charged");
  });

  it("describes cancellation the way the entitlement actually behaves", () => {
    // cancel_at_period_end keeps the subscription active until the period ends;
    // resolve_public_stand then refuses once the status is cancelled.
    const answer = answerTo(/if i cancel/i);
    expect(answer.toLowerCase()).toContain("stops the next charge");
    expect(answer.toLowerCase()).toContain("until the period");
    // It must not promise the Tags keep working indefinitely.
    expect(answer.toLowerCase()).toMatch(/stops loading|stops working/);
  });

  it("does not claim unused texts roll over, because they expire", () => {
    const answer = answerTo(/roll over/i);
    expect(answer).toMatch(/^No\./);
    expect(answer.toLowerCase()).toContain("expire");
  });
});

describe("the FAQ does not invent anything", () => {
  const text = FAQ.map((item) => `${item.question} ${item.answer}`).join(" ");

  it("promises no response times, guarantees or certifications", () => {
    expect(text).not.toMatch(/within \d+ (hour|day|business)/i);
    expect(text).not.toMatch(/guarantee|SOC 2|ISO \d|HIPAA|bank-level|military/i);
  });

  it("claims no review is ever posted on the customer's behalf", () => {
    expect(text).not.toMatch(/post(s|ed)? (your|a|the) review|we publish/i);
  });

  it("uses Tag, never Stand", () => {
    expect(text).not.toMatch(/\bstand(s)?\b/i);
  });

  it("answers every question it asks", () => {
    for (const entry of FAQ) {
      expect(entry.question.endsWith("?"), entry.question).toBe(true);
      expect(entry.answer.length, entry.question).toBeGreaterThan(40);
    }
  });
});
