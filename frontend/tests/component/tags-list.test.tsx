import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { TagsList } from "@/features/tags/tags-list";
import type { Stand } from "@/lib/server/owner-data";

const stand = (over: Partial<Stand> = {}): Stand => ({
  standId: "11111111-1111-1111-1111-111111111111",
  label: "Counter",
  standType: "printable_qr",
  status: "active",
  tokenPrefix: "abcd",
  locationId: "loc-1",
  locationName: "High Street",
  tokenRotatedAt: null,
  nfcProvisionedAt: null,
  lastOpenedAt: null,
  ...over,
});

describe("Tags list", () => {
  it("shows name, place, status, and last used on a tappable row", () => {
    render(
      <TagsList
        stands={[
          stand(),
          stand({
            standId: "22222222-2222-2222-2222-222222222222",
            label: "Patio",
            nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
            lastOpenedAt: new Date().toISOString(),
          }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Counter/ })).toHaveAttribute(
      "href",
      "/stands/11111111-1111-1111-1111-111111111111",
    );
    // QR and NFC are separate states, because they fail separately.
    expect(screen.getByText("Program NFC")).toBeVisible();
    expect(screen.getByText("NFC ready")).toBeVisible();
    expect(screen.getAllByText("QR ready")).toHaveLength(2);
    expect(screen.getByText(/High Street · Not used yet/)).toBeVisible();
    expect(screen.getByText(/Used today/)).toBeVisible();
  });

  it("says which half to redo after the code changed", () => {
    render(
      <TagsList
        stands={[
          stand({
            nfcProvisionedAt: "2026-09-01T00:00:00.000Z",
            tokenRotatedAt: "2026-09-10T00:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Reprint QR")).toBeVisible();
    expect(screen.getByText("Reprogram NFC")).toBeVisible();
  });
});
