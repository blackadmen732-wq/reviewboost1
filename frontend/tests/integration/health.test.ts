import { describe, it, expect } from "vitest";

describe("Health endpoint", () => {
  const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

  it("returns 200 when configuration is valid", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("healthy");
  });
});
