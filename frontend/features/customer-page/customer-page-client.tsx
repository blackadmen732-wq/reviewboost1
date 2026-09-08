"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { CustomerPage } from "@/features/customer-page/customer-page";
import { CustomerPageFallback } from "@/features/customer-page/customer-page-fallback";
import type { CustomerPageStatus } from "@/features/customer-page/customer-page-status";
import {
  customerPageReducer,
  type CustomerPageState,
} from "@/features/customer-page/customer-page-state";
import {
  loadCustomerDraft,
  safeInitialCustomerState,
  saveCustomerDraft,
} from "@/features/customer-page/recovery-storage";
import {
  CustomerApiError,
  isUnavailableReviewLink,
} from "@/lib/api/customer-api-error";
import { getCustomerFlowApi } from "@/lib/api/customer-flow-api";
import { createIdempotencyKey } from "@/lib/api/idempotency";
import { emptyCustomerPageDesign } from "@/lib/customer-page/design";
import { presentationFromContext } from "@/lib/customer-page/presentation";
import type { Locale } from "@/lib/i18n/config";
import { customerMessages, type RatingValue } from "@/lib/i18n/customer-messages";
import { requireValidatedGoogleReviewUrl } from "@/lib/security/google-review-url";

/**
 * The live customer page.
 *
 * Owns the one thing the presentational components must never own: the write.
 * A tap paints the stars immediately and then, in the same gesture, saves the
 * rating and opens Google. Nothing branches on the value — one star and five
 * stars take the identical path — because a page that decides who is allowed to
 * reach Google is review gating, and this product does not do that.
 *
 * The ordering matters and is deliberate: paint, save, *then* hand off. Handing
 * off first would be faster and would lose ratings on exactly the connections
 * where feedback matters most, and the private rating is the asset the business
 * is actually paying for.
 */

const slowSaveThresholdMs = 500;

interface CustomerPageClientProps {
  token: string;
}

