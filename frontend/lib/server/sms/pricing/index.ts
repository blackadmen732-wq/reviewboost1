import "server-only";

/**
 * ReviewBoost SMS pricing + routing engine.
 *
 * The path from provider rates to a chargeable price:
 *
 *   provider rates → true expected cost → provider selection →
 *   ReviewBoost price (margin-protected) → quote → (reserve credits) →
 *   actual-cost reconciliation
 *
 * Every stage is integer micro-units and fails closed. This barrel re-exports
 * the pieces; business code should import from here.
 */

export * from "@/lib/server/sms/pricing/margin";
export * from "@/lib/server/sms/pricing/cost-model";
export * from "@/lib/server/sms/pricing/rates";
export * from "@/lib/server/sms/pricing/rates-twilio";
export * from "@/lib/server/sms/pricing/rates-manual-deck";
export * from "@/lib/server/sms/pricing/router";
export * from "@/lib/server/sms/pricing/quote";
export * from "@/lib/server/sms/pricing/reconciliation";
