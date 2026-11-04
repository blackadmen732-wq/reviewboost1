import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { TabScreen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { Stars } from "@/components/stars";
import { LoadingBlock } from "@/components/loading-block";
import { apiFetch } from "@/data/api";
import { useAuth, useBusinessTimeZone } from "@/data/auth-context";
import { useFeedback, type FeedbackShow } from "@/data/use-feedback";
import { dayAndTime } from "@/lib/words";
import { colors, type } from "@/theme";
import type { FeedbackItem } from "@/data/types";
import { RetryBlock } from "@/components/retry-block";

/**
 * Whether the business has any rating at all, asked only when "Needs you" is
 * empty: "All caught up" said to an owner who has never had a rating told
 * them they had dealt with ratings that never came. Null until known.
 */
function useHasAnyRating(orgId: string | undefined, ask: boolean): boolean | null {
  const [hasAny, setHasAny] = useState<boolean | null>(null);
  useEffect(() => {
    if (!orgId || !ask) return;
    let live = true;
    apiFetch<{ data: unknown[] }>("/api/v1/customer-responses?limit=1", orgId)
      .then((res) => {
        if (live) setHasAny(res.data.length > 0);
      })
      .catch(() => {
        // Unknown: the usual "All caught up" stands.
      });
    return () => {
      live = false;
    };
  }, [orgId, ask]);
  return hasAny;
}

const VIEWS = [
  { value: "needs", label: "Needs you" },
  { value: "all", label: "Everything" },
] as const;

/**
 * Feedback: the website's inbox. "Needs you" is what is waiting on the
 * business (anything unread, and any 3 stars or fewer nobody has sorted);
 * "Everything" is every rating. Rows say the stars and the day, a dot for
 * unread, and the customer's words when they left any.
 */
export default function FeedbackScreen() {
  const { activeOrg } = useAuth();
  const params = useLocalSearchParams<{ show?: string }>();
  const [show, setShow] = useState<FeedbackShow>(params.show === "all" ? "all" : "needs");

  // Home's number tiles open Everything.
  useEffect(() => {
    if (params.show === "all") setShow("all");
  }, [params.show]);

  const { items, loading, refreshing, error, hasMore, loadingMore, load, refresh, loadMore } = useFeedback(
    activeOrg?.orgId,
    show,
  );
  const emptyNeeds = show === "needs" && !loading && !error && items.length === 0;
  const hasAnyRating = useHasAnyRating(activeOrg?.orgId, emptyNeeds);

  // Back from a rating, the list shows what changed (read, sorted).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <TabScreen title="Feedback" subtitle="Ratings from your customers." refreshing={refreshing} onRefresh={() => void refresh()}>
      <Segmented options={VIEWS} value={show} onChange={setShow} />

      {error && items.length === 0 ? (
        <RetryBlock message={error} retryKey="feedback" onRetry={() => void load()} />
      ) : loading && items.length === 0 ? (
        <LoadingBlock label="Loading ratings…" />
      ) : items.length === 0 ? (
        show === "needs" && hasAnyRating !== false ? (
          <Empty title="All caught up." body="Nothing is waiting on you. Every rating, sorted or read, is under Everything." />
        ) : (
          <Empty title="No ratings yet." body="Ratings show up here after customers tap or scan your Tag." />
        )
      ) : (
        <View style={styles.listArea}>
          {/* A refresh that failed keeps the ratings that were here. */}
          {error ? <RetryBlock compact message={error} retryKey="feedback-stale" onRetry={() => void load()} /> : null}
          <Group>
            {items.map((item) => (
              <FeedbackRow key={item.id} item={item} />
            ))}
          </Group>
          {hasMore ? (
            <Button
              label="Show more"
              variant="secondary"
              busy={loadingMore}
              busyLabel="Loading…"
              onPress={() => void loadMore()}
              style={styles.more}
            />
          ) : null}
        </View>
      )}
    </TabScreen>
  );
}

function FeedbackRow({ item }: { item: FeedbackItem }) {
  // "Today at 2:30 PM": when it came in, without opening it.
  const when = dayAndTime(item.submittedAt, useBusinessTimeZone());
  return (
    <Row
      onPress={() => router.push(`/feedback/${item.id}`)}
      accessibilityLabel={[
        `${item.rating} out of 5 stars`,
        !item.isRead ? "Unread" : null,
        item.isResolved ? "Sorted" : null,
        item.note ?? null,
        when,
      ]
        .filter(Boolean)
        .join(". ")}
      accessibilityHint="Opens this rating"
    >
      <View style={styles.top}>
        <View style={[styles.dot, item.isRead ? styles.dotRead : null]} />
        <Stars rating={item.rating} size={20} />
        <Text style={[styles.when, item.isRead ? styles.whenRead : null]} numberOfLines={1}>
          {item.isResolved ? "Sorted · " : ""}
          {when}
        </Text>
      </View>
      {item.note ? (
        <Text style={styles.note} numberOfLines={2}>
          {item.note}
        </Text>
      ) : null}
    </Row>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 16 },
  noticeText: { ...type.callout, color: colors.ink },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  dotRead: { backgroundColor: "transparent" },
  when: { ...type.subhead, color: colors.ink, flex: 1, textAlign: "right" },
  whenRead: { color: colors.inkMuted },
  note: { ...type.subhead, color: colors.ink, marginTop: 6, marginLeft: 18 },
  more: {},
  listArea: { gap: 12 },
  empty: { paddingVertical: 24, gap: 6 },
  emptyTitle: { ...type.headline, color: colors.ink },
  emptyBody: { ...type.callout, color: colors.inkMuted },
});
