import { describe, expect, it } from "vitest";

import {
  enabledOAuthProviders,
  oauthErrorCode,
  oauthRedirectTo,
} from "@/lib/auth/oauth-providers";

describe("enabledOAuthProviders", () => {
  it("shows no provider buttons until a provider is switched on", () => {
    expect(enabledOAuthProviders({})).toEqual([]);
    expect(enabledOAuthProviders({ NEXT_PUBLIC_AUTH_APPLE_ENABLED: "false" })).toEqual([]);
  });

  it("lists Apple before Google when both are on", () => {
    expect(
      enabledOAuthProviders({
        NEXT_PUBLIC_AUTH_GOOGLE_ENABLED: "true",
        NEXT_PUBLIC_AUTH_APPLE_ENABLED: "1",
      }),
    ).toEqual(["apple", "google"]);
  });
});

describe("oauthRedirectTo", () => {
  it("returns to the callback route and carries the destination", () => {
    expect(oauthRedirectTo("https://reviewboost.fit", "/customer-page")).toBe(
      "https://reviewboost.fit/auth/callback?next=%2Fcustomer-page",
    );
  });
});

describe("oauthErrorCode", () => {
  it("accepts only the reasons the callback sends", () => {
    expect(oauthErrorCode("cancelled")).toBe("cancelled");
    expect(oauthErrorCode("<script>")).toBeNull();
    expect(oauthErrorCode(undefined)).toBeNull();
  });
});
