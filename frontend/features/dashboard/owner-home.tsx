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
 * Muscle memory (SoT v1.7): do not move these slots —
 * business name, one number, one warning, one green action, then
 * unread rows and Tags status. Same position, color, word.
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

  return (
    <div className="flex flex-col">
      <header className="mb-10">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {businessName}
        </h1>
        {model.headline ? (
          <p className="mt-3 text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {model.headline}
          </p>
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
          <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            {blocker.title}
          </p>
          <p className="mt-3 max-w-[40ch] text-base leading-relaxed text-muted">{blocker.body}</p>
        </>
      ) : (
        <>
          <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
            No ratings yet.
          </p>
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
    <div className="flex flex-col gap-12">
      <section className="max-w-[36rem]">
        {firstAttention ? (
          <>
            <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
              {firstAttention.title}
            </p>
            <p className="mt-2 max-w-[40ch] text-base leading-relaxed text-muted">
              {firstAttention.body}
            </p>
          </>
        ) : (
          <>
            <p className="text-[length:var(--rb-text-title)] font-semibold tracking-[-0.02em] text-ink">
              Nothing needs you
            </p>
            <p className="mt-2 text-base leading-relaxed text-muted">
              You can close this and get back to work.
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
      </section>

      {unreadItems.length > 0 ? (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted">Unread feedback</h2>
          <FeedbackList items={unreadItems} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-1 text-sm font-medium text-muted">Tags</h2>
        <p className="text-base text-ink">{tagStatusLine(model.tagStatus)}</p>
      </section>
    </div>
  );
}
