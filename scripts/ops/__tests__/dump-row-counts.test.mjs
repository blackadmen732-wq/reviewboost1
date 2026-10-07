import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const script = new URL("../dump-row-counts.sh", import.meta.url).pathname;

function counts(sql) {
  const file = join(mkdtempSync(join(tmpdir(), "dump-")), "data.sql");
  writeFileSync(file, sql);
  return execFileSync("bash", [script, file], { encoding: "utf8" });
}

test("counts rows per COPY block in the Supabase CLI's quoted format", () => {
  const sql = [
    "SET session_replication_role = replica;",
    'COPY "public"."organizations" ("id", "name") FROM stdin;',
    "a1\tMario’s Pizza",
    "b2\tLine one\\nline two",
    "\\.",
    "",
    'COPY "public"."review_stands" ("id") FROM stdin;',
    "\\.",
    'COPY "auth"."users" ("id") FROM stdin;',
    "u1",
    "\\.",
    "",
  ].join("\n");

  assert.equal(
    counts(sql),
    '"public"."organizations"\t2\n"public"."review_stands"\t0\n"auth"."users"\t1\n',
  );
});

test("counts rows in plain pg_dump format too", () => {
  const sql = ["COPY public.locations (id) FROM stdin;", "l1", "l2", "l3", "\\.", ""].join("\n");

  assert.equal(counts(sql), "public.locations\t3\n");
});
