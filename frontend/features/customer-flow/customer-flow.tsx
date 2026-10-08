"use client";

import { useQuery } from "@tanstack/react-query";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { preconnect } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { CustomerBlockingState } from "@/features/customer-flow/customer-blocking-state";
import { LanguageSelector } from "@/features/customer-flow/language-selector";
import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import { CustomerVisitView } from "@/features/customer-page/customer-visit-view";
import { DEFAULT_HERO_TRANSFORM } from "@/lib/owner/hero-transform";
import {
  customerFlowReducer,
  type CustomerFlowState,
  type PendingRating,
} from "@/features/customer-flow/customer-flow-state";
import { navigateToDestination } from "@/features/customer-flow/destination-handoff";
import { handoffOrigins } from "@/features/customer-flow/handoff-origins";
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

/**
 * How long the stars show the tap before a page that is still on screen says
 * it is opening Google. The browser is already navigating; this only decides
 * what a customer on a slow connection looks at meanwhile.
 */
const LEAVING_MS = 320;

/** A refusal the server would give again however often the page re-sent. */
function isFinalRefusal(error: unknown): boolean {
  return (
    error instanceof CustomerApiError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
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
 * Scan or tap → choose a star → the public review destination opens, in that
 * same moment. The rating is sent alongside, in one request that outlives the
 * page (keepalive); nothing waits for it. It is the same flow for a one and
 * for a five: the destination comes from `getContext`, which runs before a
 * rating exists and is never re-fetched with one, so it is structurally unable
 * to vary by rating.
 *
 * There is no note, no Team Praise, no optional destination screen, and no
 * confirm button — and no wait for a save between the star and Google. Until
 * the server confirms the rating, the request is kept in the tab's
 * sessionStorage and re-sent under the same key when the page comes back (the
 * back button, a reload) or the connection does; a tap made offline is held
 * and goes out, with the customer, when the connection returns. Anything added
 * between the star and the destination is a change to the product, not a
 * change to this component.
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
  // This page has started opening the destination. One departure per page:
  // the old document stays interactive until the new one arrives, and a
  // second tap in that window must do nothing.
  const left = useRef(false);
  const sending = useRef(new Set<string>());
  // Resolved with the context, so the tap can start its request synchronously,
  // before the navigation, without waiting on a promise.
  const apiRef = useRef<CustomerFlowApi | null>(null);
  const [returned, setReturned] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const messages = customerMessages[state.locale];

  const contextQuery = useQuery({
    queryKey: ["public-review-context", token],
    networkMode: "always",
    queryFn: async ({ signal }) => {
      const api = await getCustomerFlowApi();
      apiRef.current = api;
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

  // Open the road to Google while the customer reads the question: the name
  // lookup and the secure handshake for the review page's host are finished
  // before the tap, so the handoff starts on a connection that is already
  // open. React adds each hint once, however often this renders.
  if (destinationUrl) {
    for (const origin of handoffOrigins(destinationUrl)) preconnect(origin);
  }

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      const recovered = loadCustomerDraft(token);
      if (recovered) {
        hadRecoveredDraft.current = true;
        dispatch({ type: "restore", state: recovered });
        // Back from the destination: the way there is offered at once.
        if (recovered.screen === "handoff") setReturned(true);
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

  /**
   * Send a tap's rating, at most once at a time per request.
   *
   * The request carries the scan, the rating and the handoff. It is fire and
   * forget from the customer's side — they are on their way — so the only
   * thing listening for the answer is this page, if it is still here or comes
   * back: a confirmed (or permanently refused) request is dropped from the
   * draft; anything else stays to be re-sent with the same key.
   */
  const send = useCallback(
    (pending: PendingRating) => {
      if (sending.current.has(pending.key)) return;
      sending.current.add(pending.key);
      const deliver = (api: CustomerFlowApi) =>
        api
          .submitRating(
            token,
            { rating: pending.rating, locale: pending.locale },
            { idempotencyKey: pending.key },
          )
          .then(() => dispatch({ type: "rating-settled", key: pending.key }))
          .catch((error: unknown) => {
            if (isFinalRefusal(error)) dispatch({ type: "rating-settled", key: pending.key });
          })
          .finally(() => sending.current.delete(pending.key));
      const api = apiRef.current;
      if (api) void deliver(api);
      else void getCustomerFlowApi().then(deliver);
    },
    [token],
  );

  /**
   * Leave for the destination, now. In this order, all in the same tick: keep
   * the draft (so the back button finds the handoff, never a fresh form),
   * start the request, open the destination, then let the stars show the tap.
   */
  const leave = useCallback(
    (pending: PendingRating | null, current: CustomerFlowState) => {
      if (left.current || !destinationUrl) return;
      left.current = true;
      if (pending) {
        saveCustomerDraft(token, customerFlowReducer(current, { type: "rating-leaving", pending }));
        send(pending);
      }
      navigateToDestination(destinationUrl);
      if (pending) dispatch({ type: "rating-leaving", pending });
    },
    [destinationUrl, send, token],
  );

  const handleRate = useCallback(
    (rating: RatingValue) => {
      if (left.current) return;
      let pending: PendingRating | null = null;
      try {
        pending = { key: createIdempotencyKey("rating"), rating, locale: state.locale };
      } catch {
        // No secure random source to key the request: the rating cannot be
        // sent safely, but nothing may stand between the customer and Google.
      }
      if (pending && typeof navigator !== "undefined" && navigator.onLine === false) {
        // Google cannot open without a connection either. Hold the tap; it
        // goes out, with the customer, when the connection returns.
        dispatch({ type: "rating-held-offline", pending });
        return;
      }
      leave(pending, state);
    },
    [leave, state],
  );

  // A page still on screen a moment after the tap says where it is going.
  useEffect(() => {
    if (state.feedbackStatus !== "leaving") return;
    const timer = window.setTimeout(() => dispatch({ type: "rating-sent" }), LEAVING_MS);
    return () => window.clearTimeout(timer);
  }, [state.feedbackStatus]);

  // A page that comes back with an unconfirmed tap finishes it: re-sent under
  // the same key, so the server replays whatever already landed. A held
  // offline tap goes out, with the customer, if the page is online again.
  useEffect(() => {
    if (!recoveryReady || !state.pending || left.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    if (state.screen === "handoff") send(state.pending);
    else if (state.feedbackStatus === "offline") leave(state.pending, state);
  }, [recoveryReady, state, send, leave]);

  useEffect(() => {
    function onOnline() {
      if (!state.pending) return;
      if (state.feedbackStatus === "offline") leave(state.pending, state);
      else if (state.screen === "handoff") send(state.pending);
    }

    // Back from the destination through the back-forward cache: no effect
    // re-runs and no draft is re-read, so the page is told here that it was
    // left, and is back.
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      left.current = false;
      setReturned(true);
      if (state.feedbackStatus === "leaving") dispatch({ type: "rating-sent" });
      if (state.pending && navigator.onLine !== false) send(state.pending);
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [leave, send, state]);

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
    <div ref={contentRef} className="customer-live">
      <CustomerVisitView
        heroUrl={context.page?.heroUrl ?? null}
        // One deterministic crop, shared by the owner preview and this page.
        // Main's Customer Page contract stores no per-owner hero transform, and
        // a preview-only control that the customer never sees would be a lie
        // about what the business published.
        transform={DEFAULT_HERO_TRANSFORM}
        // The handoff keeps the sheet exactly as it was — same place, same
        // size — with its words changed, so nothing moves as the page leaves.
        heading={state.screen === "rating" ? messages.ratingHeading : messages.thanksHeading}
        support={state.screen === "rating" ? messages.ratingSupport : messages.openingGoogle}
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
        <LazyMotion features={domAnimation} strict>
          <m.div key={state.screen} {...motionProps}>
            {state.screen === "rating" ? (
              <RatingScreen
                messages={messages}
                rating={state.rating}
                status={state.feedbackStatus}
                embedInVisit
                onRate={handleRate}
              />
            ) : (
              <HandoffScreen
                destinationUrl={context.destination.url}
                messages={messages}
                returned={returned}
              />
            )}
          </m.div>
        </LazyMotion>
      </CustomerVisitView>
    </div>
  );
}
