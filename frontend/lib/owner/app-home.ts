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
      if (attention.kind === "google") {
        // The app has no Google link screen: its button opens the website.
        return { ...attention, body: attention.body.replace("Add it in Settings.", "Add it on the ReviewBoost website.") };
      }
      if (attention.kind === "plan" && service === "no-plan") {
        // The cause, as a fact, so the owner is not sent to set up a Tag
        // that is already set up. No pointer to where a plan is bought.
        return {
          ...attention,
          title: "Your Tag is off",
          body: "This business has no plan yet, so a scan shows “This review link isn’t active”.",
        };
      }
      return attention;
    }),
    primary: model.primary?.href.startsWith(BILLING)
      ? null
      : model.primary?.label === "Print your code"
        ? // The app shows the code; printing happens on the website.
          { ...model.primary, label: "Show your code" }
        : model.primary,
    // The note keeps the fact and loses the pointer: "until you choose a
    // plan" is a call to buy, which the app may not make.
    planNote: model.planNote
      ? {
          title: model.planNote.title.replace("until you choose a plan", "until this business has a plan"),
          href: null,
        }
      : null,
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
