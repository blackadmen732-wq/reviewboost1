"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { CustomerPage } from "@/features/customer-page/customer-page";
import {
  editableDesign,
  emptyDesignRecord,
  localCustomerPageDesignStore,
} from "@/lib/customer-page/design-store";
import { presentationFromDesign } from "@/lib/customer-page/presentation";
import { supportedLocales, type Locale } from "@/lib/i18n/config";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";

interface CustomerPagePreviewScreenProps {
  orgId: string;
  locationId: string | null;
  businessName: string;
  locationName: string | null;
}

/**
 * The owner's own page, full size, exactly as a customer gets it.
 *
 * The phone preview in the designer is small on purpose; this is for the owner
 * who wants to hold their laptop up and see the real thing. It is the production
 * page with the production stylesheet, and it is safe for the same structural
 * reason the small preview is: no `onCommit` is passed, so the stars are the
 * only thing that responds and nothing is saved, counted, or handed to Google.
 */
export function CustomerPagePreviewScreen({
  orgId,
  locationId,
  businessName,
  locationName,
}: CustomerPagePreviewScreenProps) {
  const [rating, setRating] = useState<RatingValue | null>(null);
  const [locale, setLocale] = useState<Locale>("en");

  // Subscribed rather than read once: this is usually a second tab kept open
  // beside the designer, and it should show the edit that was just made.
  const record = useSyncExternalStore(
    localCustomerPageDesignStore.subscribe,
    () => localCustomerPageDesignStore.read({ orgId, locationId }),
    () => emptyDesignRecord,
  );
  const design = editableDesign(record);

  return (
    <>
      <CustomerPage
        presentation={presentationFromDesign({
          businessName,
          locationName,
          design,
          languages: supportedLocales,
        })}
        messages={customerMessages[locale]}
        locale={locale}
        rating={rating}
        status="idle"
        onSelect={setRating}
        onLocaleChange={setLocale}
      />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
        <p className="pointer-events-auto inline-flex items-center gap-3 rounded-full bg-[rgb(26_23_18_/_92%)] py-2 pl-3 pr-4 text-sm font-semibold text-white shadow-[var(--shadow-float)] backdrop-blur">
          <Link
            href="/customer-page"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to editing
          </Link>
          <span className="font-normal text-white/80">
            Preview · nothing here is recorded
          </span>
        </p>
      </div>
    </>
  );
}
