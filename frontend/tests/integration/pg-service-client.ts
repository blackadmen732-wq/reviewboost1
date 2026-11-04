import { execFileSync } from "node:child_process";

/**
 * A minimal stand-in for the service-role Supabase client, backed by psql
 * against the throwaway cluster from `scripts/backend/local-postgres.sh`.
 *
 * It covers exactly what the Connections server code calls: `rpc()` with
 * named arguments, and simple `from().select().eq()...` reads. Every call
 * runs as `service_role`, so grants are enforced as in production. Used only
 * by the opt-in end-to-end test; never by application code.
 */

const PORT = process.env.RB_PGPORT ?? "55432";
const DB = process.env.RB_PGDB ?? "reviewboost";

export function psql(sql: string): string {
  return execFileSync(
    "psql",
    ["-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", PORT, "-U", "postgres", "-d", DB, "-c", sql],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function asServiceRole(sql: string): string {
  return psql(`set role service_role; ${sql}`);
}

const lit = (value: string) => `'${value.replace(/'/g, "''")}'`;

interface Signature {
  args: Map<string, string>;
  returnsSet: boolean;
  returnsVoid: boolean;
}

const signatures = new Map<string, Signature>();

function signature(name: string): Signature {
  const cached = signatures.get(name);
  if (cached) return cached;
  const row = psql(
    `select json_build_object('names', p.proargnames, 'types', (select json_agg(format_type(t, null)) from unnest(p.proargtypes) t), 'set', p.proretset or pg_get_function_result(p.oid) like 'TABLE%', 'result', pg_get_function_result(p.oid))
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ${lit(name)}`,
  );
  if (!row) throw new Error(`No function public.${name}`);
  const parsed = JSON.parse(row) as { names: string[] | null; types: string[] | null; set: boolean; result: string };
  const args = new Map<string, string>();
  (parsed.types ?? []).forEach((type, index) => args.set(parsed.names?.[index] ?? `$${index}`, type));
  const sig = { args, returnsSet: parsed.set, returnsVoid: parsed.result === "void" };
  signatures.set(name, sig);
  return sig;
}

function literal(value: unknown, type: string): string {
  if (value === null || value === undefined) return `null::${type}`;
  if (type.endsWith("[]")) {
    return `array(select jsonb_array_elements_text(${lit(JSON.stringify(value))}::jsonb))::${type}`;
  }
  if (type === "jsonb" || type === "json") return `${lit(JSON.stringify(value))}::${type}`;
  return `${lit(String(value))}::${type}`;
}

type Result = { data: unknown; error: { message: string } | null };

function run(fn: () => unknown): Result {
  try {
    return { data: fn(), error: null };
  } catch (caught) {
    const stderr = (caught as { stderr?: string }).stderr ?? String(caught);
    return { data: null, error: { message: stderr } };
  }
}

class Query implements PromiseLike<Result> {
  private filters: string[] = [];
  private orderBy = "";
  private limitBy = "";
  private single = false;

  constructor(
    private readonly table: string,
    private columns = "*",
  ) {}

  select(columns: string) {
    this.columns = columns;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push(`${column} = ${lit(String(value))}`);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push(`${column} <> ${lit(String(value))}`);
    return this;
  }
  in(column: string, values: readonly unknown[]) {
    this.filters.push(values.length ? `${column} in (${values.map((v) => lit(String(v))).join(", ")})` : "false");
    return this;
  }
  is(column: string, value: null) {
    this.filters.push(`${column} is ${value === null ? "null" : "not null"}`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = ` order by ${column} ${options?.ascending === false ? "desc" : "asc"}`;
    return this;
  }
  limit(count: number) {
    this.limitBy = ` limit ${count}`;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const where = this.filters.length ? ` where ${this.filters.join(" and ")}` : "";
    const sql = `select coalesce(json_agg(to_json(q)), '[]') from (select ${this.columns} from public.${this.table}${where}${this.orderBy}${this.limitBy}) q`;
    const result = run(() => {
      const rows = JSON.parse(asServiceRole(sql)) as unknown[];
      return this.single ? (rows[0] ?? null) : rows;
    });
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export function pgServiceClient() {
  return {
    rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      return Promise.resolve(
        run(() => {
          const sig = signature(name);
          const named = Object.entries(args).map(([key, value]) => {
            const type = sig.args.get(key);
            if (!type) throw Object.assign(new Error(`unknown argument ${key} for ${name}`), { stderr: `unknown argument ${key}` });
            return `${key} => ${literal(value, type)}`;
          });
          const call = `public.${name}(${named.join(", ")})`;
          if (sig.returnsVoid) {
            asServiceRole(`select ${call}`);
            return null;
          }
          const out = sig.returnsSet
            ? asServiceRole(`select coalesce(json_agg(to_json(r)), '[]') from ${call} r`)
            : asServiceRole(`select to_json(${call})`);
          return out === "" ? null : JSON.parse(out);
        }),
      );
    },
    from(table: string) {
      return new Query(table);
    },
  };
}
