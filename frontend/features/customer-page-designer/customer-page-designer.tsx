"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ImagePlus } from "lucide-react";

import { notify } from "@/components/ui/toast";
import {
  CustomerPageControls,
  type DesignerLocation,
} from "@/features/customer-page-designer/customer-page-controls";
import { CustomerPagePreview } from "@/features/customer-page-designer/customer-page-preview";
import { PublishBar } from "@/features/customer-page-designer/publish-bar";
import type { PublishPhase } from "@/features/customer-page-designer/designer-state";
import {
  designsAreEqual,
  emptyCustomerPageDesign,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";
import {
  editableDesign,
  emptyDesignRecord,
  localCustomerPageDesignStore,
  type CustomerPageDesignRecord,
  type CustomerPageDesignStore,
  type DesignScope,
} from "@/lib/customer-page/design-store";
import type { Locale } from "@/lib/i18n/config";
import { customerMessages } from "@/lib/i18n/customer-messages";

interface CustomerPageDesignerProps {
  orgId: string;
  businessName: string;
  locations: readonly DesignerLocation[];
  languages: readonly Locale[];
  canEdit: boolean;
  /** Injectable so a test — or the real API — can replace the storage seam. */
  store?: CustomerPageDesignStore;
}

/** Long enough that a drag is one write, short enough to survive a closed tab. */
const draftWriteDelayMs = 400;

/**
 * The owner's side of the customer page.
 *
 * Two columns, and the proportion is the argument: the controls are a narrow
 * strip and the phone is the rest of the screen, because the owner is not
 * filling in a form about their page, they are looking at their page and
 * occasionally changing it. Every control writes straight into the preview.
 *
 * Editing is immediate and private; publishing is the only thing that moves.
 * Drafts are written to the store shortly after each change so a closed tab
 * costs nothing, and the customer's copy stays exactly where it was until the
 * owner says otherwise.
 */
export function CustomerPageDesigner({
  orgId,
  businessName,
  locations,
  languages,
  canEdit,
  store = localCustomerPageDesignStore,
}: CustomerPageDesignerProps) {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PublishPhase>("idle");

  const scope: DesignScope = useMemo(
    () => ({ orgId, locationId }),
    [orgId, locationId],
  );
  const record = useSyncExternalStore(
    store.subscribe,
    () => store.read(scope),
    () => emptyDesignRecord,
  );

  /*
   * The design being edited is React state, not the store, because dragging a
   * focal point produces a change per frame and a photograph is a large string —
   * writing that through storage on every frame would make the drag stutter.
   *
   * Adopting the store's version when the *record* changes identity is the
   * documented way to reset state from a new input without an effect. Local
   * edits never trip it: the store does not announce them.
   */
  const [edited, setEdited] = useState<CustomerPageDesign | null>(null);
  const [adopted, setAdopted] = useState(record);
  if (record !== adopted) {
    setAdopted(record);
    setEdited(null);
  }

  const design = edited ?? editableDesign(record);
  const published = record.published ?? emptyCustomerPageDesign;
  const unpublished = !designsAreEqual(design, published);
  const firstRun =
    record.published === null && designsAreEqual(design, emptyCustomerPageDesign);

  // Read by the debounced write, the flush on the way out, and publish — all of
  // which run after a render and want the newest values, not the ones that were
  // current when they were created.
  const latest = useRef({ scope, design });
  useEffect(() => {
    latest.current = { scope, design };
  }, [scope, design]);

  useEffect(() => {
    if (edited === null) return;
    const timer = window.setTimeout(
      () => store.saveDraft(latest.current.scope, latest.current.design),
      draftWriteDelayMs,
    );
    return () => window.clearTimeout(timer);
  }, [edited, store]);

  // A pending write must not be lost to a navigation a moment after the edit.
  useEffect(() => {
    const flush = () => store.saveDraft(latest.current.scope, latest.current.design);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [store]);

  useEffect(() => {
    if (!unpublished) return;
    // Only ever a nudge, and only because the page a customer gets is still the
    // old one — the edits themselves are already saved.
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unpublished]);

  const change = useCallback((next: CustomerPageDesign) => {
    setEdited(next);
    setPhase((current) => (current === "published" ? "idle" : current));
  }, []);

  const changeScope = useCallback((next: string | null) => {
    setLocationId(next);
    setEdited(null);
    setPhase("idle");
  }, []);

  const publish = useCallback(() => {
    setPhase("publishing");
    try {
      store.publish(latest.current.scope, latest.current.design);
      setEdited(null);
      setPhase("published");
      notify.success(
        "Customer Page published",
        "Customers will see this version when they tap or scan.",
      );
    } catch {
      setPhase("failed");
    }
  }, [store]);

  const logoAlt = customerMessages.en.businessLogoAlt(businessName);
  const locationName =
    locations.find((location) => location.locationId === locationId)?.name ?? null;
  const previewHref = locationId
    ? `/customer-page/preview?location=${encodeURIComponent(locationId)}`
    : "/customer-page/preview";

  return (
    <>
      <PublishBar
        phase={phase}
        hasUnpublishedChanges={unpublished}
        hasEverPublished={record.published !== null}
        canPublish={canEdit}
        previewHref={previewHref}
        onPublish={publish}
      />

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(320px,38fr)_62fr]">
        <div className="order-2 xl:order-1">
          {firstRun && canEdit ? <FirstRun /> : null}

          <CustomerPageControls
            design={design}
            businessName={businessName}
            logoAlt={logoAlt}
            locations={locations}
            locationId={locationId}
            canEdit={canEdit}
            onChange={change}
            onScopeChange={changeScope}
          />
        </div>

        <div className="order-1 flex justify-center xl:order-2 xl:sticky xl:top-8">
          <CustomerPagePreview
            design={design}
            businessName={businessName}
            locationName={locationName}
            languages={languages}
          />
        </div>
      </div>
    </>
  );
}

/**
 * What the owner sees the first time, which is not an empty state.
 *
 * The preview beside this is already showing their real business name on a
 * finished page, so the only thing missing is the photograph — and that is the
 * only thing this asks for.
 */
function FirstRun() {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-[var(--shadow-control)]">
      <ImagePlus className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
      <div>
        <p className="font-semibold tracking-[-0.01em] text-ink">
          Make it feel like your business.
        </p>
        <p className="mt-0.5 text-sm text-muted">
          Add a business photo. Everything else is already set up.
        </p>
      </div>
    </div>
  );
}

export type { CustomerPageDesignRecord };
