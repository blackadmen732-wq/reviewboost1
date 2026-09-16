import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";

type CustomerPage = CustomerReviewContext["page"];

interface CustomerPageBrandingProps {
  page: CustomerPage;
  businessName: string;
}

/**
 * The published Customer Page, rendered.
 *
 * This is the one renderer: the public page at `/q/{token}` and the owner's
 * preview both use it, so "what the owner previewed" and "what the customer
 * receives" are the same component fed the same shape rather than two designs
 * that agree until one of them changes.
 *
 * A business with no published page renders nothing here and still works.
 * The Customer Page is a look, not a precondition for having customers, and a
 * business that has not designed one must not lose ratings over it.
 */
export function CustomerPageBranding({ page, businessName }: CustomerPageBrandingProps) {
  if (!page) return null;

  const hasHero = Boolean(page.heroUrl);
  const hasTagline = Boolean(page.tagline);
  if (!hasHero && !hasTagline) return null;

  return (
    <div
      className="customer-page-branding"
      data-template={page.templateId ?? "classic"}
      data-customer-page
    >
      {page.heroUrl ? (
        <div className="customer-page-hero">
          {/* The URL is a published snapshot the server resolved and validated;
              the optimizer would add a hop between a customer's tap and the
              only screen they see. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={page.heroUrl} alt="" aria-hidden="true" loading="eager" />
        </div>
      ) : null}
      {page.tagline ? (
        <p className="customer-page-tagline">{page.tagline}</p>
      ) : null}
      <span className="sr-only">{businessName}</span>
    </div>
  );
}
