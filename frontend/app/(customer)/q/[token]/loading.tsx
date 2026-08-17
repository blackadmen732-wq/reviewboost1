"use client";

import { CustomerLoading } from "@/features/customer-flow/customer-loading";
import { customerMessages } from "@/lib/i18n/customer-messages";

export default function LoadingCustomerReviewPage() {
  return <CustomerLoading messages={customerMessages.en} />;
}
