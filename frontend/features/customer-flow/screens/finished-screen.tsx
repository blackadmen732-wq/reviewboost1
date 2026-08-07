import { Check } from "lucide-react";

import type { CustomerMessages } from "@/lib/i18n/customer-messages";

export function FinishedScreen({ messages }: { messages: CustomerMessages }) {
  return (
    <section
      className="flow-screen finished-screen"
      data-flow-screen="finished"
    >
      <div className="finished-mark" aria-hidden="true">
        <Check size={28} strokeWidth={2.2} />
      </div>
      <div className="screen-heading-group">
        <h1 className="customer-question" data-screen-heading tabIndex={-1}>
          {messages.doneHeading}
        </h1>
        <p className="customer-support">{messages.doneBody}</p>
      </div>
      <p className="close-page">{messages.closePage}</p>
    </section>
  );
}
