import createClient from "openapi-fetch";

import type { CustomerFlowApi } from "@/lib/api/customer-flow-api";
import {
  CustomerApiError,
  networkCustomerApiError,
  toCustomerApiError,
} from "@/lib/api/customer-api-error";
import type { paths } from "@/lib/api/generated/customer-flow";

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
const baseUrl =
  configuredBaseUrl ||
  (typeof window === "undefined" ? "http://localhost" : window.location.origin);

const client = createClient<paths>({
  baseUrl,
  credentials: "include",
  fetch: (request) => globalThis.fetch(request),
  headers: {
    Accept: "application/json",
  },
});

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CustomerApiError) {
      throw error;
    }
    throw networkCustomerApiError(error);
  }
}

function rejectUnexpectedSuccess(response: Response): never {
  const code = response.status === 202 ? "operation_not_terminal" : "unexpected_success_status";
  throw new CustomerApiError({
    status: response.status,
    code,
    message:
      response.status === 202
        ? "The backend returned 202 without a status contract."
        : `Unexpected successful status ${response.status}.`,
  });
}

export const productionCustomerFlowApi: CustomerFlowApi = {
  getContext(token, options) {
    return safely(async () => {
      const result = await client.GET("/api/v1/public/q/{token}", {
        params: { path: { token } },
        ...(options?.signal ? { signal: options.signal } : {}),
      });

      if (result.response.status === 200 && result.data) {
        return result.data;
      }
      if (result.response.ok) {
        rejectUnexpectedSuccess(result.response);
      }
      throw toCustomerApiError(result.response, result.error);
    });
  },

  createSession(token, body, options) {
    return safely(async () => {
      const result = await client.POST("/api/v1/public/q/{token}/sessions", {
        params: {
          path: { token },
          header: { "Idempotency-Key": options.idempotencyKey },
        },
        body,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if ((result.response.status === 200 || result.response.status === 201) && result.data) {
        return result.data;
      }
      if (result.response.ok) {
        rejectUnexpectedSuccess(result.response);
      }
      throw toCustomerApiError(result.response, result.error);
    });
  },

  submitResponse(token, body, options) {
    return safely(async () => {
      const result = await client.POST("/api/v1/public/q/{token}/responses", {
        params: {
          path: { token },
          header: { "Idempotency-Key": options.idempotencyKey },
        },
        body,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if ((result.response.status === 200 || result.response.status === 201) && result.data) {
        return result.data;
      }
      if (result.response.ok) {
        rejectUnexpectedSuccess(result.response);
      }
      throw toCustomerApiError(result.response, result.error);
    });
  },

  recordGoogleClick(token, body, options) {
    return safely(async () => {
      const result = await client.POST("/api/v1/public/q/{token}/google-click", {
        params: {
          path: { token },
          header: { "Idempotency-Key": options.idempotencyKey },
        },
        body,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if (result.response.status === 204) {
        return;
      }
      if (result.response.ok) {
        rejectUnexpectedSuccess(result.response);
      }
      throw toCustomerApiError(result.response, result.error);
    });
  },

  submitTeamPraise(token, body, options) {
    return safely(async () => {
      const result = await client.POST("/api/v1/public/q/{token}/team-praise", {
        params: {
          path: { token },
          header: { "Idempotency-Key": options.idempotencyKey },
        },
        body,
        ...(options.signal ? { signal: options.signal } : {}),
      });

      if ((result.response.status === 200 || result.response.status === 201) && result.data) {
        return result.data;
      }
      if (result.response.ok) {
        rejectUnexpectedSuccess(result.response);
      }
      throw toCustomerApiError(result.response, result.error);
    });
  },
};
