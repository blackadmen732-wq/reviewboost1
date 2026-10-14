// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isLoading: true,
  isLoggedIn: false,
  activeOrg: null as null | { orgId: string },
}));
const splash = vi.hoisted(() => ({
  preventAutoHideAsync: vi.fn().mockResolvedValue(undefined),
  hideAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("expo-splash-screen", () => splash);
vi.mock("@/data/auth-context", () => ({
  useAuth: () => state,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/launch-screen", () => ({
  LAUNCH_BACKGROUND: "#005B3E",
  LaunchScreen: ({ onReady }: { onReady?: () => void }) => (
    <button onClick={onReady}>Launch logo ready</button>
  ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  StatusBar: () => null,
  View: ({
    children,
    onLayout,
  }: {
    children: React.ReactNode;
    onLayout?: () => void;
  }) => {
    React.useEffect(() => {
      onLayout?.();
    }, [onLayout]);
    return <div>{children}</div>;
  },
}));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => <p>Destination: {href}</p>,
  Stack: Object.assign(
    ({ children }: { children: React.ReactNode }) => (
      <div data-testid="navigator">{children}</div>
    ),
    {
      Screen: () => null,
      Protected: ({
        guard,
        children,
      }: {
        guard: boolean;
        children: React.ReactNode;
      }) => (guard ? children : null),
    },
  ),
}));
import Index from "../../app/index";
import RootLayout from "../../app/_layout";

beforeEach(() => {
  vi.stubGlobal("React", React);
  state.isLoading = true;
  state.isLoggedIn = false;
  state.activeOrg = null;
  splash.hideAsync.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("retains launch content until its image is ready, without mounting protected navigation", () => {
  expect(splash.preventAutoHideAsync).toHaveBeenCalledOnce();
  render(<RootLayout />);
  expect(screen.queryByTestId("navigator")).toBeNull();
  expect(splash.hideAsync).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Launch logo ready" }));
  expect(splash.hideAsync).toHaveBeenCalledOnce();
});
it("dismisses the native launch on the restored screen's layout without a forced delay", () => {
  state.isLoading = false;
  render(<RootLayout />);
  expect(screen.getByTestId("navigator")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(splash.hideAsync).toHaveBeenCalledOnce();
});
it("does not redirect before session restoration finishes", () => {
  render(<Index />);
  expect(screen.queryByText(/Destination:/)).toBeNull();
});
it.each([
  [false, null, "/login"],
  [true, null, "/select-org"],
  [true, { orgId: "business" }, "/(tabs)/feed"],
])(
  "preserves the existing restored-session route (%s, %s)",
  (loggedIn, org, destination) => {
    state.isLoading = false;
    state.isLoggedIn = loggedIn;
    state.activeOrg = org;
    render(<Index />);
    expect(screen.getByText(`Destination: ${destination}`)).toBeTruthy();
  },
);
