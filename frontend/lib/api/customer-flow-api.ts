import type {
  CustomerReviewContext,
  SubmitRatingRequest,
} from "@/lib/api/customer-flow-types";
import { shouldUseCustomerFixtures } from "@/lib/api/fixture-flags";
import { productionCustomerFlowApi } from "@/lib/api/production-customer-flow-api";

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface IdempotentRequestOptions extends RequestOptions {
  idempotencyKey: string;
}

export interface CustomerFlowApi {
  getContext(
    token: string,
    options?: RequestOptions,
  ): Promise<CustomerReviewContext>;
  /**
   * The whole tap in one request: scan, rating and handoff. It starts its
   * network request synchronously, before this returns, and keeps going after
   * the page has navigated away to the review destination.
   */
  submitRating(
    token: string,
    body: SubmitRatingRequest,
    options: IdempotentRequestOptions,
  ): Promise<void>;
}

let developmentApiPromise: Promise<CustomerFlowApi> | undefined;

export async function getCustomerFlowApi(): Promise<CustomerFlowApi> {
  if (process.env.NODE_ENV !== "production" && shouldUseCustomerFixtures()) {
    developmentApiPromise ??= import("@/lib/api/dev/development-customer-flow-api").then(
      ({ developmentCustomerFlowApi }) => developmentCustomerFlowApi,
    );
    return developmentApiPromise;
  }

  return productionCustomerFlowApi;
}
