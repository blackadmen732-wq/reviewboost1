import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { TabScreen } from "@/components/screen";
import { Segmented } from "@/components/segmented";
import { Stars } from "@/components/stars";
import { useAuth, useBusinessTimeZone } from "@/data/auth-context";
import { useFeedback, type FeedbackShow } from "@/data/use-feedback";
import { relativeDay } from "@/lib/words";
import { colors, type } from "@/theme";
import type { FeedbackItem } from "@/data/types";
import { RetryBlock } from "@/components/retry-block";

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
        <ActivityIndicator style={styles.spinner} color={colors.inkMuted} />
      ) : items.length === 0 ? (
        show === "needs" ? (
          <Empty title="All caught up." body="Nothing is waiting on you. Every rating, sorted or read, is under Everything." />
        ) : (
          <Empty title="Nothing yet." body="Ratings show up here after customers tap or scan your Tag." />
        )
      ) : (
        <View>
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
  const when = relativeDay(item.submittedAt, useBusinessTimeZone());
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
  spinner: { marginTop: 32 },
  notice: { gap: 16 },
  noticeText: { ...type.callout, color: colors.ink },
  top: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  dotRead: { backgroundColor: "transparent" },
  when: { ...type.subhead, color: colors.ink, flex: 1, textAlign: "right" },
  whenRead: { color: colors.inkMuted },
  note: { ...type.subhead, color: colors.ink, marginTop: 6, marginLeft: 18 },
  more: { marginTop: 12 },
  empty: { paddingVertical: 24, gap: 6 },
  emptyTitle: { ...type.headline, color: colors.ink },
  emptyBody: { ...type.callout, color: colors.inkMuted },
});
