import { describe, expect, it } from "vitest";

import {
  deriveHomeModel,
  isHomeEmpty,
  ratingsHeadline,
  summarizeTags,
  tagNeedsRewrite,
  tagProgramPhase,
  tagStatusLine,
  type HomeCounts,
  type HomeStand,
} from "@/features/dashboard/home-model";

const BASE_COUNTS: HomeCounts = {
  ratingsToday: 0,
  unread: 0,
  activeStands: 0,
  recentCount: 0,
  hasGoogleLink: true,
};

function stand(overrides: Partial<HomeStand> = {}): HomeStand {
  return {
    standId: "s1",
    label: "Front counter",
    status: "active",
    nfcProvisionedAt: null,
    tokenRotatedAt: null,
    ...overrides,
  };
}

describe("isHomeEmpty", () => {
  it("returns true when both counts are zero", () => {
    expect(isHomeEmpty({ recentCount: 0, ratingsToday: 0 })).toBe(true);
  });

  it("returns false when ratingsToday > 0", () => {
    expect(isHomeEmpty({ recentCount: 0, ratingsToday: 1 })).toBe(false);
  });

  it("returns false when recentCount > 0", () => {
    expect(isHomeEmpty({ recentCount: 5, ratingsToday: 0 })).toBe(false);
  });
});

describe("tagProgramPhase", () => {
  it("returns not-programmed when nfcProvisionedAt is null", () => {
    expect(tagProgramPhase(stand())).toBe("not-programmed");
  });

  it("returns programmed when provisioned and no rotation", () => {
    expect(tagProgramPhase(stand({ nfcProvisionedAt: "2024-01-01T00:00:00Z" }))).toBe("programmed");
  });

  it("returns programmed when provisioned after rotation", () => {
    expect(
      tagProgramPhase(
        stand({
          nfcProvisionedAt: "2024-06-01T00:00:00Z",
          tokenRotatedAt: "2024-01-01T00:00:00Z",
        }),
      ),
    ).toBe("programmed");
  });

  it("returns needs-reprogramming when rotation is after provisioning", () => {
    expect(
      tagProgramPhase(
        stand({
          nfcProvisionedAt: "2024-01-01T00:00:00Z",
          tokenRotatedAt: "2024-06-01T00:00:00Z",
        }),
      ),
    ).toBe("needs-reprogramming");
  });
});

describe("tagNeedsRewrite", () => {
  it("returns false when nfc not provisioned", () => {
    expect(tagNeedsRewrite(stand())).toBe(false);
  });

  it("returns false when token not rotated", () => {
    expect(tagNeedsRewrite(stand({ nfcProvisionedAt: "2024-01-01T00:00:00Z" }))).toBe(false);
  });

  it("returns true when rotated after provisioned", () => {
    expect(
      tagNeedsRewrite(
        stand({
          nfcProvisionedAt: "2024-01-01T00:00:00Z",
          tokenRotatedAt: "2024-06-01T00:00:00Z",
        }),
      ),
    ).toBe(true);
  });

  it("returns false when provisioned after rotated", () => {
    expect(
      tagNeedsRewrite(
        stand({
          nfcProvisionedAt: "2024-06-01T00:00:00Z",
          tokenRotatedAt: "2024-01-01T00:00:00Z",
        }),
      ),
    ).toBe(false);
  });
});

describe("summarizeTags", () => {
  it("returns zeros for empty list", () => {
    expect(summarizeTags([])).toEqual({ total: 0, live: 0, programmed: 0, needsRewrite: 0 });
  });

  it("counts active stands", () => {
    const tags = summarizeTags([stand(), stand({ standId: "s2", status: "inactive" })]);
    expect(tags.live).toBe(1);
    expect(tags.total).toBe(2);
  });

  it("counts programmed stands", () => {
    const tags = summarizeTags([stand({ nfcProvisionedAt: "2024-01-01T00:00:00Z" }), stand()]);
    expect(tags.programmed).toBe(1);
  });

  it("counts needsRewrite", () => {
    const tags = summarizeTags([
      stand({
        nfcProvisionedAt: "2024-01-01T00:00:00Z",
        tokenRotatedAt: "2024-06-01T00:00:00Z",
      }),
    ]);
    expect(tags.needsRewrite).toBe(1);
  });
});

