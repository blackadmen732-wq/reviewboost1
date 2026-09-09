import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FeedbackList, type FeedbackItem } from "@/features/dashboard/feedback-list";
import {
  type HomeModel,
  tagStatusLine,
} from "@/features/dashboard/home-model";
import { PreviewCustomerPage } from "@/features/dashboard/preview-customer-page";

/**
 * Owner Home. One question: do I need to do anything?
 *
 * Empty with a blocker names the blocker. Empty that is ready waits honestly.
 * Returning is attention, then real unread rows, then tag status.
 */

export function OwnerHome({
  businessName,
  model,
  unreadItems,
}: {
  businessName: string;
  model: HomeModel;
  unreadItems: FeedbackItem[];
}) {
  return (
    <div className="flex flex-col">
      <header className="mb-10">
        <h1 className="text-[length:var(--rb-text-display)] font-semibold tracking-[-0.03em] text-ink">
          {businessName}
        </h1>
      </header>

      {model.kind === "empty" ? (
        <EmptyHome model={model} />
      ) : (
        <ActiveHome model={model} unreadItems={unreadItems} />
      )}
    </div>
  );
}

function EmptyHome({ model }: { model: HomeModel }) {
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

      {model.primary ? (
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
}: {
  model: HomeModel;
  unreadItems: FeedbackItem[];
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

        {model.primary ? (
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