interface SaveAttempt {
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

export function CustomerPageClient({ token }: CustomerPageClientProps) {
  const [state, dispatch] = useReducer(
    customerPageReducer,
    undefined,
    safeInitialCustomerState,
  );
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [handingOff, setHandingOff] = useState(false);

  /*
   * The callbacks below run outside render — a tap, a timer, an `online` event —
   * and need the state as it is at that moment. Reading it through a ref keeps
   * them from being rebuilt on every state change, which would otherwise swap a
   * handler out from under an interaction that is already in progress.
   */
  const stateRef = useRef<CustomerPageState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const restoredDraft = useRef(false);
  const localeChosen = useRef(false);
  const saveInFlight = useRef(false);
  const clickInFlight = useRef(false);

  const messages = customerMessages[state.locale];

  const contextQuery = useQuery({
    queryKey: ["customer-page-context", token],
    networkMode: "always",
    queryFn: async ({ signal }) => {
      const api = await getCustomerFlowApi();
      const context = await api.getContext(token, { signal });
      return {
        presentation: presentationFromContext(context),
        // Re-validated on the client as well as the server. A Google
        // destination is the one value on this page that sends a customer
        // somewhere, and one validation is a single point of failure.
        googleReviewUrl: requireValidatedGoogleReviewUrl(context.googleReviewUrl),
      };
    },
    retry: (failureCount, error) =>
      !isUnavailableReviewLink(error) && failureCount < 1,
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const recovered = loadCustomerDraft(token);
      if (recovered) {
        restoredDraft.current = true;
        dispatch({ type: "restore", state: recovered });
      }
      setRecoveryReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [token]);

  useEffect(() => {
    if (
      !contextQuery.data ||
      !recoveryReady ||
      restoredDraft.current ||
      localeChosen.current
    ) {
      return;
    }
    const preferred = contextQuery.data.presentation.defaultLanguage;
    if (preferred !== stateRef.current.locale) {
      dispatch({ type: "change-locale", locale: preferred });
    }
  }, [contextQuery.data, recoveryReady]);

  useEffect(() => {
    if (recoveryReady) saveCustomerDraft(token, state);
  }, [recoveryReady, state, token]);

  useEffect(() => {
    document.documentElement.lang = state.locale;
  }, [state.locale]);

  useEffect(() => {
    if (state.phase !== "saving") return;
    const timeout = window.setTimeout(
      () => dispatch({ type: "save-is-slow" }),
      slowSaveThresholdMs,
    );
    return () => window.clearTimeout(timeout);
  }, [state.phase]);

  const saveMutation = useMutation({
    networkMode: "always",
    mutationFn: async (attempt: SaveAttempt) => {
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

      const response = await api.submitResponse(
        token,
        { sessionId, rating: attempt.rating },
        { idempotencyKey: attempt.responseKey },
      );
      return { sessionId, responseId: response.responseId };
    },
  });

  const openGoogle = useCallback(
    (sessionId: string, responseId: string) => {
      const googleReviewUrl = contextQuery.data?.googleReviewUrl;
      if (!googleReviewUrl) return;

      const idempotencyKey =
        stateRef.current.googleClickKey ?? createIdempotencyKey("google-click");
      dispatch({ type: "google-click-started", idempotencyKey });
      setHandingOff(true);

      if (!clickInFlight.current) {
        clickInFlight.current = true;
        void getCustomerFlowApi()
          .then((api) =>
            api.recordGoogleClick(
              token,
              { sessionId, responseId },
              { idempotencyKey },
            ),
          )
          .then(() => dispatch({ type: "google-click-recorded" }))
          .catch(() => {
            // Analytics never changes what the customer gets. The pending key
            // stays in recovery and is retried if they come back.
          })
          .finally(() => {
            clickInFlight.current = false;
          });
      }

      window.location.assign(googleReviewUrl);
    },
    [contextQuery.data?.googleReviewUrl, token],
  );

  const save = useCallback(
    async (rating: RatingValue) => {
      if (saveInFlight.current) return;

      const current = stateRef.current;
      const sessionKey = current.sessionKey ?? createIdempotencyKey("session");
      /*
       * One tap gets one key, however many attempts it takes; a different star
       * gets a new one. Derived from the rating rather than read back from state
       * because a pointer tap fires `click` before `change`, so the reducer has
       * not seen the new star yet at this point.
       */
      const responseKey =
        current.rating === rating && current.responseKey
          ? current.responseKey
          : createIdempotencyKey("response");

      // Paints the stars, and — because it lands before `save-started` in the
      // same batch — cannot undo the save the way a later selection would.
      dispatch({ type: "select-rating", rating });
      dispatch({ type: "save-started", sessionKey, responseKey });

      if (!navigator.onLine) {
        dispatch({ type: "save-offline" });
        return;
      }

      saveInFlight.current = true;
      try {
        const result = await saveMutation.mutateAsync({
          rating,
          locale: current.locale,
          sessionId: current.sessionId,
          sessionKey,
          responseKey,
        });
        dispatch({
          type: "save-succeeded",
          sessionId: result.sessionId,
          responseId: result.responseId,
        });
        openGoogle(result.sessionId, result.responseId);
      } catch (error) {
        dispatch({
          type: isOfflineError(error) ? "save-offline" : "save-failed",
        });
      } finally {
        saveInFlight.current = false;
      }
    },
    [openGoogle, saveMutation],
  );

  const commit = useCallback(
    (rating: RatingValue) => {
      const current = stateRef.current;
      if (current.phase === "saving") return;
      if (current.phase === "saved" && current.rating === rating) {
        // Already recorded, and they tapped the same star again. Send them on
        // rather than writing a second identical rating.
        if (current.sessionId && current.responseId) {
          openGoogle(current.sessionId, current.responseId);
        }
        return;
      }
      void save(rating);
    },
    [openGoogle, save],
  );

  const retry = useCallback(() => {
    const rating = stateRef.current.rating;
    if (rating) void save(rating);
  }, [save]);

  useEffect(() => {
    function retryWhenOnline() {
      if (stateRef.current.phase === "offline") retry();
    }
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [retry]);

  const changeLocale = useCallback((locale: Locale) => {
    localeChosen.current = true;
    dispatch({ type: "change-locale", locale });
  }, []);

  if (contextQuery.isError) {
    return (
      <CustomerPageFallback
        kind={isUnavailableReviewLink(contextQuery.error) ? "unavailable" : "error"}
        messages={messages}
        locale={state.locale}
        onLocaleChange={changeLocale}
        {...(isUnavailableReviewLink(contextQuery.error)
          ? {}
          : { onRetry: () => void contextQuery.refetch() })}
      />
    );
  }

  const presentation = contextQuery.data?.presentation ?? {
    businessName: "",
    locationName: null,
    design: emptyCustomerPageDesign,
    languages: [state.locale],
    defaultLanguage: state.locale,
  };

  const status: CustomerPageStatus = contextQuery.isPending
    ? "loading"
    : handingOff
      ? "opening"
      : state.phase === "failed"
        ? "failed"
        : state.phase === "offline"
          ? "offline"
          : state.phase === "saving"
            ? state.saveIsSlow
              ? "opening"
              : "saving"
            : state.phase === "saved"
              ? "saved"
              : "idle";

  return (
    <CustomerPage
      presentation={presentation}
      messages={messages}
      locale={state.locale}
      rating={state.rating}
      status={status}
      onSelect={(rating) => dispatch({ type: "select-rating", rating })}
      onCommit={commit}
      onRetry={retry}
      onLocaleChange={changeLocale}
    />
  );
}
