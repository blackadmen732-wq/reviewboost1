import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import { LanguageSelector } from "@/features/customer-flow/language-selector";
import { customerMessages } from "@/lib/i18n/customer-messages";

afterEach(() => vi.useRealTimers());

describe("customer loading", () => {
  it("shows meaningful skeletons before adding the delayed opening message", () => {
    vi.useFakeTimers();
    render(<CustomerLoading messages={customerMessages.en} />);
    expect(screen.queryByText(customerMessages.en.opening)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".loading-stars svg")).toHaveLength(5);

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(customerMessages.en.opening)).toBeVisible();
  });
});

describe("language selector", () => {
  it("uses language names rather than flags", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <LanguageSelector
        locale="en"
        supported={["en", "es", "ht"]}
        messages={customerMessages.en}
        onChange={onChange}
      />,
    );
    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "ht");
    expect(onChange).toHaveBeenCalledWith("ht");
    expect(screen.getByRole("option", { name: "Kreyòl ayisyen" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/🇺🇸|🇪🇸|🇭🇹/u);
  });
});
