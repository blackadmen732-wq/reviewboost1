import type {
  CreateSessionRequest,
  CreateSessionResponse,
  CustomerReviewContext,
  GoogleClickRequest,
  SubmitResponseRequest,
  SubmitResponseResponse,
  TeamPraiseRequest,
  TeamPraiseResponse,
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
  getContext(token: string, options?: RequestOptions): Promise<CustomerReviewContext>;
  createSession(
    token: string,
    body: CreateSessionRequest,
    options: IdempotentRequestOptions,
  ): Promise<CreateSessionResponse>;
  submitResponse(
    token: string,
    body: SubmitResponseRequest,
    options: IdempotentRequestOptions,
  ): Promise<SubmitResponseResponse>;
  recordGoogleClick(
    token: string,
    body: GoogleClickRequest,
    options: IdempotentRequestOptions,
  ): Promise<void>;
  submitTeamPraise(
    token: string,
    body: TeamPraiseRequest,
    options: IdempotentRequestOptions,
  ): Promise<TeamPraiseResponse>;
}

let developmentApiPromise: Promise<CustomerFlowApi> | undefined;

export async function getCustomerFlowApi(): Promise<CustomerFlowApi> {
  if (!shouldUseCustomerFixtures()) {
    return productionCustomerFlowApi;
  }

  developmentApiPromise ??= import("@/lib/api/dev/development-customer-flow-api").then(
    ({ developmentCustomerFlowApi }) => developmentCustomerFlowApi,
  );
  return developmentApiPromise;
}

