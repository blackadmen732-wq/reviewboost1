import { summarizeTags, type HomeStand } from "@/lib/owner/tag-summary";

/**
 * The three Set up steps, from facts the server already has.
 *
 * An owner who is not good with technology gets one page with three numbered
 * steps, each with a plain sentence and one button. A step is done only when
 * the data says so, never because the owner clicked through it.
 */

export type SetupStepKey = "page" | "tag" | "test";

export interface SetupStepView {
  key: SetupStepKey;
  number: 1 | 2 | 3;
  title: string;
  body: string;
  done: boolean;
  /** What the step's button does. Absent when there is nothing to press. */
  action: { label: string; href: string } | null;
  /** Plain steps behind "Show me how". */
  howTo: readonly string[];
}

export interface SetupInput {
  hasGoogleLink: boolean;
  hasCustomerPhoto: boolean | null;
  hasLocation: boolean;
  stands: HomeStand[];
  hasAnyRating: boolean;
  canManage: boolean;
  /**
   * Whether the Tags open for customers. A test scan of a closed Tag shows
   * "This review link isn't active", so step 3 says to choose a plan first.
   * Absent means open.
   */
  serving?: boolean;
}

export function deriveSetupSteps(input: SetupInput): SetupStepView[] {
  const tags = summarizeTags(input.stands);
  const firstActive = input.stands.find((stand) => stand.status === "active") ?? null;
  const pageDone = input.hasGoogleLink;
  const tagDone = tags.programmed > 0;

  const pageAction = !input.canManage
    ? null
    : !input.hasLocation
      ? { label: "Finish your business details", href: "/onboarding" }
      : !input.hasGoogleLink
        ? { label: "Add your Google review link", href: "/settings" }
        : { label: "Edit customer page", href: "/customer-page" };

  const tagAction = !input.canManage
    ? null
    : firstActive
      ? { label: tagDone ? "Open your Tag" : "Set up your Tag", href: `/stands/${firstActive.standId}` }
      : null;

  return [
    {
      key: "page",
      number: 1,
      title: "Make your customer page",
      body:
        input.hasCustomerPhoto === false && pageDone
          ? "Your page works. Adding a photo of your business makes it feel like yours."
          : "Your business name, a photo, and the Google page where customers leave a review.",
      done: pageDone,
      action: pageAction,
      howTo: [
        "Tap Edit customer page.",
        "Add a photo of your shop or your logo.",
        "Check the preview. It is exactly what customers see.",
        "Tap Publish.",
      ],
    },
    {
      key: "tag",
      number: 2,
      title: "Set up your Tag",
      body: tagDone
        ? "Your Tag is ready. Put it where people pay."
        : "Program it by tapping your phone on it, or print the code. Either works.",
      done: tagDone,
      action: tagAction,
      howTo: [
        "Android phone: open your Tag, tap Program, then hold the top of your phone on the Tag until it says Done.",
        "iPhone or no NFC: open your Tag and tap Print. Put the printed code by the register.",
        "Once programmed, the Tag is locked so nobody can change it.",
      ],
    },
    {
      key: "test",
      number: 3,
      title: "Test it",
      body: input.hasAnyRating
        ? "It works. Ratings show up in Feedback."
        : input.serving === false
          ? "Choose a plan first. Until then your Tag shows “This review link isn’t active” to anyone who scans it, you included."
          : "Tap your Tag or scan the code with your own phone, then tap a star. It will show up in Feedback.",
      done: input.hasAnyRating,
      action: input.hasAnyRating ? { label: "Open Feedback", href: "/feedback" } : null,
      howTo: [
        "Use your own phone, not the one signed in to ReviewBoost.",
        "Tap the Tag or point the camera at the code.",
        "Pick any star. Your test shows up in Feedback within a few seconds.",
        "Nothing opens? Make sure the phone's NFC is on, or use the printed code.",
      ],
    },
  ];
}

/** The step the page points at: the first one not done, or null when all are. */
export function currentStep(steps: readonly SetupStepView[]): SetupStepKey | null {
  return steps.find((step) => !step.done)?.key ?? null;
}
