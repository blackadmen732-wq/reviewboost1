"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { CustomerFrame } from "@/features/customer-flow/customer-frame";
import { CustomerHeader } from "@/features/customer-flow/customer-header";
import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import {
  customerFlowReducer,
  type CustomerFlowState,
} from "@/features/customer-flow/customer-flow-state";
import {
  clearCustomerDraft,
  loadCustomerDraft,
  safeInitialCustomerState,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
import { FinishedScreen } from "@/features/customer-flow/screens/finished-screen";
import { GoogleOpportunity } from "@/features/customer-flow/screens/google-opportunity";
import { RatingScreen } from "@/features/customer-flow/screens/rating-screen";
import { TeamPraiseScreen } from "@/features/customer-flow/screens/team-praise-screen";
import {
  getCustomerFlowApi,
  type CustomerFlowApi,
} from "@/lib/api/customer-flow-api";
import { CustomerApiError, isUnavailableReviewLink } from "@/lib/api/customer-api-error";
import type {
  SubmitResponseRequest,
  TeamPraiseRequest,
} from "@/lib/api/customer-flow-types";
import { createIdempotencyKey } from "@/lib/api/idempotency";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { type Locale } from "@/lib/i18n/config";
import { requireValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

interface CustomerFlowProps {
  token: string;
}

interface FeedbackAttempt {
  rating: RatingValue;
  note: string;
  locale: Locale;
  sessionId: string | null;
  sessionKey: string;
  responseKey: string;
}

interface PraiseAttempt {
  firstName: string;
  note: string;
  sessionId: string;
  responseId: string;
  idempotencyKey: string;
}

function isOfflineError(error: unknown): boolean {
  return (
    (error instanceof CustomerApiError && error.code === "network_error") ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  );
}

function normalizedContextLocales(locales: readonly string[]): Locale[] {
  const supported = locales.filter(
    (locale): locale is Locale => locale === "en" || locale === "es" || locale === "ht",
  );
  return supported.length ? supported : ["en"];
}

export function CustomerFlow({ token }: CustomerFlowProps) {
  const [state, dispatch] = useReducer(customerFlowReducer, undefined, safeInitialCustomerState);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const hadRecoveredDraft = useRef(false);
  const localeChosen = useRef(false);
  const feedbackInFlight = useRef(false);
  const praiseInFlight = useRef(false);
  const googleClickInFlight = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const messages = customerMessages[state.locale];

  const contextQuery = useQuery({
    queryKey: ["public-review-context", token],
    queryFn: async ({ signal }) => {
      const api = await getCustomerFlowApi();
      const context = await api.getContext(token, { signal });
      return {
        ...context,
        googleReviewUrl: requireValidatedGoogleReviewUrl(context.googleReviewUrl),
        supportedLocales: normalizedContextLocales(context.supportedLocales),
      };
    },
    retry: (failureCount, error) => !isUnavailableReviewLink(error) && failureCount < 1,
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
    if (!contextQuery.data || !recoveryReady || hadRecoveredDraft.current || localeChosen.current) {
      return;
    }
    const defaultLocale = contextQuery.data.supportedLocales.includes(contextQuery.data.defaultLocale)
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
      const heading = contentRef.current?.querySelector<HTMLElement>("[data-screen-heading]") ??
        document.querySelector<HTMLElement>("[data-screen-heading]");
      heading?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [contextQuery.isPending, contextQuery.status, state.screen]);

  const feedbackMutation = useMutation({
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

      const trimmedNote = attempt.note.trim();
      const body: SubmitResponseRequest = {
        sessionId,
        rating: attempt.rating,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      };
      const response = await api.submitResponse(token, body, {
        idempotencyKey: attempt.responseKey,
      });
      return { sessionId, responseId: response.responseId };
    },
  });

  const submitFeedback = useCallback(async () => {
    if (!state.rating || feedbackInFlight.current) return;

    const sessionKey = state.sessionKey ?? createIdempotencyKey("session");
    const responseKey = state.responseKey ?? createIdempotencyKey("response");
    dispatch({ type: "feedback-started", sessionKey, responseKey });

    if (!navigator.onLine) {
      dispatch({ type: "feedback-offline" });
      return;
    }

    feedbackInFlight.current = true;
    try {
      const result = await feedbackMutation.mutateAsync({
        rating: state.rating,
        note: state.note,
        locale: state.locale,
        sessionId: state.sessionId,
        sessionKey,
        responseKey,
      });
      dispatch({
        type: "feedback-succeeded",
        sessionId: result.sessionId,
        responseId: result.responseId,
      });
    } catch (error) {
      dispatch({ type: isOfflineError(error) ? "feedback-offline" : "feedback-failed" });
    } finally {
      feedbackInFlight.current = false;
    }
  }, [feedbackMutation, state.locale, state.note, state.rating, state.responseKey, state.sessionId, state.sessionKey]);

  const praiseMutation = useMutation({
    mutationFn: async (attempt: PraiseAttempt) => {
      const api = await getCustomerFlowApi();
      const trimmedNote = attempt.note.trim();
      const body: TeamPraiseRequest = {
        sessionId: attempt.sessionId,
        responseId: attempt.responseId,
        firstName: attempt.firstName.trim(),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      };
      return api.submitTeamPraise(token, body, { idempotencyKey: attempt.idempotencyKey });
    },
  });

  const submitPraise = useCallback(
    async (firstName = state.praiseFirstName, note = state.praiseNote) => {
      if (!state.sessionId || !state.responseId || praiseInFlight.current) return;

      const idempotencyKey = state.praiseKey ?? createIdempotencyKey("team-praise");
      dispatch({ type: "change-praise", firstName, note });
      dispatch({ type: "praise-started", idempotencyKey });

      if (!navigator.onLine) {
        dispatch({ type: "praise-offline" });
        return;
      }

      praiseInFlight.current = true;
      try {
        await praiseMutation.mutateAsync({
          firstName,
          note,
          sessionId: state.sessionId,
          responseId: state.responseId,
          idempotencyKey,
        });
        dispatch({ type: "finish" });
        clearCustomerDraft(token);
      } catch (error) {
        dispatch({ type: isOfflineError(error) ? "praise-offline" : "praise-failed" });
      } finally {
        praiseInFlight.current = false;
      }
    },
    [praiseMutation, state.praiseFirstName, state.praiseKey, state.praiseNote, state.responseId, state.sessionId, token],
  );

  const recordGoogleClick = useCallback(
    async (api: CustomerFlowApi, idempotencyKey: string, snapshot: CustomerFlowState) => {
      if (!snapshot.sessionId || !snapshot.responseId || googleClickInFlight.current) return;
      googleClickInFlight.current = true;
      try {
        await api.recordGoogleClick(
          token,
          { sessionId: snapshot.sessionId, responseId: snapshot.responseId },
          { idempotencyKey },
        );
        dispatch({ type: "google-click-recorded" });
      } catch {
        // Tracking must never block or change the public Google opportunity.
        // The pending key remains in same-tab recovery and retries on reconnect.
      } finally {
        googleClickInFlight.current = false;
      }
    },
    [token],
  );

  const handleGoogleAction = useCallback(() => {
    if (!state.sessionId || !state.responseId) return;
    const idempotencyKey = state.googleClickKey ?? createIdempotencyKey("google-click");
    dispatch({ type: "google-click-started", idempotencyKey });
    void getCustomerFlowApi().then((api) => recordGoogleClick(api, idempotencyKey, state));
  }, [recordGoogleClick, state]);

  useEffect(() => {
    function retryWhenOnline() {
      if (state.feedbackStatus === "offline") void submitFeedback();
      if (state.praiseStatus === "offline") void submitPraise();
      if (state.googleClickPending && state.googleClickKey) {
        void getCustomerFlowApi().then((api) =>
          recordGoogleClick(api, state.googleClickKey as string, state),
        );
      }
    }

    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [recordGoogleClick, state, submitFeedback, submitPraise]);

  useEffect(() => {
    if (
      recoveryReady &&
      navigator.onLine &&
      state.googleClickPending &&
      state.googleClickKey &&
      state.screen === "praise"
    ) {
      void getCustomerFlowApi().then((api) =>
        recordGoogleClick(api, state.googleClickKey as string, state),
      );
    }
  }, [recordGoogleClick, recoveryReady, state]);

  const changeLocale = useCallback((locale: Locale) => {
    localeChosen.current = true;
    dispatch({ type: "change-locale", locale });
  }, []);

  const motionProps = useMemo(
    () => ({
      initial: { opacity: 0, y: prefersReducedMotion ? 0 : 6 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: prefersReducedMotion ? 0.1 : 0.22, ease: "easeOut" as const },
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
          kind={isUnavailableReviewLink(contextQuery.error) ? "unavailable" : "error"}
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
        <LazyMotion features={domAnimation} strict>
          <m.div key={state.screen} {...motionProps}>
            {state.screen === "rating" ? (
              <RatingScreen
                businessName={context.business.name}
                messages={messages}
                rating={state.rating}
                note={state.note}
                status={state.feedbackStatus}
                onRatingChange={(rating) => dispatch({ type: "select-rating", rating })}
                onNoteChange={(note) => dispatch({ type: "change-note", note })}
                onSubmit={() => void submitFeedback()}
              />
            ) : null}
            {state.screen === "google" ? (
              <GoogleOpportunity
                businessName={context.business.name}
                googleReviewUrl={context.googleReviewUrl}
                messages={messages}
                onGoogleAction={handleGoogleAction}
                onContinue={() => dispatch({ type: "show-praise" })}
              />
            ) : null}
            {state.screen === "praise" ? (
              <TeamPraiseScreen
                businessName={context.business.name}
                messages={messages}
                firstName={state.praiseFirstName}
                note={state.praiseNote}
                status={state.praiseStatus}
                onDraftChange={(firstName, note) =>
                  dispatch({ type: "change-praise", firstName, note })
                }
                onSubmit={(firstName, note) => void submitPraise(firstName, note)}
                onSkip={() => {
                  dispatch({ type: "finish" });
                  clearCustomerDraft(token);
                }}
              />
            ) : null}
            {state.screen === "finished" ? <FinishedScreen messages={messages} /> : null}
          </m.div>
        </LazyMotion>
      </div>
    </CustomerFrame>
  );
}
