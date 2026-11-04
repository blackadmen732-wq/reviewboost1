import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("@/lib/supabase/browser", () => ({ supabaseBrowser: () => ({ auth }) }));

import { SignInFlow } from "@/features/auth/sign-in-flow";

/**
 * Sign-in on a bad connection, and a typo in the address. A dropped
 * connection was reported as a wrong address or a wrong code, and the code
 * that was fine got wiped.
 */
const offline = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };

function typeEmail(value: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function typeCode(code: string) {
  for (const [index, digit] of [...code].entries()) {
    fireEvent.change(screen.getByLabelText(`Digit ${index + 1}`), { target: { value: digit } });
  }
}

beforeEach(() => {
  auth.signInWithOtp.mockReset();
  auth.verifyOtp.mockReset();
});

describe("signing in when something goes wrong", () => {
  it("catches an address with no dot before sending anything", async () => {
    render(<SignInFlow next="/home" />);
    typeEmail("tony@barber");
    expect(await screen.findByText(/Check the email address/)).toBeVisible();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("says there is no connection, not that the address is wrong", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: offline });
    render(<SignInFlow next="/home" />);
    typeEmail("tony@barber.com");
    expect(await screen.findByText("No connection. Check your signal and try again.")).toBeVisible();
    expect(screen.queryByText(/Check the address/)).toBeNull();
  });

  it("keeps a good code when the connection drops, and says it still works", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    auth.verifyOtp.mockResolvedValue({ data: {}, error: offline });
    render(<SignInFlow next="/home" />);
    typeEmail("tony@barber.com");
    await screen.findByLabelText("Digit 1");
    typeCode("123456");
    expect(await screen.findByText(/No connection\. .*Your code still works\./)).toBeVisible();
    expect(screen.queryByText(/code didn’t work/)).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Digit 6")).toHaveValue("6"));
  });
});

describe("the link in the sign-in email", () => {
  it("returns through /auth/callback, which signs the owner in, to where they were going", async () => {
    // Without a redirect the link fell back to the Site URL, `/`, which never
    // exchanges the one-time code: the owner landed on the homepage, signed out.
    auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    render(<SignInFlow next="/onboarding" intent="start" />);
    typeEmail("tony@barber.com");
    await screen.findByLabelText("Digit 1");

    const [{ options }] = auth.signInWithOtp.mock.calls[0] as [{ options: { emailRedirectTo: string } }];
    const back = new URL(options.emailRedirectTo);
    expect(back.origin).toBe(window.location.origin);
    expect(back.pathname).toBe("/auth/callback");
    expect(back.searchParams.get("next")).toBe("/onboarding");
    expect(back.searchParams.get("provider")).toBe("email");
  });
});
