import { redirect } from "next/navigation";

/**
 * The old Reviews screen lives on as Feedback → Insights.
 *
 * It carried its own all-time average and breakdown; keeping it meant two
 * analytics that could disagree. Anyone with the old link, a bookmark or a
 * notification lands on the one that is maintained. Still an owner route: the
 * proxy asks a signed-out visitor to sign in before this runs.
 */
export default function ReviewsPage(): never {
  redirect("/feedback/insights");
}
