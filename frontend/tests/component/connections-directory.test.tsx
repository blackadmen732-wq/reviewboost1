import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ConnectionsDirectory,
  SEARCH_FROM,
  type DirectoryProvider,
} from "@/features/connections/connections-directory";

function provider(
  id: string,
  availability: DirectoryProvider["availability"],
  connectionState: string | null = null,
): DirectoryProvider {
  return {
    id,
    displayName: id === "google_sheets" ? "Google Sheets" : id.charAt(0).toUpperCase() + id.slice(1),
    monogram: id.slice(0, 2),
    logoSrc: null,
    categories: ["pos"],
    summary: `${id} summary`,
    availability,
    connectionState,
  };
}

const LABELS = { pos: "Point of sale" };

describe("Connections directory", () => {
  it("calls an imported list added, not connected", () => {
    render(
      <ConnectionsDirectory
        providers={[provider("google_sheets", "available", "list_added"), provider("square", "in_setup")]}
        categoryLabels={LABELS}
      />,
    );

    // A sheet is read once and keeps no access. "Connected" would promise it
    // stays up to date.
    expect(screen.queryByRole("heading", { name: "Connected" })).not.toBeInTheDocument();
    const lists = screen.getByRole("heading", { name: "Lists you’ve added" }).closest("section");
    expect(within(lists as HTMLElement).getByText("Google Sheets")).toBeInTheDocument();
  });

  it("keeps a real connection under Connected", () => {
    render(<ConnectionsDirectory providers={[provider("square", "available", "active")]} categoryLabels={LABELS} />);

    const connected = screen.getByRole("heading", { name: "Connected" }).closest("section");
    expect(within(connected as HTMLElement).getByText("Square")).toBeInTheDocument();
  });

  it("lists planned apps on one line and asks which one the owner uses", () => {
    render(
      <ConnectionsDirectory
        providers={[provider("csv", "available"), provider("toast", "planned"), provider("clover", "planned")]}
        categoryLabels={LABELS}
      />,
    );

    const planned = document.querySelector("[data-planned-apps]") as HTMLElement;
    expect(within(planned).getByRole("link", { name: "Toast" })).toHaveAttribute("href", "/settings/connections/toast");
    expect(within(planned).getByRole("link", { name: "Clover" })).toBeInTheDocument();
    expect(within(planned).getByRole("link", { name: "Tell us which" })).toHaveAttribute("href", "/support");
    // No card for a planned app: nothing on it could be used.
    expect(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-label")?.includes("Planned"))).toHaveLength(0);
  });

  it("shows search and filters only once there is enough to search", () => {
    const few = [provider("csv", "available"), provider("square", "in_setup")];
    const { unmount } = render(<ConnectionsDirectory providers={few} categoryLabels={LABELS} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    unmount();

    const many = Array.from({ length: SEARCH_FROM }, (_, index) => provider(`app${index}`, "available"));
    render(<ConnectionsDirectory providers={many} categoryLabels={LABELS} />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });
});
