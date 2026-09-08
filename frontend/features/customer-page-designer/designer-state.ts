import {
  designsAreEqual,
  emptyCustomerPageDesign,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";
import {
  editableDesign,
  emptyDesignRecord,
  type CustomerPageDesignRecord,
} from "@/lib/customer-page/design-store";

/**
 * What the owner is looking at, and whether the customer is looking at the same
 * thing.
 *
 * The distinction this state exists to keep honest: editing changes the preview
 * immediately and changes nothing a customer can see. Publishing is the only
 * action that moves the two together, so "published" is not a boolean on a save
 * button — it is a comparison between the design being edited and the design
 * that was last published, and it is on screen the whole time.
 */

export type PublishPhase = "idle" | "publishing" | "published" | "failed";

export interface DesignerState {
  /** Null is the organisation-wide design. */
  locationId: string | null;
  record: CustomerPageDesignRecord;
  design: CustomerPageDesign;
  phase: PublishPhase;
}

export type DesignerAction =
  | { type: "scope-changed"; locationId: string | null; record: CustomerPageDesignRecord }
  | { type: "design-changed"; design: CustomerPageDesign }
  | { type: "publish-started" }
  | { type: "publish-succeeded"; record: CustomerPageDesignRecord }
  | { type: "publish-failed" }
  | { type: "discarded"; record: CustomerPageDesignRecord };

export function initialDesignerState(
  locationId: string | null,
  record: CustomerPageDesignRecord,
): DesignerState {
  return {
    locationId,
    record,
    design: editableDesign(record),
    phase: "idle",
  };
}

export function designerReducer(
  state: DesignerState,
  action: DesignerAction,
): DesignerState {
  switch (action.type) {
    case "scope-changed":
      return initialDesignerState(action.locationId, action.record);

    case "design-changed":
      return designsAreEqual(state.design, action.design)
        ? state
        : {
            ...state,
            design: action.design,
            // A published confirmation describes the design that was published,
            // so the next edit retires it.
            phase: state.phase === "published" ? "idle" : state.phase,
          };

    case "publish-started":
      return { ...state, phase: "publishing" };

    case "publish-succeeded":
      return { ...state, record: action.record, phase: "published" };

    case "publish-failed":
      return { ...state, phase: "failed" };

    case "discarded":
      return {
        ...state,
        record: action.record,
        design: editableDesign(action.record),
        phase: "idle",
      };
  }
}

/** The design a customer would get right now, before any unpublished edits. */
export function publishedDesign(state: DesignerState): CustomerPageDesign {
  return state.record.published ?? emptyCustomerPageDesign;
}

export function hasUnpublishedChanges(state: DesignerState): boolean {
  return !designsAreEqual(state.design, publishedDesign(state));
}

export function hasEverPublished(state: DesignerState): boolean {
  return state.record.published !== null;
}

/** A first visit: nothing published, nothing drafted, no photograph yet. */
export function isFirstRun(state: DesignerState): boolean {
  return (
    state.record === emptyDesignRecord ||
    (!hasEverPublished(state) &&
      designsAreEqual(state.design, emptyCustomerPageDesign))
  );
}
