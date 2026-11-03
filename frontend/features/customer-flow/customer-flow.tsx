"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { LanguageSelector } from "@/features/customer-flow/language-selector";
import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import {
  customerFlowReducer,
  type CustomerFlowState,
} from "@/features/customer-flow/customer-flow-state";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import { clearEarlyTapMarker, readEarlyTapMarker } from "@/features/customer-flow/early-tap";
import {
  loadCustomerDraft,
  safeInitialCustomerState,
  saveCustomerDraft,
} from "@/features/customer-flow/recovery-storage";
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
import type {
  CustomerReviewContext,
  SubmitResponseRequest,
} from "@/lib/api/customer-flow-types";
import { createIdempotencyKey } from "@/lib/api/idempotency";
import {
  customerMessages,
  type RatingValue,
} from "@/lib/i18n/customer-messages";
import { type Locale } from "@/lib/i18n/config";
import { requireValidatedDestination } from "@/lib/security/destination";

interface CustomerFlowProps {
  token: string;
  /** Read on the server, so the page is complete in its first response. */
  initialContext?: CustomerReviewContext | null;
  /** The server already knows this link is not active. */
  initialUnavailable?: boolean;
  /**
   * The form a star submits natively before React is ready (early-tap.ts).
   * Absent when there is no server context, such as development fixtures.
   */
  earlyForm?: { action: string; key: string } | null;
  /** An early submit that failed: the star stays chosen, with Try again. */
  failedRating?: RatingValue | null;
}

interface FeedbackAttempt {
  rating: RatingValue;
  sessionId: string | null;
  sessionKey: string;
  /** The language the session was (or will be) started in, not the page's now. */
  sessionLocale: Locale;
  responseKey: string;
}

const noSubscription = () => () => {};

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

/** The one place a context becomes safe to render, from the server or the API alike. */
function prepareContext(context: CustomerReviewContext) {
  return {
    ...context,
    // Re-validated here, not trusted: this is the value the page is about
    // to send a customer to.
    destination: requireValidatedDestination(context.destination),
    supportedLocales: normalizedContextLocales(context.supportedLocales),
  };
}

