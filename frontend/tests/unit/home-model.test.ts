import { describe, expect, it } from "vitest";

import {
  deriveHomeModel,
  isHomeEmpty,
  tagProgramPhase,
  tagProgramPhaseLabel,
  summarizeTags,
  tagStatusLine,
  unreadBody,
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
 * The Customer Page photo is optional, so it is not one of the steps: Home
 * shows the Tags page's own three (setup-model) and, while the published page has
 * no photo, one quiet link to the editor. It never takes the black button,
 * and is left out when the photo state could not be read.
 */
describe("customer page photo", () => {
  const base = { counts: emptyCounts, stands: [liveStand], hasLocation: true };

  it("is a quiet link, never a step or the black button, until a photo is published", () => {
    const model = deriveHomeModel({ ...base, hasCustomerPhoto: false });
    expect(model.photoNudge).toBe(true);
    expect(model.setup?.map((step) => step.key)).toEqual(["page", "tag", "test"]);
    expect(model.primary?.href).not.toBe("/customer-page");
  });

  it("goes away once a photo is live", () => {
    expect(deriveHomeModel({ ...base, hasCustomerPhoto: true }).photoNudge).toBe(false);
  });

  it("is not offered to someone the editor would refuse", () => {
    expect(deriveHomeModel({ ...base, hasCustomerPhoto: false, canManage: false }).photoNudge).toBe(false);
  });

  it("is left out when the photo state could not be read", () => {
    expect(deriveHomeModel({ ...base, hasCustomerPhoto: null }).photoNudge).toBe(false);
    expect(deriveHomeModel(base).photoNudge).toBe(false);
  });
});

describe("Home's setup list is the Tags page's", () => {
  it("counts the same three steps the Tags page does", () => {
    const model = deriveHomeModel({ counts: emptyCounts, stands: [programmedStand], hasLocation: true });
    expect(model.setup?.map((step) => [step.key, step.done])).toEqual([
      ["page", true],
      ["tag", true],
      ["test", false],
    ]);
  });

  it("tells a business whose Tags are off to choose a plan before testing", () => {
    const model = deriveHomeModel({
      counts: emptyCounts,
      stands: [programmedStand],
      hasLocation: true,
      service: "no-plan",
    });
    expect(model.setup?.find((step) => step.key === "test")?.body).toMatch(/Choose a plan first/);
  });
});

describe("a legacy Google link (a listing or short link saved before review links were required)", () => {
  it("still counts as set up — its Tags work — and never takes the primary action", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, activeStands: 1, googleLinkNeedsUpgrade: true },
      stands: [programmedStand],
      hasLocation: true,
    });
    expect(model.attentions.some((item) => item.kind === "google")).toBe(false);
    expect(model.primary?.label).not.toBe("Add Google link");
    expect(model.setup?.find((step) => step.key === "page")?.done).toBe(true);
  });

  it("asks for the upgrade, saying it still works and that Tags stay the same", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 3, activeStands: 1, googleLinkNeedsUpgrade: true },
      stands: [programmedStand],
      hasLocation: true,
    });
    const upgrade = model.attentions.find((item) => item.kind === "google-upgrade");
    expect(upgrade?.title).toBe("Upgrade your Google link");
    expect(upgrade?.body).toMatch(/^It still works\./);
    expect(upgrade?.body).toMatch(/Your Tags stay the same\./);
  });

  it("comes after anything that actually stops a Tag working", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 3, activeStands: 1, unread: 2, googleLinkNeedsUpgrade: true },
      stands: [{ ...programmedStand, tokenRotatedAt: "2026-09-10T00:00:00.000Z" }],
      hasLocation: true,
    });
    const kinds = model.attentions.map((item) => item.kind);
    expect(kinds.at(-1)).toBe("google-upgrade");
  });

  it("is not raised for a direct review link", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 3, activeStands: 1 },
      stands: [programmedStand],
      hasLocation: true,
    });
    expect(model.attentions.some((item) => item.kind === "google-upgrade")).toBe(false);
  });
});

/**
 * Setting up and serving customers are separate (migration 20260915001400).
 * A business with no plan, a cancelled one or a suspended one has Tags that
 * show "This review link isn't active" to everyone who scans them, so that is
 * the first thing Home says, ahead of everything else.
 */
