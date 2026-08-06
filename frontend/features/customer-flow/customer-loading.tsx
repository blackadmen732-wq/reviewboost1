"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import type { CustomerMessages } from "@/lib/i18n/customer-messages";

export function CustomerLoading({ messages }: { messages: CustomerMessages }) {
  const [showOpeningMessage, setShowOpeningMessage] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setShowOpeningMessage(true), 1000);
    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <CustomerFrame poweredBy={messages.poweredBy}>
      <div className="loading-header" aria-hidden="true">
        <Skeleton className="loading-avatar" />
        <div className="loading-business-copy">
          <Skeleton className="loading-business-name" />
          <Skeleton className="loading-location-name" />
        </div>
      </div>
      <section className="flow-screen loading-screen" aria-busy="true">
        <div className="screen-heading-group" aria-hidden="true">
          <Skeleton className="loading-heading" />
          <Skeleton className="loading-support" />
        </div>
        <div className="loading-stars" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((star) => (
            <span key={star}>
              <Star size={34} strokeWidth={1.7} />
            </span>
          ))}
        </div>
        <p className="opening-message" role="status" aria-live="polite">
          {showOpeningMessage ? messages.opening : ""}
        </p>
      </section>
    </CustomerFrame>
  );
}

