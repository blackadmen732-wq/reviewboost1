import "server-only";

import { logger } from "@/lib/server/logger";
import { serviceRoleClient } from "@/lib/server/supabase";

export type Worker = "sms_dispatch" | "maintenance";

/**
 * Record that a scheduled worker ran, and how it ended.
 *
 * A heartbeat that cannot be written is logged and otherwise ignored: the
 * work matters more than the record of it, and a database that cannot take
 * the heartbeat will show up in health on its own.
 */
async function beat(worker: Worker, outcome: "started" | "succeeded" | "failed", reason?: string): Promise<void> {
  try {
    const { error } = await serviceRoleClient().rpc("rpc_worker_heartbeat", {
      p_worker: worker,
      p_outcome: outcome,
      p_error: reason ?? null,
    });
    if (error) logger.warn("worker.heartbeat_failed", { worker, outcome });
  } catch {
    logger.warn("worker.heartbeat_failed", { worker, outcome });
  }
}

/**
 * Run a worker between two heartbeats. `run` returns a short failure reason
 * (an error code, never content) when it partially failed, or null.
 */
export async function withHeartbeat<T>(
  worker: Worker,
  run: () => Promise<{ result: T; failure: string | null }>,
): Promise<T> {
  await beat(worker, "started");
  try {
    const { result, failure } = await run();
    await beat(worker, failure ? "failed" : "succeeded", failure ?? undefined);
    return result;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "exception";
    await beat(worker, "failed", code);
    throw error;
  }
}
