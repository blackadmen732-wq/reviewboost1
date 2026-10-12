import "server-only";

import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { logger } from "@/lib/server/logger";

/**
 * Turn a definer function's refusal into the owner-facing error. The database
 * raises fixed words; everything else is a fault, logged and reported opaquely.
 */
export function mapIntegrationRpcError(error: { message?: string } | null, requestId: string): ApiError {
  const msg = error?.message ?? "";
  if (msg.includes("not_found_or_forbidden")) {
    return new ApiError(404, ERROR_CODE.notFound, "That connection was not found.");
  }
  if (msg.includes("connection_exists")) {
    return new ApiError(409, ERROR_CODE.connectionStateInvalid, "This is already connected. Disconnect it first to connect again.");
  }
  if (msg.includes("account_already_connected")) {
    return new ApiError(409, ERROR_CODE.accountAlreadyConnected, "This account is already connected to another ReviewBoost business.");
  }
  if (msg.includes("account_mismatch")) {
    return new ApiError(409, ERROR_CODE.accountMismatch, "You signed in to a different account. Sign in to the one you connected, or disconnect and start again.");
  }
  if (msg.includes("permissions_insufficient")) {
    return new ApiError(409, ERROR_CODE.permissionsInsufficient, "Not every permission was given, so nothing changed.");
  }
  if (msg.includes("oauth_state_invalid")) {
    return new ApiError(400, ERROR_CODE.oauthStateInvalid, "That took too long or was already used. Please start again.");
  }
  if (msg.includes("configuration_invalid")) {
    return new ApiError(400, ERROR_CODE.validationFailed, "Choose at least one place, and each of your places only once.");
  }
  if (msg.includes("configuration_changed") || msg.includes("test_required")) {
    return new ApiError(409, ERROR_CODE.testRequired, "Run the check again first. Your settings changed since the last one.");
  }
  if (msg.includes("connection_state_invalid")) {
    return new ApiError(409, ERROR_CODE.connectionStateInvalid, "That can't be done while the connection is in this state.");
  }
  logger.error("integrations.rpc_error", { requestId, error });
  return new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
}
