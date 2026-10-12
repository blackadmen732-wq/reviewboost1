import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { customerAssetUrl } from "@/lib/server/customer-asset-url";

afterEach(() => vi.unstubAllEnvs());

describe("customer artwork origins", () => {
  it("supports the documented local Storage origin for development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(
      customerAssetUrl(
        "http://127.0.0.1:54321/storage/v1/object/public/customer-page/photo.jpg",
      ),
    ).not.toBeNull();
    expect(customerAssetUrl("http://localhost:54321/photo.jpg")).not.toBeNull();
    expect(customerAssetUrl("http://127.0.0.1.evil.test/photo.jpg")).toBeNull();
    expect(customerAssetUrl("http://example.test/photo.jpg")).toBeNull();
  });
  it("keeps HTTPS required in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      customerAssetUrl("https://assets.reviewboost.test/photo.jpg"),
    ).not.toBeNull();
    expect(customerAssetUrl("http://127.0.0.1:54321/photo.jpg")).toBeNull();
    expect(customerAssetUrl("http://localhost/photo.jpg")).toBeNull();
    expect(
      customerAssetUrl("https://user:password@example.test/photo.jpg"),
    ).toBeNull();
    expect(customerAssetUrl("javascript:alert(1)")).toBeNull();
  });
});
