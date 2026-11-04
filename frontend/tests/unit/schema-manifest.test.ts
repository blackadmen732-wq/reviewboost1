import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXPECTED_MIGRATIONS } from "@/lib/server/schema-manifest";

describe("schema manifest", () => {
  it("lists exactly the migrations in supabase/migrations, in order", () => {
    const names = readdirSync(join(process.cwd(), "..", "supabase", "migrations"))
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => file.replace(/^\d+_/, "").replace(/\.sql$/, ""));
    expect([...EXPECTED_MIGRATIONS]).toEqual(names);
  });
});
