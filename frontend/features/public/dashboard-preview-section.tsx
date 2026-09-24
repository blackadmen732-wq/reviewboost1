import { FeedbackList, type FeedbackItem } from "@/features/dashboard/feedback-list";
import { HomeSetupChecklist } from "@/features/dashboard/home-setup-checklist";
import type { SetupChecklist } from "@/features/dashboard/home-model";

/**
 * A framed look at the real Home screen.
 *
 * Renders the actual `HomeSetupChecklist` and `FeedbackList` components with
 * sample data — not a screenshot, not a redrawn mockup — so this stays true
 * to the product by construction: if either component changes, this section
 * changes with it instead of quietly going stale.
 *
 * The frame is `role="img"` with sample data and `pointer-events-none`, the
 * same pattern `PhoneFrame` uses for the customer page preview elsewhere on
 * this site: real interactive components, presented as a picture rather than
 * a second, clickable copy of the app that happens to sit on a marketing page.
 */
const SAMPLE_CHECKLIST: SetupChecklist = {
  items: [
    { id: "subscription", label: "Subscription active", complete: true, href: "/settings/billing" },
    { id: "destination", label: "Google review link connected", complete: true, href: "/settings" },
    { id: "customerPage", label: "Publish your Customer Page", complete: false, href: "/customer-page" },
    { id: "firstTag", label: "Create your first Tag", complete: false, href: "/stands" },
  ],
  completeCount: 2,
  total: 4,
  nextIncomplete: {
    id: "customerPage",
    label: "Publish your Customer Page",
    complete: false,
    href: "/customer-page",
  },
};

const HOUR = 1000 * 60 * 60;
const SAMPLE_FEEDBACK: FeedbackItem[] = [
  { id: "1", rating: 5, note: null, submittedAt: new Date(Date.now() - HOUR * 2).toISOString(), isRead: false, isResolved: false, noteCount: 0 },
  { id: "2", rating: 4, note: null, submittedAt: new Date(Date.now() - HOUR * 26).toISOString(), isRead: true, isResolved: false, noteCount: 0 },
  { id: "3", rating: 5, note: null, submittedAt: new Date(Date.now() - HOUR * 50).toISOString(), isRead: true, isResolved: true, noteCount: 0 },
];

export function DashboardPreviewSection() {
  return (
    <div
      className="pointer-events-none select-none overflow-hidden rounded-[1.5rem] border border-[#e1e5dc] bg-[#f8f5f0] shadow-[0_24px_60px_-24px_rgba(27,67,50,0.25)]"
      role="img"
      aria-label="ReviewBoost Home screen, showing setup progress and recent feedback"
    >
      <div className="flex items-center gap-2 border-b border-[#e1e5dc] bg-white px-5 py-3.5">
        <span className="size-2.5 rounded-full bg-[#e1e5dc]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#e1e5dc]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[#e1e5dc]" aria-hidden="true" />
        <span className="ml-2 text-sm font-medium text-[#4a5d4e]">Home</span>
      </div>
      <div className="bg-canvas p-6 sm:p-8">
        <HomeSetupChecklist checklist={SAMPLE_CHECKLIST} />
        <p className="mb-3 text-sm font-medium text-muted">Recent feedback</p>
        <FeedbackList items={SAMPLE_FEEDBACK} />
      </div>
    </div>
  );
}
