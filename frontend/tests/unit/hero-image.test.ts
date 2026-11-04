import { describe, expect, it } from "vitest";

import { heroImageRemotePattern, heroImageSources } from "@/lib/customer-page/hero-image";

/** The owner's photo reaches a customer at phone size, not as the original upload. */
describe("customer page photo", () => {
  const SUPABASE = "https://abcd1234.supabase.co";
  const PHOTO = `${SUPABASE}/storage/v1/object/public/customer-page/org/hero-1.jpg`;

  it("goes through the image optimizer at a few phone widths", () => {
    const sources = heroImageSources(PHOTO, SUPABASE);
    expect(sources.src).toBe(`/_next/image?url=${encodeURIComponent(PHOTO)}&w=828&q=75`);
    expect(sources.srcSet?.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["640w", "828w", "1080w", "1200w"]);
    expect(sources.sizes).toBeTruthy();
  });

  it("leaves anything else alone: drafts, other hosts, a local stack", () => {
    expect(heroImageSources("blob:https://reviewboost.fit/123", SUPABASE)).toEqual({ src: "blob:https://reviewboost.fit/123" });
    expect(heroImageSources("https://evil.example/x.jpg", SUPABASE)).toEqual({ src: "https://evil.example/x.jpg" });
    const local = "http://127.0.0.1:54321/storage/v1/object/public/customer-page/x.jpg";
    expect(heroImageSources(local, "http://127.0.0.1:54321")).toEqual({ src: local });
    expect(heroImageSources(PHOTO, undefined)).toEqual({ src: PHOTO });
  });

  it("lets the optimizer read only the public customer-page bucket", () => {
    expect(heroImageRemotePattern(SUPABASE)).toEqual({
      protocol: "https",
      hostname: "abcd1234.supabase.co",
      pathname: "/storage/v1/object/public/customer-page/**",
    });
    expect(heroImageRemotePattern("http://127.0.0.1:54321")).toBeNull();
    expect(heroImageRemotePattern(undefined)).toBeNull();
  });
});
