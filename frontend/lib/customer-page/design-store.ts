import {
  designsAreEqual,
  emptyCustomerPageDesign,
  normalizeCustomerPageDesign,
  type CustomerPageDesign,
} from "@/lib/customer-page/design";

/**
 * Where a customer page design lives until the backend owns it.
 *
 * The designer is written against this interface, not against storage, because
 * the only thing that should change when the API arrives is which implementation
 * is handed in: `read`, `saveDraft`, `publish` and `discardDraft` map onto a GET
 * and three writes. Nothing in the UI knows where a design came from.
 *
 * The local implementation below keeps drafts in `localStorage`, which is enough
 * to make the product real for the person using it — their page survives a
 * reload, publishing is a distinct act, and the customer preview reads exactly
 * what was published. It is not enough to be the product: it is per-browser, so
 * it is scoped by organisation and clearly marked.
 */

export interface CustomerPageDesignRecord {
  /** What a customer would see now. Null until the owner has published once. */
  published: CustomerPageDesign | null;
  /** Edits in progress. Null when the draft matches what is published. */
  draft: CustomerPageDesign | null;
  publishedAt: string | null;
}

export interface DesignScope {
  orgId: string;
  /** Null is the organisation-wide design that every location inherits. */
  locationId: string | null;
}

export interface CustomerPageDesignStore {
  read(scope: DesignScope): CustomerPageDesignRecord;
  /**
   * Changes made somewhere other than here — the same owner with the designer
   * and the customer preview open in two tabs, which is how anyone checks their
   * own page. Local edits are not announced: the editor already knows about
   * those, and re-reading them would fight whatever is being typed or dragged.
   */
  subscribe(listener: () => void): () => void;
  saveDraft(scope: DesignScope, design: CustomerPageDesign): void;
  discardDraft(scope: DesignScope): void;
  publish(scope: DesignScope, design: CustomerPageDesign): CustomerPageDesignRecord;
}

export const emptyDesignRecord: CustomerPageDesignRecord = {
  published: null,
  draft: null,
  publishedAt: null,
};

const storageVersion = 1;

export function designScopeKey(scope: DesignScope): string {
  return `reviewboost:customer-page-design:${storageVersion}:${scope.orgId}:${
    scope.locationId ?? "all"
  }`;
}

interface StoredRecord {
  version: typeof storageVersion;
  published: unknown;
  draft: unknown;
  publishedAt: unknown;
}

function parseRecord(value: string): CustomerPageDesignRecord {
  try {
    const stored = JSON.parse(value) as Partial<StoredRecord>;
    if (stored.version !== storageVersion) return emptyDesignRecord;
    return {
      published: stored.published
        ? normalizeCustomerPageDesign(stored.published)
        : null,
      draft: stored.draft ? normalizeCustomerPageDesign(stored.draft) : null,
      publishedAt:
        typeof stored.publishedAt === "string" ? stored.publishedAt : null,
    };
  } catch {
    return emptyDesignRecord;
  }
}

/*
 * Snapshots are cached by key so that reading the same unchanged record twice
 * returns the same object. `useSyncExternalStore` compares snapshots by identity
 * and re-renders forever if a reader hands it a fresh object every time.
 */
const snapshots = new Map<string, CustomerPageDesignRecord>();
const listeners = new Set<() => void>();

function announce(key: string | null) {
  if (key) snapshots.delete(key);
  else snapshots.clear();
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent) {
  if (event.key && !event.key.startsWith("reviewboost:customer-page-design:")) return;
  announce(event.key);
}

function write(scope: DesignScope, record: CustomerPageDesignRecord): void {
  const key = designScopeKey(scope);
  snapshots.set(key, record);
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: storageVersion, ...record } satisfies StoredRecord),
    );
  } catch {
    // Quota, private browsing, or a blocked origin. The design stays in the
    // snapshot cache for this session; the owner has not lost anything they can
    // see, and publishing again after freeing space works.
  }
}

export const localCustomerPageDesignStore: CustomerPageDesignStore = {
  read(scope) {
    if (typeof window === "undefined") return emptyDesignRecord;
    const key = designScopeKey(scope);
    const cached = snapshots.get(key);
    if (cached) return cached;

    let record = emptyDesignRecord;
    try {
      const value = window.localStorage.getItem(key);
      if (value) record = parseRecord(value);
    } catch {
      record = emptyDesignRecord;
    }
    snapshots.set(key, record);
    return record;
  },

  subscribe(listener) {
    if (typeof window === "undefined") return () => undefined;
    if (listeners.size === 0) window.addEventListener("storage", handleStorage);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("storage", handleStorage);
    };
  },

  saveDraft(scope, design) {
    if (typeof window === "undefined") return;
    const current = this.read(scope);
    const matchesPublished =
      current.published !== null && designsAreEqual(current.published, design);
    write(scope, { ...current, draft: matchesPublished ? null : design });
  },

  discardDraft(scope) {
    if (typeof window === "undefined") return;
    write(scope, { ...this.read(scope), draft: null });
  },

  publish(scope, design) {
    const record: CustomerPageDesignRecord = {
      published: design,
      draft: null,
      publishedAt: new Date().toISOString(),
    };
    if (typeof window !== "undefined") write(scope, record);
    return record;
  },
};

/** What the owner is editing: their draft if they have one, else what is live. */
export function editableDesign(
  record: CustomerPageDesignRecord,
): CustomerPageDesign {
  return record.draft ?? record.published ?? emptyCustomerPageDesign;
}
