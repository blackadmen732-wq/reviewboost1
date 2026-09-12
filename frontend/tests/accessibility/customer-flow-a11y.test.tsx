import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { describe, expect, it, vi } from "vitest";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { FinishedScreen } from "@/features/customer-flow/screens/finished-screen";
import { GoogleOpportunity } from "@/features/customer-flow/screens/google-opportunity";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import { TeamPraiseScreen } from "@/features/customer-flow/screens/team-praise-screen";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { customerMessages } from "@/lib/i18n/customer-messages";

const messages = customerMessages.en;

describe("customer flow accessibility", () => {
  it("has no Axe violations on the shared one-tap rating view", async () => {
    const { container } = render(
      <CustomerVisitView
        heroUrl={null}
        transform={{ x: 0, y: 0, scale: 1 }}
        heading={messages.ratingHeading}
        support={messages.ratingSupport}
        footerLine={messages.footerPromise}
      >
        <RatingScreen
          businessName="Mario’s Pizza"
          messages={messages}
          rating={3}
          status="idle"
          onRate={vi.fn()}
          onRetry={vi.fn()}
          embedInVisit
        />
      </CustomerVisitView>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on the identical Google opportunity", async () => {
    const { container } = render(
      <CustomerFrame poweredBy={messages.poweredBy}>
        <GoogleOpportunity
          businessName="Mario’s Pizza"
          googleReviewUrl="https://search.google.com/local/writereview?placeid=abc"
          messages={messages}
          onGoogleAction={vi.fn()}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on Team Praise", async () => {
    const { container } = render(
      <CustomerFrame poweredBy={messages.poweredBy}>
        <TeamPraiseScreen
          businessName="Mario’s Pizza"
          messages={messages}
          firstName=""
          note=""
          status="idle"
          onDraftChange={vi.fn()}
          onSubmit={vi.fn()}
          onSkip={vi.fn()}
        />
      </CustomerFrame>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("has no Axe violations on finished and blocking states", async () => {
    const finished = render(
      <CustomerFrame poweredBy={messages.poweredBy}>
        <FinishedScreen messages={messages} />
      </CustomerFrame>,
    );
    expect((await axe(finished.container)).violations).toEqual([]);
    finished.unmount();

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
