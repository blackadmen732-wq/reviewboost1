import { describe, expect, it } from "vitest";

import {
  deriveHomeModel,
  isHomeEmpty,
  tagStatusLine,
  type HomeCounts,
  type HomeStand,
} from "@/features/dashboard/home-model";

const emptyCounts: HomeCounts = {
  ratingsToday: 0,
  unread: 0,
  activeStands: 0,
  recentCount: 0,
  hasGoogleLink: true,
};

const liveStand: HomeStand = {
  standId: "stand-1",
  label: "Counter",
  status: "active",
  nfcProvisionedAt: null,
  tokenRotatedAt: null,
};

describe("isHomeEmpty", () => {
  it("is empty only when nobody has rated", () => {
    expect(isHomeEmpty(emptyCounts)).toBe(true);
    expect(isHomeEmpty({ ...emptyCounts, recentCount: 2 })).toBe(false);
    expect(isHomeEmpty({ ...emptyCounts, ratingsToday: 1 })).toBe(false);
  });
});

describe("deriveHomeModel", () => {
  it("empty without a tag offers Create a Tag and hides preview", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [],
      hasLocation: true,
    });

    expect(model.kind).toBe("empty");
    expect(model.primary).toEqual({ label: "Create a Tag", href: "/stands" });
    expect(model.showPreview).toBe(false);
    expect(model.previewStandId).toBeNull();
  });

  it("empty with a tag offers Print your code and a preview", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.kind).toBe("empty");
    expect(model.primary).toEqual({ label: "Print your code", href: "/stands" });
    expect(model.showPreview).toBe(true);
    expect(model.previewStandId).toBe("stand-1");
  });

  it("sends Create a Tag to onboarding when there is no location", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [],
      hasLocation: false,
    });

    expect(model.primary).toEqual({ label: "Create a Tag", href: "/onboarding" });
  });

  it("active with unread leads with Read feedback", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 4, unread: 2 },
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.kind).toBe("active");
    expect(model.primary).toEqual({ label: "Read feedback", href: "/feedback" });
    expect(model.attentions.some((item) => item.kind === "unread")).toBe(true);
  });

  it("active and quiet has no green CTA", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 8 },
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.primary).toBeNull();
    expect(model.attentions).toEqual([]);
  });

  it("flags a tag that was rotated after NFC write", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 3 },
      stands: [
        {
          ...liveStand,
          nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
          tokenRotatedAt: "2026-09-08T00:00:00.000Z",
        },
      ],
      hasLocation: true,
    });

    expect(model.tagStatus.needsRewrite).toBe(1);
    expect(model.attentions[0]?.kind).toBe("tag-rewrite");
  });
});

describe("tagStatusLine", () => {
  it("states absence honestly", () => {
    expect(tagStatusLine({ total: 0, live: 0, programmed: 0, needsRewrite: 0 })).toBe(
      "No tags yet",
    );
  });

  it("uses real counts only", () => {
    expect(
      tagStatusLine({ total: 2, live: 2, programmed: 1, needsRewrite: 0 }),
    ).toBe("2 tags · 1 programmed");
  });
});
