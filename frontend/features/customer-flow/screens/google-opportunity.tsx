"use client";

import { ExternalLink, LockKeyhole } from "lucide-react";
import { useEffect, useRef } from "react";

import { buttonVariants } from "@/components/ui/button";
import { CustomerActionBar } from "@/features/customer-flow/customer-action-bar";
import { cn } from "@/lib/utils/cn";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

interface GoogleOpportunityProps {
  businessName: string;
  googleReviewUrl: string;
  messages: CustomerMessages;
  onGoogleAction: () => void;
}

export function GoogleOpportunity({
  businessName,
  googleReviewUrl,
  messages,
  onGoogleAction,
}: GoogleOpportunityProps) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    onGoogleAction();
    const frame = window.requestAnimationFrame(() => {
      linkRef.current?.click();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onGoogleAction]);

  return (
    <section className="flow-screen" data-flow-screen="google-opportunity">
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.thanksHeading}
        </h1>
        <p className="customer-support">{messages.googlePrompt}</p>
      </div>

      <div className="google-opportunity">
        <CustomerActionBar>
          <div className="action-stack">
            <a
              ref={linkRef}
              className={cn(
                buttonVariants({ variant: "primary", size: "lg" }),
                "google-review-link",
              )}
              href={googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>{messages.googleAction}</span>
              <ExternalLink aria-hidden="true" size={18} strokeWidth={2} />
            </a>
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
