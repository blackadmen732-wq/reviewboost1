import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerFlow } from "@/features/customer-flow/customer-flow";
import { CustomerPageEditor } from "@/features/customer-page/customer-page-editor";
import {
  getCustomerFlowApi,
  type CustomerFlowApi,
} from "@/lib/api/customer-flow-api";
import type {
  CustomerReviewContext,
  SubmitResponseResponse,
} from "@/lib/api/customer-flow-types";
import { customerMessages } from "@/lib/i18n/customer-messages";
import { renderWithProviders } from "@/tests/helpers/render";

vi.mock("@/lib/api/customer-flow-api", () => ({
  getCustomerFlowApi: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  supabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const context: CustomerReviewContext = {
  business: { name: "Integration business", logoUrl: null },
  location: { name: null },
  googleReviewUrl: "https://search.google.com/local/writereview?placeid=integration",
  supportedLocales: ["en", "es", "ht"],
  defaultLocale: "en",
  presentation: {
    heroUrl: "/api/v1/public/q/printed-token/artwork",
    transform: { x: 12, y: -8, scale: 1.4 },
    tagline: null,
  },
};

const api = {
  getContext: vi.fn<CustomerFlowApi["getContext"]>(),
  createSession: vi.fn<CustomerFlowApi["createSession"]>(),
  submitResponse: vi.fn<CustomerFlowApi["submitResponse"]>(),
  recordGoogleClick: vi.fn<CustomerFlowApi["recordGoogleClick"]>(),
  submitTeamPraise: vi.fn<CustomerFlowApi["submitTeamPraise"]>(),
} satisfies CustomerFlowApi;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCustomerFlowApi).mockResolvedValue(api);
  api.getContext.mockResolvedValue(context);
  api.createSession.mockResolvedValue({ sessionId: "durable-session" });
  api.recordGoogleClick.mockResolvedValue(undefined);
});

describe("integrated owner presentation and one-tap customer contract", () => {
  it.each([1, 2, 3, 4, 5] as const)(
    "keeps rating %i on the shared card until the response receipt arrives",
    async (rating) => {
      let resolveReceipt!: (value: SubmitResponseResponse) => void;
      const receipt = new Promise<SubmitResponseResponse>((resolve) => {
        resolveReceipt = resolve;
      });
      api.submitResponse.mockReturnValue(receipt);
      const user = userEvent.setup();
      const { container } = renderWithProviders(
        <CustomerFlow token="printed-token" />,
      );

      await screen.findByRole("heading", {
        name: customerMessages.en.ratingHeading,
      });
      const hero = container.querySelector(".visit-hero__image");
      expect(hero).toHaveAttribute("src", context.presentation.heroUrl);
      expect(hero).toHaveStyle({
        transform: "translate(12%, -8%) scale(1.4)",
      });
      expect(container.querySelectorAll(".visit-stage")).toHaveLength(1);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: customerMessages.en.continue }),
      ).not.toBeInTheDocument();

      await user.click(
        screen.getByRole("radio", {
          name: customerMessages.en.ratingSpoken[rating],
        }),
      );
      await waitFor(() => expect(api.submitResponse).toHaveBeenCalledOnce());
      expect(api.submitResponse).toHaveBeenCalledWith(
        "printed-token",
        { sessionId: "durable-session", rating },
        { idempotencyKey: expect.any(String) },
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        customerMessages.en.sending,
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(api.recordGoogleClick).not.toHaveBeenCalled();
      for (const star of screen.getAllByRole("radio")) {
        expect(star).toBeDisabled();
      }

      await act(async () => {
        resolveReceipt({ responseId: "durable-response" });
        await receipt;
      });
      const link = await screen.findByRole("link", {
        name: customerMessages.en.googleAction,
      });
      expect(link).toHaveAttribute("href", context.googleReviewUrl);
      expect(container.querySelector(".visit-hero__image")).toBe(hero);
      await waitFor(() =>
        expect(api.recordGoogleClick).toHaveBeenCalledWith(
          "printed-token",
          { sessionId: "durable-session", responseId: "durable-response" },
          { idempotencyKey: expect.any(String) },
        ),
      );
      expect(api.submitTeamPraise).not.toHaveBeenCalled();
    },
  );

  it("uses the same hero transform and card for an inert owner preview", async () => {
    const { container } = render(
      <CustomerPageEditor
        initial={{
          draft: context.presentation.transform,
          draftTagline: null,
          hasDraftHero: true,
          hasPublishedHero: false,
          publishedAt: null,
          draftArtworkUrl: "/api/v1/customer-page/artwork?side=draft",
        }}
      />,
    );
    const previewTransform =
      container.querySelector<HTMLElement>(".visit-hero__image")?.style.transform;
    expect(previewTransform).toBe("translate(12%, -8%) scale(1.4)");
    expect(container.querySelectorAll(".visit-stage")).toHaveLength(1);
    expect(container.querySelectorAll("[data-card-fixed]")).toHaveLength(1);
    for (const star of screen.getAllByRole("radio")) {
      expect(star).toBeDisabled();
    }
    expect(getCustomerFlowApi).not.toHaveBeenCalled();
    cleanup();

    const live = renderWithProviders(<CustomerFlow token="printed-token" />);
    await screen.findByRole("heading", {
      name: customerMessages.en.ratingHeading,
    });
    expect(live.container.querySelector(".visit-hero__image")).toHaveStyle({
      transform: previewTransform,
    });
    expect(live.container.querySelectorAll("[data-card-fixed]")).toHaveLength(1);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.submitResponse).not.toHaveBeenCalled();
  });
});
