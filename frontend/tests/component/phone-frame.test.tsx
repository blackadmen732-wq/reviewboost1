import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PhoneFrame } from "@/features/customer-page/phone-frame";

/**
 * The owner previews their page on a phone, drawn at the real device size and
 * scaled, so what they see is what a customer on a 390pt iPhone sees.
 */
describe("PhoneFrame", () => {
  it("lays the page out at the device's real 390 × 844", () => {
    const { container } = render(
      <PhoneFrame label="preview">
        <div data-testid="page" />
      </PhoneFrame>,
    );

    const device = container.querySelector<HTMLElement>(".phone-frame__device");
    expect(device?.style.width).toBe("390px");
    expect(device?.style.height).toBe("844px");
    expect(device?.style.transform).toMatch(/^scale\(/);
    expect(device?.querySelector("[data-testid='page']")).toBeTruthy();
  });

  it("carries the phone's own chrome, hidden from assistive tech", () => {
    const { container } = render(
      <PhoneFrame label="Mario’s preview">
        <div />
      </PhoneFrame>,
    );

    for (const part of ["status", "island", "home"]) {
      const element = container.querySelector(`.phone-frame__${part}`);
      expect(element, part).toBeTruthy();
      expect(element?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(container.querySelector(".phone-frame__time")?.textContent).toBe("9:41");
    expect(container.querySelector("[role='img']")?.getAttribute("aria-label")).toBe(
      "Mario’s preview",
    );
  });
});
