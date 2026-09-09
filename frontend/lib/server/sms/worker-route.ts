import "server-only";

import type { NextRequest } from "next/server";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
import { authorizeSmsWorker } from "@/lib/server/sms/worker-auth";

/**
 * GET (Vercel Cron) and POST (manual) share one fail-closed gate.
 */
export function smsWorkerRoute(route: string, run: () => Promise<unknown>) {
  return async (request: NextRequest): Promise<Response> =>
    handle(request, route, async (requestId) => {
      if (!authorizeSmsWorker(request)) {
        throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
      }
      const data = await run();
      return json(request, requestId, 200, { data, requestId });
    });
}
