import type { Metadata } from "next";

import { CustomerPageShowcase } from "@/features/public/customer-page-showcase";
import { PublicShell } from "@/features/public/public-shell";

export const metadata: Metadata = {
  title: "Customer page",
  description: "One rating screen, styled with your business's own photo. See it on five different businesses.",
};

export default function CustomerPagePage() {
  return (
    <PublicShell>
      <div className="border-b border-[#e1e5dc] bg-[#edede5]">
        <div className="mx-auto max-w-[1200px] px-5 py-16 sm:px-8 sm:py-20">
          <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#2d6a4f]">Customer page</p>
          <h1 className="mt-4 max-w-[26ch] text-[2rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-[#1b4332] sm:text-[2.5rem]">
            One screen, five businesses, the same product.
          </h1>
          <p className="mt-5 max-w-[48ch] text-lg leading-relaxed text-[#4a5d4e]">
            Every business gets its own hero photo. The rating, the stars, and the handoff to Google are exactly the
            same for all of them — that consistency is what makes this a product, not a website builder.
          </p>
        </div>
      </div>
      <CustomerPageShowcase />
    </PublicShell>
  );
}