function preparedOrNull(context: CustomerReviewContext | null | undefined) {
  if (!context) return undefined;
  try {
    return prepareContext(context);
  } catch {
    // A destination that does not validate: let the browser ask the API, and
    // show whatever that answer is, exactly as before.
    return undefined;
  }
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
export function CustomerFlow({
  token,
  initialContext = null,
  initialUnavailable = false,
  earlyForm = null,
  failedRating = null,
}: CustomerFlowProps) {
  const [initialData] = useState(() => preparedOrNull(initialContext));
  const [state, dispatch] = useReducer(customerFlowReducer, undefined, () => {
    const start = safeInitialCustomerState();
    // Open in the business's own language, so a Spanish page never flashes
    // English first. A recovered draft still wins, below.
    const locale = initialData?.supportedLocales.includes(initialData.defaultLocale)
      ? initialData.defaultLocale
      : start.locale;
    return failedRating
      ? { ...start, locale, rating: failedRating, feedbackStatus: "error" as const }
      : { ...start, locale };
  });
  // This tab already rated through the early form (the back button brought
  // the customer here): show the handoff, never a second rating form. Read in
  // the browser only; the server and the first browser pass say "not yet".
  const earlyDone = useSyncExternalStore(
    noSubscription,
    () =>
      !failedRating &&
      (Boolean(window.__rbEarly) || readEarlyTapMarker(window.location.pathname)),
    () => false,
  );
  const [recoveryReady, setRecoveryReady] = useState(false);
  const hadRecoveredDraft = useRef(false);
  const localeChosen = useRef(false);
  const feedbackInFlight = useRef(false);
  const destinationInFlight = useRef(false);
  const handoffPending = useRef(false);
  /** The session started as the page opened, while it is on its way. */
  const openingSession = useRef<Promise<string | null> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messages = customerMessages[state.locale];

  const contextQuery = useQuery({
    queryKey: ["public-review-context", token],
    networkMode: "always",
    queryFn: async ({ signal }) => {
      const api = await getCustomerFlowApi();
      return prepareContext(await api.getContext(token, { signal }));
    },
    // What the server rendered is what the customer is looking at; reading it
    // again would only race the tap.
    initialData,
    staleTime: Infinity,
    enabled: !initialUnavailable,
    retry: (failureCount, error) =>
      !isUnavailableReviewLink(error) && failureCount < 1,
  });

  // React owns the stars from here; the early-tap script steps aside.
  useEffect(() => {
    window.__rbFlowReady = true;
    // The submit that marker stood for failed; this tab may rate again.
    if (failedRating) clearEarlyTapMarker(window.location.pathname);
  }, [failedRating]);

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

  /*
   * The session starts the moment the page opens, not at the star.
   *
   * Two reasons, both about the person at the counter. The star then has one
   * thing left to do, save the rating, so the trip to Google is one round
   * trip shorter. And an open is what "how many people tapped your Tag"
   * counts: a page that waited for the star could only count ratings.
   *
   * Only for someone looking at the rating screen: not a tab that already
   * rated (back from Google), not a prerendered or background tab (it starts
   * when it is shown), and not while the early form is already submitting.
   * A failure here costs nothing: the star starts the session itself, with the
   * same key, exactly as it did before.
   */
  const canOpenSession =
    recoveryReady &&
    Boolean(contextQuery.data) &&
    !earlyDone &&
    state.screen === "rating" &&
    state.sessionId === null;
  const { sessionKey: openKey, sessionLocale: openLocale, locale: pageLocale } = state;
  useEffect(() => {
    if (!canOpenSession) return undefined;
    function open() {
      if (openingSession.current || window.__rbEarly) return;
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const sessionKey = openKey ?? createIdempotencyKey("session");
      const sessionLocale = openLocale ?? pageLocale;
      dispatch({ type: "session-opening", sessionKey, sessionLocale });
      openingSession.current = getCustomerFlowApi()
        .then((api) =>
          api.createSession(token, { locale: sessionLocale }, { idempotencyKey: sessionKey }),
        )
        .then((session) => {
          dispatch({ type: "session-ready", sessionId: session.sessionId });
          return session.sessionId;
        })
        .catch(() => {
          openingSession.current = null;
          return null;
        });
    }
    open();
    document.addEventListener("visibilitychange", open);
    return () => document.removeEventListener("visibilitychange", open);
  }, [canOpenSession, openKey, openLocale, pageLocale, token]);

  const feedbackMutation = useMutation({
    networkMode: "always",
    mutationFn: async (attempt: FeedbackAttempt) => {
      const api = await getCustomerFlowApi();
      // A star tapped while the opening session is still on its way waits for
      // it rather than starting a second one.
      let sessionId =
        attempt.sessionId ?? (openingSession.current ? await openingSession.current : null);

      if (!sessionId) {
        const session = await api.createSession(
          token,
          { locale: attempt.sessionLocale },
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
      const sessionLocale = previous.sessionLocale ?? previous.locale;
      const responseKey = previous.responseKey ?? createIdempotencyKey("response");
      dispatch({ type: "feedback-started", sessionKey, sessionLocale, responseKey });

      if (!navigator.onLine) {
        dispatch({ type: "feedback-offline" });
        return;
      }

      feedbackInFlight.current = true;
      try {
        const result = await feedbackMutation.mutateAsync({
          rating,
          sessionId: previous.sessionId,
          sessionKey,
          sessionLocale,
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
      // Already on its way through the early form: one tap is one rating.
      if (window.__rbEarly || earlyDone) return;
      dispatch({ type: "select-rating", rating });
      void submitFeedback(rating, { ...state, responseKey: null });
    },
    [earlyDone, state, submitFeedback],
  );

  const handleRetry = useCallback(() => {
    if (state.rating) void submitFeedback(state.rating, state);
  }, [state, submitFeedback]);

  // A selection that was never recorded is retried as soon as we know about
  // it, not only when the browser announces it came back online. The common
  // case is a tab that was closed mid-handoff while perfectly online: waiting
  // for an `online` event there means waiting forever, and the business's
  // count of customers it handed to Google is quietly short.
  const { destinationPending, destinationKey, sessionId, responseId } = state;
  useEffect(() => {
    if (!destinationPending || !destinationKey || !sessionId || !responseId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    void getCustomerFlowApi().then((api) =>
      recordDestination(api, destinationKey, sessionId, responseId),
    );
  }, [destinationPending, destinationKey, sessionId, responseId, recordDestination]);

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

  if (contextQuery.isPending && !initialUnavailable) {
    return <CustomerLoading messages={messages} />;
  }

  if (initialUnavailable || contextQuery.isError) {
    return (
      <div ref={contentRef}>
        <CustomerBlockingState
          kind={
            initialUnavailable || isUnavailableReviewLink(contextQuery.error)
              ? "unavailable"
              : isOfflineError(contextQuery.error)
                ? "offline"
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
  if (!context) return <CustomerLoading messages={messages} />;
  const screen = earlyDone ? "handoff" : state.screen;

  return (
    <div ref={contentRef} className="customer-live">
      <CustomerVisitView
        heroUrl={context.page?.heroUrl ?? null}
        businessName={context.business.name}
        // One deterministic crop, shared by the owner preview and this page.
        // Main's Customer Page contract stores no per-owner hero transform, and
        // a preview-only control that the customer never sees would be a lie
        // about what the business published.
        transform={DEFAULT_HERO_TRANSFORM}
        heading={screen === "rating" ? messages.ratingHeading : ""}
        support={screen === "rating" ? messages.ratingSupport : ""}
        footerLine={messages.footerPromise}
        language={
          <LanguageSelector
            locale={state.locale}
            supported={context.supportedLocales}
            messages={messages}
            onChange={changeLocale}
          />
        }
      >
        {/* A plain CSS fade between screens (customer-flow.css). It replaced
            the motion library, ~27 KB compressed for this one effect on the
            page that has to load fastest. */}
        <div key={screen} className="customer-screen-enter">
            {screen === "rating" ? (
              earlyForm ? (
                // A real form, so a star works before the JavaScript has
                // loaded (early-tap.ts). Once React is here it handles every
                // tap itself, and this never submits.
                <form
                  method="post"
                  action={earlyForm.action}
                  data-early-submit=""
                  onSubmit={(event) => event.preventDefault()}
                >
                  <input type="hidden" name="key" value={earlyForm.key} />
                  <input type="hidden" name="locale" value={state.locale} />
                  <RatingScreen
                    messages={messages}
                    rating={state.rating}
                    status={state.feedbackStatus}
                    embedInVisit
                    onRate={handleRate}
                    onRetry={handleRetry}
                  />
                </form>
              ) : (
                <RatingScreen
                  messages={messages}
                  rating={state.rating}
                  status={state.feedbackStatus}
                  embedInVisit
                  onRate={handleRate}
                  onRetry={handleRetry}
                />
              )
            ) : (
              <HandoffScreen
                businessName={context.business.name}
                destinationUrl={context.destination.url}
                messages={messages}
              />
            )}
        </div>
      </CustomerVisitView>
    </div>
  );
}
