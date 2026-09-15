"use client";

import { CircleCheck, ExternalLink, LockKeyhole } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { CustomerActionBar } from "@/features/customer-flow/customer-action-bar";
import { cn } from "@/lib/utils/cn";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface GoogleOpportunityProps {
  businessName: string;
  /** The validated destination URL the customer will be sent to. */
  destinationUrl: string;
  /** @deprecated Use destinationUrl. */
  googleReviewUrl?: string;
  messages: CustomerMessages;
  onGoogleAction: () => void;
  onContinue: () => void;
}

export function GoogleOpportunity({
  businessName,
  destinationUrl,
  googleReviewUrl,
  messages,
  onGoogleAction,
  onContinue,
}: GoogleOpportunityProps) {
  // Prefer the explicit destinationUrl; fall back to legacy alias so callers
  // that have not yet been updated continue to work.
  const href = destinationUrl || googleReviewUrl || "";

  return (
    <section className="flow-screen" data-flow-screen="google-opportunity">
      <div className="success-mark" aria-hidden="true">
        <CircleCheck size={28} strokeWidth={2.1} />
      </div>
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.thanksHeading}
        </h1>
        <p className="customer-support">
          {messages.feedbackSent(businessName)}
        </p>
      </div>

      <div className="google-opportunity">
        <p className="google-prompt">{messages.googlePrompt}</p>
        <CustomerActionBar>
          <div className="action-stack">
            <a
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "google-review-link",
              )}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onGoogleAction}
            >
              <span>{messages.googleAction}</span>
              <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            </a>
            <Button variant="ghost" onClick={onContinue}>
              {messages.googleContinue}
            </Button>
          </div>
        </CustomerActionBar>
        <p className="trust-line google-trust">
          <LockKeyhole aria-hidden="true" size={17} strokeWidth={2} />
          <span>{messages.googleTrust(businessName)}</span>
        </p>
      </div>
    </section>
  );
}
