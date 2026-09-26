import { describe, expect, it } from "vitest";

import {
  deriveHomeModel,
  isHomeEmpty,
  tagProgramPhase,
  tagProgramPhaseLabel,
  summarizeTags,
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

  it("empty without a tag still offers Create a Tag when Google is missing", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [],
      hasLocation: true,
    });

    expect(model.primary).toEqual({ label: "Create a Tag", href: "/stands" });
    expect(model.attentions[0]?.kind).toBe("tag-missing");
    expect(model.attentions.some((item) => item.kind === "google")).toBe(true);
  });

  it("names an invalid Google link once a tag exists", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false, googleLinkInvalid: true },
      stands: [liveStand],
      hasLocation: true,
    });

    expect(model.primary).toEqual({ label: "Add Google link", href: "/settings" });
    expect(model.attentions[0]?.kind).toBe("google");
    expect(model.attentions[0]?.title).toBe("That Google link is wrong");
  });

  it("sends Create a Tag to onboarding when there is no location", () => {
    const noLink = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [],
      hasLocation: false,
    });
    expect(noLink.primary).toEqual({ label: "Create a Tag", href: "/onboarding" });

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

describe("a member or viewer on Home", () => {
  it("is told what needs doing, but offered no setup button the API would refuse", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false },
      stands: [],
      hasLocation: true,
      canManage: false,
    });

    expect(model.attentions.map((a) => a.kind)).toEqual(["tag-missing", "google"]);
    expect(model.primary).toBeNull();
    expect(model.showPreview).toBe(false);
  });

  it("still gets Read feedback, which every role may do", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, unread: 2, recentCount: 5 },
      stands: [programmedStand],
      hasLocation: true,
      canManage: false,
    });

    expect(model.primary).toEqual({ label: "Read feedback", href: "/feedback" });
    expect(model.showPreview).toBe(false);
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

/**
 * A Tag that is paused or retired is not doing anything for the business.
 *
 * `hasStand` used to be `tags.live > 0 || tags.total > 0`, so the second clause
 * made any Tag count. An org whose only Tag was retired saw a finished setup,
 * no prompt to fix it, and a "preview customer page" button pointing at a Tag
 * that no longer resolves.
 */
describe("only active Tags count as ready", () => {
  const paused: HomeStand = {
    standId: "paused-1",
    label: "Paused",
    status: "paused",
    nfcProvisionedAt: "2026-01-01T00:00:00Z",
    tokenRotatedAt: null,
  };
  const retired: HomeStand = { ...paused, standId: "retired-1", status: "retired" };
  const active: HomeStand = { ...paused, standId: "active-1", status: "active" };

  const counts = {
    ratingsToday: 0,
    unread: 0,
    activeStands: 0,
    recentCount: 0,
    hasGoogleLink: true,
  };

  it("shows the missing-active-Tag state when every Tag is paused or retired", () => {
    const model = deriveHomeModel({ counts, stands: [paused, retired], hasLocation: true });

    expect(model.attentions.map((a) => a.kind)).toContain("tag-missing");
    expect(model.primary).toEqual({ label: "Create a Tag", href: "/stands" });
  });

  it("says Tags exist but none are live, rather than none exist", () => {
    const model = deriveHomeModel({ counts, stands: [paused], hasLocation: true });
    const missing = model.attentions.find((a) => a.kind === "tag-missing");

    expect(missing?.title).toBe("No Tag is live");
    expect(missing?.body).toMatch(/paused or retired/i);
  });

  it("offers no customer preview when no Tag is live", () => {
    // The preview opens the live /q page, which a retired Tag cannot serve.
    const model = deriveHomeModel({ counts, stands: [paused, retired], hasLocation: true });

    expect(model.showPreview).toBe(false);
    expect(model.previewStandId).toBeNull();
  });

  it("never picks a non-active Tag for the preview", () => {
    const model = deriveHomeModel({
      counts,
      stands: [retired, paused, active],
      hasLocation: true,
    });
    expect(model.previewStandId).toBe("active-1");
  });

  it("does not count a paused Tag as programmed", () => {
    const status = summarizeTags([paused, retired]);

    expect(status.total).toBe(2);
    expect(status.live).toBe(0);
    expect(status.programmed).toBe(0);
  });

  it("does not nag about reprogramming a retired Tag", () => {
    const staleRetired: HomeStand = {
      ...retired,
      nfcProvisionedAt: "2026-01-01T00:00:00Z",
      tokenRotatedAt: "2026-02-01T00:00:00Z",
    };
    const status = summarizeTags([staleRetired]);
    expect(status.needsRewrite).toBe(0);

    const model = deriveHomeModel({ counts, stands: [staleRetired], hasLocation: true });
    expect(model.attentions.map((a) => a.kind)).not.toContain("tag-rewrite");
  });

  it("goes back to ready once a Tag is active again", () => {
    const model = deriveHomeModel({ counts, stands: [active], hasLocation: true });

    expect(model.attentions.map((a) => a.kind)).not.toContain("tag-missing");
    expect(model.showPreview).toBe(true);
    expect(model.previewStandId).toBe("active-1");
  });

  it("reads as none live in the status line", () => {
    expect(tagStatusLine(summarizeTags([paused]))).toBe("1 tag, none live");
    expect(tagStatusLine(summarizeTags([paused, retired]))).toBe("2 tags, none live");
  });
});

/**
 * The Customer Page photo is an optional setup step. It links to the editor
 * while undone, never takes the green button, and is left out when it could
 * not be read rather than shown wrong.
 */
describe("customer page photo step", () => {
  const base = { counts: emptyCounts, stands: [liveStand], hasLocation: true };
  const photoStep = (model: ReturnType<typeof deriveHomeModel>) =>
    model.setup?.find((step) => step.key === "photo");

  it("links to the editor until a photo is published", () => {
    const model = deriveHomeModel({ ...base, hasCustomerPhoto: false });
    expect(photoStep(model)).toMatchObject({ done: false, href: "/customer-page" });
    // The one green button stays on the required path.
    expect(model.primary?.href).not.toBe("/customer-page");
  });

  it("is done, with no link, once a photo is live", () => {
    expect(photoStep(deriveHomeModel({ ...base, hasCustomerPhoto: true }))).toEqual({
      key: "photo",
      title: "Add your photo to the customer page",
      done: true,
    });
  });

  it("offers no link to someone the editor would refuse", () => {
    const step = photoStep(deriveHomeModel({ ...base, hasCustomerPhoto: false, canManage: false }));
    expect(step?.done).toBe(false);
    expect(step?.href).toBeUndefined();
  });

  it("is left out when the photo state could not be read", () => {
    expect(photoStep(deriveHomeModel({ ...base, hasCustomerPhoto: null }))).toBeUndefined();
    expect(photoStep(deriveHomeModel(base))).toBeUndefined();
  });
});
