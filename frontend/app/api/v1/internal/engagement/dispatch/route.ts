import {
  engagementWorkerAuthorized,
  runEngagementWorker,
} from "@/lib/server/engagement/adaptive-service";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  return handle(
    request,
    "/api/v1/internal/engagement/dispatch",
    async (requestId) => {
      if (!engagementWorkerAuthorized(request))
        throw new ApiError(404, ERROR_CODE.notFound, "Not found.");
      return json(request, requestId, 200, await runEngagementWorker());
    },
  );
}
export async function GET(request: Request) {
  return POST(request);
}
