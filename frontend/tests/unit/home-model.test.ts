import { describe, expect, it } from "vitest";

import {
  deriveHomeModel,
  isHomeEmpty,
  tagProgramPhase,
  tagProgramPhaseLabel,
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

const programmedStand: HomeStand = {
  ...liveStand,
  nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
};

describe("isHomeEmpty", () => {
  it("is empty only when nobody has rated", () => {
    expect(isHomeEmpty(emptyCounts)).toBe(true);
    expect(isHomeEmpty({ ...emptyCounts, recentCount: 2 })).toBe(false);
    expect(isHomeEmpty({ ...emptyCounts, ratingsToday: 1 })).toBe(false);
  });
});

describe("tagProgramPhase", () => {
  it("is not-programmed → programmed → needs-reprogramming", () => {
    expect(tagProgramPhase(liveStand)).toBe("not-programmed");
    expect(tagProgramPhase(programmedStand)).toBe("programmed");
    expect(
      tagProgramPhase({
        ...programmedStand,
        tokenRotatedAt: "2026-09-08T00:00:00.000Z",
      }),
    ).toBe("needs-reprogramming");
    expect(tagProgramPhaseLabel("not-programmed")).toBe("Not programmed");
    expect(tagProgramPhaseLabel("programmed")).toBe("Programmed");
    expect(tagProgramPhaseLabel("needs-reprogramming")).toBe("Needs reprogramming");
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
    expect(model.attentions[0]?.kind).toBe("tag-missing");
    expect(model.showPreview).toBe(false);
    expect(model.previewStandId).toBeNull();
  });

  it("empty with an unprogrammed tag offers Print your code", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.kind).toBe("empty");
    expect(model.primary).toEqual({ label: "Print your code", href: "/stands" });
    expect(model.attentions[0]?.kind).toBe("tag-unprogrammed");
    expect(model.showPreview).toBe(true);
    expect(model.previewStandId).toBe("stand-1");
  });

  it("empty missing Google link blocks before print", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.primary).toEqual({ label: "Add Google link", href: "/settings" });
    expect(model.attentions[0]?.kind).toBe("google");
    expect(model.attentions.some((item) => item.kind === "tag-unprogrammed")).toBe(true);
  });

  it("sends Google and Create a Tag to onboarding when there is no location", () => {
    const noLink = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [],
      hasLocation: false,
    });
    expect(noLink.primary).toEqual({ label: "Add Google link", href: "/onboarding" });

    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [],
      hasLocation: false,
    });
    expect(model.primary).toEqual({ label: "Create a Tag", href: "/onboarding" });
  });

  it("ready empty waits — no green CTA", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [programmedStand],
      hasLocation: true,
    });

    expect(model.kind).toBe("empty");
    expect(model.primary).toBeNull();
    expect(model.attentions).toEqual([]);
    expect(model.showPreview).toBe(true);
  });

  it("active with unread leads with Read feedback", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 4, unread: 2 },
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.kind).toBe("active");
    expect(model.primary).toEqual({ label: "Read feedback", href: "/feedback" });
    expect(model.attentions[0]?.kind).toBe("unread");
  });

  it("active and quiet has no green CTA", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 8 },
      stands: [programmedStand],
      hasLocation: true,
    });

    expect(model.primary).toBeNull();
    expect(model.attentions).toEqual([]);
  });

  it("never sends a finished owner back through onboarding for Google", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 3, hasGoogleLink: false },
      stands: [programmedStand],
      hasLocation: true,
    });

    expect(model.primary).toEqual({ label: "Add Google link", href: "/settings" });
    expect(model.primary?.href).not.toBe("/onboarding");
  });

  it("flags a tag that was rotated after it was programmed", () => {
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
    expect(model.primary).toEqual({ label: "Program a tag", href: "/stands" });
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

  it("names reprogramming in the sequence", () => {
    expect(
      tagStatusLine({ total: 2, live: 2, programmed: 2, needsRewrite: 1 }),
    ).toBe("2 tags · 1 needs reprogramming");
  });
});
