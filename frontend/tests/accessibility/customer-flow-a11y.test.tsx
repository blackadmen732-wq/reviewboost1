import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { HandoffScreen } from "@/features/customer-flow/screens/handoff-screen";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import { customerMessages } from "@/lib/i18n/customer-messages";

const messages = customerMessages.en;

describe("customer flow accessibility", () => {
  it("has no Axe violations on the rating state", async () => {
    const { container } = render(
      <CustomerFrame>
        <RatingScreen
          messages={messages}
          rating={3}
          status="idle"
          onRate={vi.fn()}
          onRetry={vi.fn()}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on the recoverable error state", async () => {
    const { container } = render(
      <CustomerFrame>
        <RatingScreen
          messages={messages}
          rating={2}
          status="error"
          onRate={vi.fn()}
          onRetry={vi.fn()}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on the identical handoff", async () => {
    const { container } = render(
      <CustomerFrame>
        <HandoffScreen
          businessName="Mario's Pizza"
          destinationUrl="https://search.google.com/local/writereview?placeid=abc"
          messages={messages}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on blocking states", async () => {
    const unavailable = render(
      <CustomerBlockingState
        kind="unavailable"
        locale="en"
        messages={messages}
        onLocaleChange={vi.fn()}
      />,
    );
    expect((await axe(unavailable.container)).violations).toEqual([]);
  });
});