describe("Tags that are switched off", () => {
  const ready = { counts: { ...emptyCounts, activeStands: 1 }, stands: [programmedStand], hasLocation: true };

  it("leads Home with the plan, and gives the owner the button to fix it", () => {
    const model = deriveHomeModel({ ...ready, service: "no-plan", canManageBilling: true });
    expect(model.attentions[0]).toMatchObject({ kind: "plan", title: "Your Tag is off until you choose a plan" });
    expect(model.attentions[0]?.body).toContain("This review link isn’t active");
    expect(model.primary).toEqual({ label: "Choose a plan", href: "/settings/billing" });
  });

  it("is named ahead of unread ratings on a busy Home", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, recentCount: 9, unread: 3, activeStands: 1 },
      stands: [programmedStand],
      hasLocation: true,
      service: "cancelled",
      canManageBilling: true,
    });
    expect(model.attentions.map((item) => item.kind).slice(0, 2)).toEqual(["plan", "unread"]);
    expect(model.primary?.label).toBe("Choose a plan");
  });

  it("tells someone who cannot change the plan, without a button they would be refused", () => {
    const model = deriveHomeModel({ ...ready, service: "suspended", canManageBilling: false });
    expect(model.attentions[0]?.title).toBe("Your Tags are switched off");
    expect(model.primary?.href).not.toBe("/settings/billing");
  });

  it("asks for a new card when a payment failed, saying the Tags still work", () => {
    const model = deriveHomeModel({ ...ready, service: "past-due", canManageBilling: true });
    expect(model.attentions[0]).toMatchObject({ kind: "payment", body: "Your Tags still work. Update your card to keep it that way." });
    expect(model.primary).toEqual({ label: "Update payment", href: "/settings/billing" });
  });

  it("says nothing about billing when the Tags are open, or when the state could not be read", () => {
    for (const service of ["serving", "trial", "unknown"] as const) {
      const model = deriveHomeModel({ ...ready, service, canManageBilling: true });
      expect(model.attentions.some((item) => item.kind === "plan" || item.kind === "payment")).toBe(false);
    }
  });
});

describe("new ratings, in numbers", () => {
  it("says how many are 3 stars or fewer, so a complaint is not read as praise", () => {
    expect(unreadBody(4, 2)).toBe("2 are 3 stars or fewer. See them before the next rush.");
    expect(unreadBody(4, 1)).toBe("1 is 3 stars or fewer. See them before the next rush.");
    expect(unreadBody(3, 3)).toBe("All 3 are 3 stars or fewer. See them before the next rush.");
    expect(unreadBody(1, 1)).toBe("It’s 3 stars or fewer. See it before the next rush.");
  });

  it("calls good news good news", () => {
    expect(unreadBody(4, 0)).toBe("All 4 or 5 stars. Have a look when you get a minute.");
    expect(unreadBody(1, 0)).toBe("A 4 or 5-star rating. Have a look when you get a minute.");
  });

  it("falls back to the plain line when the split is not known", () => {
    expect(unreadBody(2, undefined)).toBe("See them before the next rush.");
  });
});

describe("a low rating that has been read but not sorted", () => {
  const active = { ...emptyCounts, recentCount: 6, activeStands: 1 };

  it("still needs the owner on Home, as it does in Feedback's Needs you", () => {
    const model = deriveHomeModel({ counts: { ...active, unread: 0, openLow: 2 }, stands: [programmedStand], hasLocation: true });
    expect(model.attentions[0]).toMatchObject({ kind: "unsorted", title: "2 low ratings aren’t sorted yet" });
    expect(model.primary).toEqual({ label: "Read feedback", href: "/feedback" });
  });

  it("gives way to unread ratings, which already say how many are low", () => {
    const model = deriveHomeModel({ counts: { ...active, unread: 1, unreadLow: 1, openLow: 3 }, stands: [programmedStand], hasLocation: true });
    expect(model.attentions.map((item) => item.kind)).toContain("unread");
    expect(model.attentions.map((item) => item.kind)).not.toContain("unsorted");
  });

  it("leaves Home calm once every low rating is sorted", () => {
    const model = deriveHomeModel({ counts: { ...active, unread: 0, openLow: 0 }, stands: [programmedStand], hasLocation: true });
    expect(model.attentions).toEqual([]);
    expect(model.primary).toBeNull();
  });
});

describe("a business that has never had a plan, still setting up", () => {
  it("finishes setting up first, with the plan said under the steps", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, hasGoogleLink: false, activeStands: 1 },
      stands: [liveStand],
      hasLocation: true,
      service: "no-plan",
      canManageBilling: true,
    });
    expect(model.attentions[0]?.kind).toBe("google");
    expect(model.primary).toEqual({ label: "Add Google link", href: "/settings" });
    expect(model.planNote).toEqual({ title: "Your Tag is off until you choose a plan", href: "/settings/billing" });
  });

  it("is asked for the plan once setup is done", () => {
    const model = deriveHomeModel({
      counts: { ...emptyCounts, activeStands: 1 },
      stands: [liveStand],
      hasLocation: true,
      service: "no-plan",
      canManageBilling: true,
    });
    expect(model.attentions[0]?.kind).toBe("plan");
    expect(model.primary?.label).toBe("Choose a plan");
    expect(model.planNote).toBeNull();
  });
});
