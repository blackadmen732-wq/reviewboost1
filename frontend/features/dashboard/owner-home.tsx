import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FeedbackList, type FeedbackItem } from "@/features/dashboard/feedback-list";
import { HomeSetupChecklist } from "@/features/dashboard/home-setup-checklist";
import {
  type HomeModel,
  type SetupChecklist,
  tagStatusLine,
} from "@/features/dashboard/home-model";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";

/**
 * Owner Home. One question: do I need to do anything?
 *
 * The screen is built around the answer, not around data. When something
 * needs the owner, that thing is the page — one statement, one action. When
 * nothing does, the page is deliberately almost empty: a business that is
 * running well should feel like it.
 */

export function OwnerHome({
  businessName,
  model,
  checklist,
  unreadItems,
}: {
  businessName: string;
  model: HomeModel;
  checklist: SetupChecklist;
  unreadItems: FeedbackItem[];
}) {
  // The setup checklist and Home's own attention/primary system both reach
  // for "Add Google link" and "Create a Tag" once those goals are missing.
  // Rather than let both render a button for the same action, the checklist
  // wins while it is visible and the goal is still open — Home's own button
  // resumes once that goal drops out of the checklist.
  const nextGoal = checklist.nextIncomplete?.id;
  const checklistShowing = checklist.completeCount < checklist.total;
  const hidePrimaryButton =
    checklistShowing &&
    ((nextGoal === "destination" && model.primary?.label === "Add Google link") ||
      (nextGoal === "firstTag" && model.primary?.label === "Create a Tag"));

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-col">
      <header className="mb-10">
        <p className="rb-section-label">{today}</p>
        <h1 className="rb-display mt-3">{businessName}</h1>
        {model.headline ? (
          <p className="mt-4 max-w-[44ch] text-lg leading-relaxed text-muted">{model.headline}</p>
        ) : null}
      </header>

      <HomeSetupChecklist checklist={checklist} />

      {model.kind === "empty" ? (
        <EmptyHome model={model} hidePrimaryButton={hidePrimaryButton} />
      ) : (
        <ActiveHome model={model} unreadItems={unreadItems} hidePrimaryButton={hidePrimaryButton} />
      )}
    </div>
  );
}

function EmptyHome({ model, hidePrimaryButton }: { model: HomeModel; hidePrimaryButton: boolean }) {
  const blocker = model.attentions[0] ?? null;

  return (
    <section className="max-w-[36rem]">
      {blocker ? (
        <>
          <h2 className="rb-title">{blocker.title}</h2>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{blocker.body}</p>
        </>
      ) : (
        <>
          <h2 className="rb-title">No ratings yet.</h2>
          <p className="mt-3 max-w-[34ch] text-base leading-relaxed text-muted">
            Your tag is ready. Put it where people pay.
          </p>
        </>
      )}

      {model.primary && !hidePrimaryButton ? (
        <div className="mt-8 max-w-xs">
          <Button asChild variant="action" size="lg">
            <Link href={model.primary.href}>{model.primary.label}</Link>
          </Button>
        </div>
      ) : null}

      {model.showPreview && model.previewStandId ? (
        <PreviewCustomerPage standId={model.previewStandId} />
      ) : null}
    </section>
  );
}

function ActiveHome({
  model,
  unreadItems,
  hidePrimaryButton,
}: {
  model: HomeModel;
  unreadItems: FeedbackItem[];
  hidePrimaryButton: boolean;
}) {
  const firstAttention = model.attentions[0] ?? null;

  return (
    <div className="flex flex-col gap-14">
      <section className="max-w-[36rem]">
        {firstAttention ? (
          <>
            <h2 className="rb-title">{firstAttention.title}</h2>
            <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">
              {firstAttention.body}
            </p>
          </>
        ) : (
          <div className="py-6">
            <CalmGlyph />
            <h2 className="rb-title mt-6">Nothing needs you.</h2>
            <p className="mt-3 max-w-[36ch] text-base leading-relaxed text-muted">
              You can close this and get back to work.
            </p>
          </div>
        )}

        {model.primary && !hidePrimaryButton ? (
          <div className="mt-8 max-w-xs">
            <Button asChild variant="action" size="lg">
              <Link href={model.primary.href}>{model.primary.label}</Link>
            </Button>
          </div>
        ) : null}
      </section>

      {unreadItems.length > 0 ? (
        <section>
          <h2 className="rb-section-label mb-4">Unread feedback</h2>
          <FeedbackList items={unreadItems} />
        </section>
      ) : null}

      <section>
        <h2 className="rb-section-label mb-4">Tags</h2>
        <Link
          href="/stands"
          className="group flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-4 shadow-[var(--shadow-card)] transition-colors duration-150 hover:bg-quiet/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[color:var(--rb-focus-soft)]"
        >
          <p className="text-base text-ink">{tagStatusLine(model.tagStatus)}</p>
          <ChevronRight
            className="size-5 shrink-0 text-[color:var(--rb-border-strong)] transition-transform duration-150 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      </section>
    </div>
  );
}

/**
 * The calm state deserves a focal point, not just smaller text. One soft
 * green check — the same family as the NFC success glyph — says "done"
 * without a word of chrome.
 */
function CalmGlyph() {
  return (
    <span
      aria-hidden="true"
      className="grid size-14 place-items-center rounded-full bg-brand-soft"
    >
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" className="text-brand-text">
        <path
          d="M5 12.5 9.5 17 19 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
