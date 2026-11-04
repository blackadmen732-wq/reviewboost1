import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionsDirectory, type DirectoryProvider } from "@/features/connections/connections-directory";

function provider(
  id: string,
  availability: DirectoryProvider["availability"],
  connectionState: string | null = null,
  categories: string[] = ["pos"],
): DirectoryProvider {
  return {
    id,
    displayName: id === "google_sheets" ? "Google Sheets" : id.charAt(0).toUpperCase() + id.slice(1),
    monogram: id.slice(0, 2),
    website: id === "csv" ? null : `${id}.example`,
    logoSrc: null,
    categories,
    summary: `${id} summary`,
    availability,
    connectionState,
  };
}

const LABELS = { pos: "Point of sale", lists: "Customer lists" };

function card(id: string): HTMLElement {
  return document.querySelector(`[data-provider="${id}"]`) as HTMLElement;
}

describe("Connections directory", () => {
  it("calls an imported list added, not connected", () => {
    render(<ConnectionsDirectory providers={[provider("google_sheets", "available", "list_added", ["lists"])]} categoryLabels={LABELS} />);

    // A sheet is read once and keeps no access. "Connected" or "On" would
    // promise it stays up to date.
    const status = within(card("google_sheets")).getByText("Added");
    expect(status).toBeInTheDocument();
    expect(within(card("google_sheets")).queryByText("On")).not.toBeInTheDocument();
    expect(within(card("google_sheets")).getByRole("link", { name: "Manage: Google Sheets" })).toHaveAttribute(
      "href",
      "/settings/connections/google_sheets",
    );
  });

  it("puts what is on first, then what can be added, then what is coming", () => {
    render(
      <ConnectionsDirectory
        providers={[
          provider("toast", "planned"),
          provider("clover", "in_setup"),
          provider("csv", "available"),
          provider("square", "available", "active"),
        ]}
        categoryLabels={LABELS}
      />,
    );

    const order = Array.from(document.querySelectorAll("[data-provider]")).map((element) => element.getAttribute("data-provider"));
    expect(order).toEqual(["square", "csv", "clover", "toast"]);
    expect(within(card("square")).getByText("On")).toBeInTheDocument();
  });

  it("never offers a sign-in for an app that is not built", () => {
    render(<ConnectionsDirectory providers={[provider("toast", "planned"), provider("clover", "in_setup")]} categoryLabels={LABELS} />);

    expect(within(card("toast")).getByText("Planned")).toBeInTheDocument();
    expect(within(card("clover")).getByText("Coming soon")).toBeInTheDocument();
    // The button only opens the description.
    expect(within(card("toast")).getByRole("link", { name: "Details: Toast" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Connect/ })).not.toBeInTheDocument();
  });

  it("links to the company's own site, opening a new tab", () => {
    render(<ConnectionsDirectory providers={[provider("square", "available")]} categoryLabels={LABELS} />);

    const site = within(card("square")).getByRole("link", { name: /square\.example/ });
    expect(site).toHaveAttribute("href", "https://square.example");
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("filters by kind and by name", () => {
    render(
      <ConnectionsDirectory
        providers={[provider("square", "available"), provider("csv", "available", null, ["lists"])]}
        categoryLabels={LABELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Customer lists" }));
    expect(card("square")).toBeNull();
    expect(card("csv")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "All apps" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "squ" } });
    expect(card("square")).not.toBeNull();
    expect(card("csv")).toBeNull();
  });

  it("shows no tab for a kind no app has", () => {
    render(<ConnectionsDirectory providers={[provider("square", "available")]} categoryLabels={LABELS} />);
    expect(screen.queryByRole("button", { name: "Customer lists" })).not.toBeInTheDocument();
  });
});
