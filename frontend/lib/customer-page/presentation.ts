import type { CustomerReviewContext } from "@/lib/api/customer-flow-types";
import {
  normalizeCustomerPageDesign,
  normalizeLanguages,
  resolveDefaultLanguage,
  safeImageSource,
  type CustomerPageDesign,
  type CustomerPagePresentation,
} from "@/lib/customer-page/design";

/**
 * The seam between the public API and the page.
 *
 * The contract already carries the business, the location, the Google
 * destination and the languages. It does not carry the design yet, so the design
 * is read from an optional `design` object on the same payload and normalised
 * from nothing into a complete, valid design. That means the page renders
 * correctly today against the shipped contract, and starts rendering photographs
 * the moment the field appears — with no component knowing the difference.
 *
 * Everything is treated as untrusted. This payload is fetched with a public token
 * and is the only input to a page a business's customers are pointed at.
 */

interface CustomerPageDesignPayload {
  design?: unknown;
}

export function presentationFromContext(
  context: CustomerReviewContext,
): CustomerPagePresentation {
  const design = normalizeCustomerPageDesign(
    (context as CustomerReviewContext & CustomerPageDesignPayload).design,
  );
  const languages = normalizeLanguages(context.supportedLocales);

  return {
    businessName: context.business.name,
    locationName: context.location.name,
    design: {
      ...design,
      // `business.logoUrl` predates the design object and stays authoritative
      // until a design supplies its own mark.
      logo: design.logo ?? safeImageSource(context.business.logoUrl),
    },
    languages,
    defaultLanguage: resolveDefaultLanguage(context.defaultLocale, languages),
  };
}

export function presentationFromDesign(options: {
  businessName: string;
  locationName: string | null;
  design: CustomerPageDesign;
}): CustomerPagePresentation {
  return {
    businessName: options.businessName,
    locationName: options.locationName,
    design: options.design,
    languages: ["en"],
    defaultLanguage: "en",
  };
}
