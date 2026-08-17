"use client";

import { CircleCheck, ExternalLink, LockKeyhole } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { CustomerActionBar } from "@/features/customer-flow/customer-action-bar";
import { cn } from "@/lib/utils/cn";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface GoogleOpportunityProps {
  businessName: string;
  googleReviewUrl: string;
  messages: CustomerMessages;
  onGoogleAction: () => void;
  onContinue: () => void;
}

export function GoogleOpportunity({
  businessName,
  googleReviewUrl,
  messages,
  onGoogleAction,
  onContinue,
}: GoogleOpportunityProps) {
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
              href={googleReviewUrl}
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
