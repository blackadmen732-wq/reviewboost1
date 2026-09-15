"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { CustomerHeader } from "@/features/customer-flow/customer-header";
import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import {
  customerFlowReducer,
  type CustomerFlowState,
} from "@/features/customer-flow/customer-flow-state";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import {
  loadCustomerDraft,
  safeInitialCustomerState,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
import { CustomerPageBranding } from "@/features/customer-flow/customer-page-branding";
import { HandoffScreen } from "@/features/customer-flow/screens/handoff-screen";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import {
  getCustomerFlowApi,
  type CustomerFlowApi,
} from "@/lib/api/customer-flow-api";
import {
  CustomerApiError,
  isUnavailableReviewLink,
} from "@/lib/api/customer-api-error";
import type { SubmitResponseRequest } from "@/lib/api/customer-flow-types";
import { createIdempotencyKey } from "@/lib/api/idempotency";
import {
  customerMessages,
  type RatingValue,
} from "@/lib/i18n/customer-messages";
import { type Locale } from "@/lib/i18n/config";
import { requireValidatedDestination } from "@/lib/security/destination";

interface CustomerFlowProps {
  token: string;
}

interface FeedbackAttempt {
  rating: RatingValue;
  locale: Locale;
  sessionId: string | null;
  sessionKey: string;
  responseKey: string;
}

function isOfflineError(error: unknown): boolean {
  return (
    (error instanceof CustomerApiError && error.code === "network_error") ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  );
}

function normalizedContextLocales(locales: readonly string[]): Locale[] {
  const supported = locales.filter(
    (locale): locale is Locale =>
      locale === "en" || locale === "es" || locale === "ht",
  );
  return supported.length ? supported : ["en"];
}

/**
 * THE V1 CUSTOMER CONTRACT
 * ------------------------
 * Scan or tap → choose a star → the rating is saved → the public review
 * destination opens. That is the whole flow, and it is the same flow for a one
 * and for a five: the destination comes from `getContext`, which runs before a
 * rating exists and is never re-fetched with one, so it is structurally unable
 * to vary by rating.
 *
 * There is no note, no Team Praise, no optional destination screen, and no
 * confirm button. Anything added between the star and the destination is a
 * change to the product, not a change to this component.
 */
export function CustomerFlow({ token }: CustomerFlowProps) {
  const [state, dispatch] = useReducer(
    customerFlowReducer,
    undefined,
    safeInitialCustomerState,
  );
  const [recoveryReady, setRecoveryReady] = useState(false);
  const hadRecoveredDraft = useRef(false);
  const localeChosen = useRef(false);
  const feedbackInFlight = useRef(false);
  const destinationInFlight = useRef(false);
  const handoffPending = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const messages = customerMessages[state.locale];

  const contextQuery = useQuery({
    queryKey: ["public-review-context", token],
    networkMode: "always",
    queryFn: async ({ signal }) => {
      const api = await getCustomerFlowApi();
      const context = await api.getContext(token, { signal });
      return {
        ...context,
        // Re-validated here, not trusted: this is the value the page is about
        // to send a customer to.
        destination: requireValidatedDestination(context.destination),
        supportedLocales: normalizedContextLocales(context.supportedLocales),
      };
    },
    retry: (failureCount, error) =>
      !isUnavailableReviewLink(error) && failureCount < 1,
  });

  const destinationUrl = contextQuery.data?.destination.url ?? null;

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const recovered = loadCustomerDraft(token);
      if (recovered) {
        hadRecoveredDraft.current = true;
        dispatch({ type: "restore", state: recovered });
      }
      setRecoveryReady(true);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [token]);

  useEffect(() => {
    if (
      !contextQuery.data ||
      !recoveryReady ||
      hadRecoveredDraft.current ||
      localeChosen.current
    ) {
      return;
    }
    const defaultLocale = contextQuery.data.supportedLocales.includes(
      contextQuery.data.defaultLocale,
    )
      ? contextQuery.data.defaultLocale
      : contextQuery.data.supportedLocales[0];
    if (defaultLocale && defaultLocale !== state.locale) {
      dispatch({ type: "change-locale", locale: defaultLocale });
    }
  }, [contextQuery.data, recoveryReady, state.locale]);

  useEffect(() => {
    if (recoveryReady) saveCustomerDraft(token, state);
  }, [recoveryReady, state, token]);

  useEffect(() => {
    document.documentElement.lang = state.locale;
    document.documentElement.dir = "ltr";
  }, [state.locale]);

  useEffect(() => {
    if (contextQuery.isPending) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const heading =
        contentRef.current?.querySelector<HTMLElement>(
          "[data-screen-heading]",
        ) ?? document.querySelector<HTMLElement>("[data-screen-heading]");
      heading?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [contextQuery.isPending, contextQuery.status, state.screen]);

  const feedbackMutation = useMutation({
    networkMode: "always",
    mutationFn: async (attempt: FeedbackAttempt) => {
      const api = await getCustomerFlowApi();
      let sessionId = attempt.sessionId;

      if (!sessionId) {
        const session = await api.createSession(
          token,
          { locale: attempt.locale },
          { idempotencyKey: attempt.sessionKey },
        );
        sessionId = session.sessionId;
        dispatch({ type: "session-ready", sessionId });
      }

      const body: SubmitResponseRequest = {
        sessionId,
        rating: attempt.rating,
      };
      const response = await api.submitResponse(token, body, {
        idempotencyKey: attempt.responseKey,
      });
      return { sessionId, responseId: response.responseId };
    },
  });

  /**
   * Record that the customer was handed to the public review destination.
   *
   * That is the entire claim: ReviewBoost cannot observe whether a review was
   * written. It never blocks the handoff — a tracking failure must not stand
   * between a customer and the review page — so failures are swallowed and the
   * pending key is retried if the tab is still open when connectivity returns.
   */
  const recordDestination = useCallback(
    async (
      api: CustomerFlowApi,
      idempotencyKey: string,
      sessionId: string,
      responseId: string,
    ) => {
      if (destinationInFlight.current) return;
      destinationInFlight.current = true;
      try {
        await api.recordDestinationSelection(
          token,
          { sessionId, responseId },
          { idempotencyKey },
        );
        dispatch({ type: "destination-recorded" });
      } catch {
        // Deliberately silent. See above.
      } finally {
        destinationInFlight.current = false;
      }
    },
    [token],
  );

  const submitFeedback = useCallback(
    async (rating: RatingValue, previous: CustomerFlowState) => {
      if (feedbackInFlight.current) return;

      const sessionKey = previous.sessionKey ?? createIdempotencyKey("session");
      const responseKey = previous.responseKey ?? createIdempotencyKey("response");
      dispatch({ type: "feedback-started", sessionKey, responseKey });

      if (!navigator.onLine) {
        dispatch({ type: "feedback-offline" });
        return;
      }

      feedbackInFlight.current = true;
      try {
        const result = await feedbackMutation.mutateAsync({
          rating,
          locale: previous.locale,
          sessionId: previous.sessionId,
          sessionKey,
          responseKey,
        });
        const destinationKey =
          previous.destinationKey ?? createIdempotencyKey("destination");
        dispatch({
          type: "feedback-succeeded",
          sessionId: result.sessionId,
          responseId: result.responseId,
          destinationKey,
        });

        // Start the tracking write and leave. Awaiting it would put a customer
        // behind a database round trip for a number nobody is waiting on. The
        // navigation itself is left to the effect below, so the handoff has
        // rendered before the browser starts leaving — a customer whose
        // browser refuses the navigation is still looking at a finished page
        // with a working link, not at a rating form.
        void getCustomerFlowApi().then((api) =>
          recordDestination(
            api,
            destinationKey,
            result.sessionId,
            result.responseId,
          ),
        );
        handoffPending.current = true;
      } catch (error) {
        dispatch({
          type: isOfflineError(error) ? "feedback-offline" : "feedback-failed",
        });
      } finally {
        feedbackInFlight.current = false;
      }
    },
    [feedbackMutation, recordDestination],
  );

  // Only a submit that just succeeded arms this. A handoff state recovered
  // from storage — a customer who pressed back — renders the same screen and
  // stays put, so the back button can never bounce anyone out again.
  useEffect(() => {
    if (state.screen !== "handoff" || !handoffPending.current || !destinationUrl) {
      return;
    }
    handoffPending.current = false;
    navigateToDestination(destinationUrl);
  }, [destinationUrl, state.screen]);

  const handleRate = useCallback(
    (rating: RatingValue) => {
      dispatch({ type: "select-rating", rating });
      void submitFeedback(rating, { ...state, responseKey: null });
    },
    [state, submitFeedback],
  );

  const handleRetry = useCallback(() => {
    if (state.rating) void submitFeedback(state.rating, state);
  }, [state, submitFeedback]);

  useEffect(() => {
    function retryWhenOnline() {
      if (state.feedbackStatus === "offline" && state.rating) {
        void submitFeedback(state.rating, state);
      }
      if (
        state.destinationPending &&
        state.destinationKey &&
        state.sessionId &&
        state.responseId
      ) {
        const { destinationKey, sessionId, responseId } = state;
        void getCustomerFlowApi().then((api) =>
          recordDestination(api, destinationKey, sessionId, responseId),
        );
      }
    }

    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [recordDestination, state, submitFeedback]);

  const changeLocale = useCallback((locale: Locale) => {
    localeChosen.current = true;
    dispatch({ type: "change-locale", locale });
  }, []);

  const motionProps = useMemo(
    () => ({
      initial: { opacity: 0.96, y: prefersReducedMotion ? 0 : 6 },
      animate: { opacity: 1, y: 0 },
      transition: {
        duration: prefersReducedMotion ? 0.1 : 0.22,
        ease: "easeOut" as const,
      },
    }),
    [prefersReducedMotion],
  );

  if (contextQuery.isPending) {
    return <CustomerLoading messages={messages} />;
  }

  if (contextQuery.isError) {
    return (
      <div ref={contentRef}>
        <CustomerBlockingState
          kind={
            isUnavailableReviewLink(contextQuery.error)
              ? "unavailable"
              : "error"
          }
          locale={state.locale}
          messages={messages}
          onLocaleChange={changeLocale}
          onRetry={() => void contextQuery.refetch()}
        />
      </div>
    );
  }

  const context = contextQuery.data;

  return (
    <CustomerFrame poweredBy={messages.poweredBy}>
      <CustomerHeader
        context={context}
        locale={state.locale}
        messages={messages}
        onLocaleChange={changeLocale}
      />
      <div ref={contentRef}>
        {state.screen === "rating" ? (
          <CustomerPageBranding
            page={context.page}
            businessName={context.business.name}
          />
        ) : null}
        <LazyMotion features={domAnimation} strict>
          <m.div key={state.screen} {...motionProps}>
            {state.screen === "rating" ? (
              <RatingScreen
                messages={messages}
                rating={state.rating}
                status={state.feedbackStatus}
                onRate={handleRate}
                onRetry={handleRetry}
              />
            ) : (
              <HandoffScreen
                businessName={context.business.name}
                destinationUrl={context.destination.url}
                messages={messages}
              />
            )}
          </m.div>
        </LazyMotion>
      </div>
    </CustomerFrame>
  );
}
