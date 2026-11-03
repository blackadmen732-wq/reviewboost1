import type { NextRequest } from "next/server";

import { deriveHomeModel, tagStatusLine } from "@/features/dashboard/home-model";
import { homeModelForApp } from "@/lib/owner/app-home";
import { insightsHomeSummary } from "@/lib/owner/insights";
import { permissionsFor } from "@/lib/owner/permissions";
import { requireOrganizationContext } from "@/lib/server/auth";
import { ApiError, ERROR_CODE } from "@/lib/server/errors";
import { handle, json, preflight } from "@/lib/server/http";
import {
  getFeedbackInsights,
  getOwnerCounts,
  getServiceState,
  hasPublishedCustomerPhoto,
  listLocations,
  listReviews,
  listStands,
  type OwnerDb,
} from "@/lib/server/owner-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/home";

/**
 * GET /api/v1/home — the owner's Home, for the iPhone app.
 *
 * The same reads, the same model (`deriveHomeModel`) and the same words as the
 * website's Home, so an owner sees one product on either screen: what needs
 * them, this week and the last 30 days as numbers, unread ratings, and how
 * their Tags are doing. Every read runs as the caller under Row Level Security
 * (`context.db`); the organization is the one the token's membership allows.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return handle(request, ROUTE, async (requestId) => {
    const context = await requireOrganizationContext(request);
    const db = context.db as OwnerDb;

    const { data: org, error } = await db
      .from("organizations")
      .select("name, timezone")
      .eq("id", context.orgId)
      .maybeSingle();
    if (error || !org) {
      throw new ApiError(503, ERROR_CODE.serviceUnavailable, "Please try again shortly.");
    }
    const timezone = (org.timezone as string | null) ?? "UTC";

    const [counts, stands, locations, unread, hasCustomerPhoto, insights, service] = await Promise.all([
      getOwnerCounts(context.orgId, timezone, db),
      listStands(context.orgId, db),
      listLocations(context.orgId, db),
      listReviews(context.orgId, { unreadOnly: true, openOnly: true, limit: 5 }, db),
      hasPublishedCustomerPhoto(context.orgId, db),
      getFeedbackInsights(context.orgId, timezone, { range: 30 }, db),
      getServiceState(context.orgId, db),
    ]);

    const can = permissionsFor(context.role);
    // The website's model, minus anything that points at paying (App Store
    // 3.1.3(f)): this endpoint exists for the iPhone app.
    const model = homeModelForApp(deriveHomeModel({
      counts,
      stands,
      hasLocation: locations.length > 0,
      canManage: can.manageTags,
      hasCustomerPhoto,
      service,
      canManageBilling: can.manageBilling,
    }), service);
    const labels = stands.length > 1 ? new Map(stands.map((stand) => [stand.standId, stand.label])) : null;

    return json(request, requestId, 200, {
      data: {
        businessName: org.name as string,
        // The Feedback tab's badge: the same count the website's tab shows.
        unreadCount: counts.unread,
        model,
        insights: insightsHomeSummary(insights),
        tagStatusLine: tagStatusLine(model.tagStatus),
        unread: unread.items.map((item) => ({
          id: item.responseId,
          rating: item.rating,
          submittedAt: item.submittedAt,
          isRead: item.isRead,
          isResolved: item.isResolved,
          hasNote: item.note !== null && item.note.length > 0,
          tagLabel: labels?.get(item.standId) ?? null,
        })),
      },
      requestId,
    });
  });
}

export async function OPTIONS(request: NextRequest): Promise<Response> {
  return preflight(request);
}
