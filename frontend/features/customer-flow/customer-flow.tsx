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
import { CustomerHeroHeader } from "@/features/customer-flow/customer-hero-header";
import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import {
  customerFlowReducer,
} from "@/features/customer-flow/customer-flow-state";
import {
  clearCustomerDraft,
  loadCustomerDraft,
  safeInitialCustomerState,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import {
  getCustomerFlowApi,
} from "@/lib/api/customer-flow-api";
import {
  CustomerApiError,
  isUnavailableReviewLink,
} from "@/lib/api/customer-api-error";
import type {
  SubmitResponseRequest,
} from "@/lib/api/customer-flow-types";
import { createIdempotencyKey } from "@/lib/api/idempotency";
import {
  customerMessages,
  type RatingValue,
} from "@/lib/i18n/customer-messages";
import { type Locale } from "@/lib/i18n/config";
import { requireValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

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
        googleReviewUrl: requireValidatedGoogleReviewUrl(
          context.googleReviewUrl,
        ),
        supportedLocales: normalizedContextLocales(context.supportedLocales),
      };
    },
    retry: (failureCount, error) =>
      !isUnavailableReviewLink(error) && failureCount < 1,
  });

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

  const submitAndRedirect = useCallback(async (rating: RatingValue) => {
    if (feedbackInFlight.current) return;

    const googleReviewUrl = contextQuery.data?.googleReviewUrl;
    if (!googleReviewUrl) return;

    const sessionKey = state.sessionKey ?? createIdempotencyKey("session");
    const responseKey = state.responseKey ?? createIdempotencyKey("response");
    dispatch({ type: "feedback-started", sessionKey, responseKey });

    if (!navigator.onLine) {
      dispatch({ type: "feedback-offline" });
      return;
    }

    feedbackInFlight.current = true;
    try {
      await feedbackMutation.mutateAsync({
        rating,
        locale: state.locale,
        sessionId: state.sessionId,
        sessionKey,
        responseKey,
      });
      dispatch({ type: "feedback-succeeded" });
      clearCustomerDraft(token);
      window.location.assign(googleReviewUrl);
    } catch (error) {
      dispatch({
        type: isOfflineError(error) ? "feedback-offline" : "feedback-failed",
      });
    } finally {
      feedbackInFlight.current = false;
    }
  }, [
    contextQuery.data?.googleReviewUrl,
    feedbackMutation,
    state.locale,
    state.responseKey,
    state.sessionId,
    state.sessionKey,
    token,
  ]);

  const handleRatingChange = useCallback((rating: RatingValue) => {
    dispatch({ type: "select-rating", rating });
    void submitAndRedirect(rating);
  }, [submitAndRedirect]);

  useEffect(() => {
    function retryWhenOnline() {
      if (state.feedbackStatus === "offline" && state.rating) {
        void submitAndRedirect(state.rating);
      }
    }

    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [state.feedbackStatus, state.rating, submitAndRedirect]);

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
  const hasHero = Boolean(context.presentation?.heroUrl);

  return (
    <CustomerFrame poweredBy={messages.poweredBy} hasHero={hasHero}>
      {hasHero ? (
        <CustomerHeroHeader context={context} />
      ) : null}
      <CustomerHeader
        context={context}
        locale={state.locale}
        messages={messages}
        onLocaleChange={changeLocale}
        hideIdentity={hasHero}
      />
      <div ref={contentRef}>
        <LazyMotion features={domAnimation} strict>
          <m.div key={state.screen} {...motionProps}>
            <RatingScreen
              messages={messages}
              rating={state.rating}
              status={state.feedbackStatus}
              onRatingChange={handleRatingChange}
              onRetry={() => {
                if (state.rating) void submitAndRedirect(state.rating);
              }}
            />
          </m.div>
        </LazyMotion>
      </div>
    </CustomerFrame>
  );
}
