import { render } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";

// Before any import below is evaluated: the public pages build their words
// from lists made when their modules load, so the switch has to be off first.
vi.hoisted(() => {
  vi.stubEnv("NEXT_PUBLIC_TEXTING_ENABLED", "false");
});

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({ auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } }),
}));

import DeleteAccountPage from "@/app/(public)/delete-account/page";
import GoodbyePage from "@/app/(public)/goodbye/page";
import HowItWorksPage from "@/app/(public)/how-it-works/page";
import IntegrityPage from "@/app/(public)/integrity/page";
import PricingPage from "@/app/(public)/pricing/page";
import ProductPage from "@/app/(public)/product/page";
import SecurityPage from "@/app/(public)/security/page";
import SupportPage from "@/app/support/page";
import { PublicHome } from "@/features/public/public-home";

afterAll(() => {
  vi.unstubAllEnvs();
});

/**
 * Every public page a visitor can read, rendered as a deployment with texting
 * switched off (lib/features.ts) serves it. None of them may offer, price or
 * promise a text: what ReviewBoost sells first is the Tag.
 *
 * Privacy and Terms are left out on purpose. They describe what happens to a
 * phone number *if* Text Requests are used, which stays true and is not an
 * offer; removing it would only have to be put back.
 */
const PAGES: Array<[string, ComponentType]> = [
  ["/", PublicHome],
  ["/how-it-works", HowItWorksPage],
  ["/product", ProductPage],
  ["/pricing", PricingPage],
  ["/integrity", IntegrityPage],
  ["/security", SecurityPage],
  ["/support", SupportPage],
  ["/delete-account", DeleteAccountPage],
  ["/goodbye", GoodbyePage],
];

describe("the public pages while texting is off", () => {
  it.each(PAGES)("%s offers no texts", (_path, Page) => {
    const { container, unmount } = render(<Page />);
    const words = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(words.length).toBeGreaterThan(100);
    expect(words).not.toMatch(/Text Requests?/);
    expect(words).not.toMatch(/\btexts?\b/i);
    expect(words).not.toMatch(/\bby text\b|\bSMS\b/i);
    unmount();
  });
});
