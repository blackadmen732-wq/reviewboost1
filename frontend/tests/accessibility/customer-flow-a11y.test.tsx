import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import { customerMessages } from "@/lib/i18n/customer-messages";

const messages = customerMessages.en;

describe("customer flow accessibility", () => {
  it("has no Axe violations on the rating screen", async () => {
    const { container } = render(
      <CustomerFrame poweredBy={messages.poweredBy}>
        <RatingScreen
          messages={messages}
          rating={3}
          status="idle"
          onRatingChange={vi.fn()}
          onRetry={vi.fn()}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on the error state", async () => {
    const { container } = render(
      <CustomerFrame poweredBy={messages.poweredBy}>
        <RatingScreen
          messages={messages}
          rating={2}
          status="error"
          onRatingChange={vi.fn()}
          onRetry={vi.fn()}
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
