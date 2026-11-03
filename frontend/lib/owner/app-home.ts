/**
 * Home, as the iPhone app may show it.
 *
 * The app is a free companion to a plan bought on the website. App Store
 * Guideline 3.1.3(f) allows that only while the app neither sells nor points
 * at where to pay: no "Choose a plan" button, no "Update your card", no trial
 * offer. So the plan and payment lines keep the fact (the Tags are off, the
 * payment failed) and drop the pointer, and no button or step leads to
 * Billing. Everything else is the website's model, word for word.
 *
 * The same rule the app's own Account screen follows (apps/mobile/data/billing-view.ts).
 */

import type { HomeModel } from "@/features/dashboard/home-model";
import type { ServiceKind } from "@/lib/owner/service-state";

const BILLING = "/settings/billing";

export function homeModelForApp(model: HomeModel, service: ServiceKind): HomeModel {
  return {
    ...model,
    attentions: model.attentions.map((attention) => {
      if (attention.kind === "payment") {
        return { ...attention, title: "Your last payment didn’t go through", body: "Your Tags are still working." };
      }
      if (attention.kind === "plan" && service === "no-plan") {
        return { ...attention, title: "Your Tag is off", body: "Customers who scan it can’t leave a rating yet." };
      }
      return attention;
    }),
    primary: model.primary?.href.startsWith(BILLING) ? null : model.primary,
    planNote: model.planNote ? { ...model.planNote, href: null } : null,
    setup:
      model.setup?.map((step) => ({
        ...step,
        body: step.body.startsWith("Choose a plan first.")
          ? "Your Tag isn’t switched on yet, so a test scan shows “This review link isn’t active”."
          : step.body,
        action: step.action?.href.startsWith(BILLING) ? null : step.action,
      })) ?? null,
  };
}