describe("deriveHomeModel", () => {
  it("returns empty kind when no activity", () => {
    const model = deriveHomeModel({ counts: BASE_COUNTS, stands: [], hasLocation: true });
    expect(model.kind).toBe("empty");
  });

  it("returns active kind when ratingsToday > 0", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, ratingsToday: 3 },
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.kind).toBe("active");
  });

  it("shows google attention when no google link", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, hasGoogleLink: false },
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.attentions.some((a) => a.kind === "google")).toBe(true);
  });

  it("shows google-invalid attention body when googleLinkInvalid", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, hasGoogleLink: false, googleLinkInvalid: true },
      stands: [stand()],
      hasLocation: true,
    });
    const google = model.attentions.find((a) => a.kind === "google");
    expect(google?.title).toContain("wrong");
  });

  it("shows tag-missing attention when no stands", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [],
      hasLocation: true,
    });
    expect(model.attentions.some((a) => a.kind === "tag-missing")).toBe(true);
  });

  it("shows tag-unprogrammed attention when stand exists but not programmed", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.attentions.some((a) => a.kind === "tag-unprogrammed")).toBe(true);
  });

  it("shows tag-rewrite attention when tag needs reprogramming", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [
        stand({
          nfcProvisionedAt: "2024-01-01T00:00:00Z",
          tokenRotatedAt: "2024-06-01T00:00:00Z",
        }),
      ],
      hasLocation: true,
    });
    expect(model.attentions.some((a) => a.kind === "tag-rewrite")).toBe(true);
  });

  it("shows unread attention when unread > 0", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, unread: 3 },
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.attentions.some((a) => a.kind === "unread")).toBe(true);
  });

  it("primary is Create a Tag when no stands", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [],
      hasLocation: true,
    });
    expect(model.primary?.label).toBe("Create a Tag");
  });

  it("primary is Add Google link when stands exist but no google link", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, hasGoogleLink: false },
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.primary?.label).toBe("Add Google link");
  });

  it("primary is Read feedback when unread > 0 and active", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, ratingsToday: 1, unread: 2 },
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.primary?.label).toBe("Read feedback");
  });

  it("primary is Program a tag when tags need rewrite", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [
        stand({
          nfcProvisionedAt: "2024-01-01T00:00:00Z",
          tokenRotatedAt: "2024-06-01T00:00:00Z",
        }),
      ],
      hasLocation: true,
    });
    expect(model.primary?.label).toBe("Program a tag");
  });

  it("showPreview is true when stands exist", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [stand()],
      hasLocation: true,
    });
    expect(model.showPreview).toBe(true);
  });

  it("showPreview is false when no stands", () => {
    const model = deriveHomeModel({
      counts: BASE_COUNTS,
      stands: [],
      hasLocation: true,
    });
    expect(model.showPreview).toBe(false);
  });

  it("primary is null when everything is set up and active", () => {
    const model = deriveHomeModel({
      counts: { ...BASE_COUNTS, ratingsToday: 5, recentCount: 10 },
      stands: [stand({ nfcProvisionedAt: "2024-01-01T00:00:00Z" })],
      hasLocation: true,
    });
    expect(model.primary).toBeNull();
  });
});

describe("ratingsHeadline", () => {
  it("returns null when ratingsThisWeek is undefined", () => {
    expect(ratingsHeadline({})).toBeNull();
  });

  it("returns null when ratingsThisWeek is 0 and no last week", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 0 })).toBeNull();
  });

  it("returns count when only this week", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 5 })).toBe("5 ratings this week");
  });

  it("singular form for 1 rating", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 1 })).toBe("1 rating this week");
  });

  it("shows same as last week", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 5, ratingsLastWeek: 5 })).toBe(
      "5 ratings this week, same as last week",
    );
  });

  it("shows up delta", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 8, ratingsLastWeek: 5 })).toBe(
      "8 ratings this week, up 3",
    );
  });

  it("shows down delta", () => {
    expect(ratingsHeadline({ ratingsThisWeek: 3, ratingsLastWeek: 5 })).toBe(
      "3 ratings this week, down 2",
    );
  });
});

describe("tagStatusLine", () => {
  it("returns 'No tags yet' for zero total", () => {
    expect(tagStatusLine({ total: 0, live: 0, programmed: 0, needsRewrite: 0 })).toBe(
      "No tags yet",
    );
  });

  it("singular tag", () => {
    expect(tagStatusLine({ total: 1, live: 1, programmed: 1, needsRewrite: 0 })).toBe(
      "1 tag · 1 programmed",
    );
  });

  it("plural tags with programmed", () => {
    expect(tagStatusLine({ total: 3, live: 3, programmed: 2, needsRewrite: 0 })).toBe(
      "3 tags · 2 programmed",
    );
  });

  it("shows needsRewrite over programmed", () => {
    expect(tagStatusLine({ total: 2, live: 2, programmed: 2, needsRewrite: 1 })).toBe(
      "2 tags · 1 needs reprogramming",
    );
  });

  it("shows not programmed yet when none programmed", () => {
    expect(tagStatusLine({ total: 2, live: 2, programmed: 0, needsRewrite: 0 })).toBe(
      "2 tags · not programmed yet",
    );
  });
});
