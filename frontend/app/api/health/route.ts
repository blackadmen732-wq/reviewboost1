import { validateServerConfig } from "@/lib/server/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const result = validateServerConfig();

  if (!result.ok) {
    return Response.json(
      { status: "unhealthy", problems: result.problems },
      { status: 503 },
    );
  }

  return Response.json({ status: "healthy" }, { status: 200 });
}
