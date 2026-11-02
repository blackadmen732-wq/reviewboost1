import type { Metadata } from "next";
import { randomBytes } from "node:crypto";

import { EARLY_TAP_SCRIPT } from "@/features/customer-flow/early-tap";
import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import type { RatingValue } from "@/lib/i18n/customer-messages";
import { loadCustomerPageContext } from "@/lib/server/customer-page-context";

interface CustomerReviewPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CustomerReviewPageProps): Promise<Metadata> {
  const { token } = await params;
  const server = await loadCustomerPageContext(token);
  return {
    // The tab and the share sheet say whose page it is.
    title: server?.kind === "ready" ? `${server.context.business.name} · Share feedback` : "Share feedback",
    robots: { index: false, follow: false },
  };
}

function retryRating(value: string | string[] | undefined): RatingValue | null {
  const rating = Number(Array.isArray(value) ? value[0] : value);
  return rating === 1 || rating === 2 || rating === 3 || rating === 4 || rating === 5 ? rating : null;
}

/**
 * The page a customer opens from a Tag.
 *
 * Rendered with its data on the server, so the stars are on screen in the first
 * response, and wrapped in a form that `EARLY_TAP_SCRIPT` can submit before the
 * JavaScript has loaded (see features/customer-flow/early-tap.ts).
 */
export default async function CustomerReviewPage({ params, searchParams }: CustomerReviewPageProps) {
  const { token } = await params;
  const query = await searchParams;
  const server = await loadCustomerPageContext(token);
  const failedRating = query["retry"] ? retryRating(query["rating"]) : null;

  return (
    <>
      {server?.kind === "ready" ? (
        // Runs as soon as it is parsed, before any bundle. Static text: no
        // request data is interpolated into it.
        <script dangerouslySetInnerHTML={{ __html: EARLY_TAP_SCRIPT }} />
      ) : null}
      <CustomerFlow
        key={token}
        token={token}
        initialContext={server?.kind === "ready" ? server.context : null}
        initialUnavailable={server?.kind === "unavailable"}
        earlyForm={
          server?.kind === "ready"
            ? {
                action: `/q/${encodeURIComponent(token)}/rate`,
                // One key per page view: a double tap or a resent form is the
                // same rating, never two.
                key: randomBytes(16).toString("hex"),
              }
            : null
        }
        failedRating={failedRating}
      />
    </>
  );
}
