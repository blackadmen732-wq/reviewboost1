import "server-only";

/**
 * ReviewBoost Customers — canonical model + import/integration foundation.
 *
 * One customer list per business regardless of source. Every future connector
 * (Google Sheets / Square / Toast / Clover / Vagaro / Housecall Pro) plugs
 * into the same normalize → validate → dedupe → match-or-create → link → visit
 * pipeline in `import-service.ts`. Text Requests continues to gate every send
 * through the merged consent/suppression stack — an imported customer is
 * *never* automatically SMS-eligible.
 */

export * from "@/lib/server/customers/types";
export * from "@/lib/server/customers/normalize";
export * from "@/lib/server/customers/csv";
export * from "@/lib/server/customers/import-service";
