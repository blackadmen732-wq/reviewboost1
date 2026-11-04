import { useCallback, useEffect, useRef } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { Button } from "@/components/button";
import { Group, Row } from "@/components/group";
import { Icon } from "@/components/icon";
import { TabScreen } from "@/components/screen";
import { Stars } from "@/components/stars";
import { Tappable } from "@/components/tappable";
import { useAuth, useBusinessTimeZone } from "@/data/auth-context";
import { useHome, type AttentionKind, type HomeData, type HomeSetupStep } from "@/data/home";
import { go, opensBrowser } from "@/lib/destinations";
import { dayAndTime, plural } from "@/lib/words";
import { card, colors, type } from "@/theme";
import { LoadingBlock } from "@/components/loading-block";
import { RetryBlock } from "@/components/retry-block";

/** While Home is on screen, ratings that come in show without a tap. */
const REFRESH_WHILE_OPEN_MS = 60_000;

/**
 * Home: does anything need me? The website's Home, from the same model and in
 * the same words (GET /api/v1/home): one headline and one button, anything
 * else that needs doing by name, this week and the last 30 days as two plain
 * numbers, the ratings nobody has opened, and how the Tags are doing.
 */
export default function HomeScreen() {
  const { activeOrg } = useAuth();
  const { home, loading, error, refresh } = useHome();

  // Fresh every time the owner comes back to it: it is the "what's new"
  // screen. Coming back means the tab, tapping Home while on it, the app
  // returning to the foreground, and a quiet look every minute while it is
  // open, so a rating left at the counter shows up by itself.
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useFocusEffect(
    useCallback(() => {
      void refresh();
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void latest.current();
      }, REFRESH_WHILE_OPEN_MS);
      const foreground = AppState.addEventListener("change", (state) => {
        if (state === "active") void latest.current();
      });
      return () => {
        clearInterval(timer);
        foreground.remove();
      };
    }, [refresh]),
  );
  const navigation = useNavigation();
  useEffect(
    () =>
      // The tab bar's own event: tapping Home while already on Home.
      (navigation as unknown as { addListener: (event: "tabPress", fn: () => void) => () => void }).addListener(
        "tabPress",
        () => {
          if (navigation.isFocused()) void latest.current();
        },
      ),
    [navigation],
  );

  return (
    <TabScreen title={home?.businessName ?? activeOrg?.name ?? "Home"} refreshing={loading && home !== null} onRefresh={() => void refresh()}>
      {home === null ? (
        error ? (
          <RetryBlock message={error} retryKey="home" onRetry={() => void refresh()} />
        ) : (
          <LoadingBlock label="Loading Home…" />
        )
      ) : home.model.kind === "empty" ? (
        <EmptyHome home={home} />
      ) : (
        <ActiveHome home={home} />
      )}
    </TabScreen>
  );
}

function StateLabel({ calm }: { calm: boolean }) {
  return (
    <View style={styles.stateLabel}>
      <View style={[styles.dot, { backgroundColor: calm ? colors.brand : colors.starFilled }]} />
      <Text style={styles.stateLabelText}>{calm ? "All good" : "Needs you"}</Text>
    </View>
  );
}

function Headline({ title, body }: { title: string; body: string }) {
  return (
    <View>
      <Text style={styles.headline} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.headlineBody}>{body}</Text>
    </View>
  );
}

function PrimaryAction({ primary }: { primary: HomeData["model"]["primary"] }) {
  if (!primary) return null;
  return (
    <Button
      label={primary.label}
      onPress={() => go(primary.href)}
      style={styles.primary}
      {...(opensBrowser(primary.href) ? { accessibilityHint: "Opens the website in your browser" } : {})}
    />
  );
}

function ActiveHome({ home }: { home: HomeData }) {
  const timeZone = useBusinessTimeZone();
  const { model, insights, unread } = home;
  const [first, ...others] = model.attentions;

  return (
    <>
      <View>
        <StateLabel calm={!first} />
        {first ? (
          <Headline title={first.title} body={first.body} />
        ) : (
          <Headline title="Nothing needs you" body="Everything is working. Get back to your customers." />
        )}
        <PrimaryAction primary={model.primary} />
        {others.length > 0 ? (
          <View style={styles.also}>
            <Text style={styles.sectionLabel}>Also</Text>
            {others.map((attention) => (
              <AlsoRow key={attention.kind} kind={attention.kind} title={attention.title} />
            ))}
          </View>
        ) : null}
      </View>

      {model.week || insights ? (
        <View style={styles.tiles} accessibilityLabel="Your numbers">
          {model.week ? (
            // How many people tapped, and how many of them rated: the
            // website's weekTile, word for word. An older server sends no taps.
            <NumberTile
              label="This week"
              {...weekTile(model.week)}
              hint="Opens Feedback"
              onPress={() => router.navigate({ pathname: "/(tabs)/feedback", params: { show: "all" } })}
            />
          ) : null}
          {insights ? (
            <NumberTile
              label="Last 30 days"
              value={insights.average}
              star
              unit="average"
              note={[plural(insights.total, "rating"), insights.direction].filter(Boolean).join(" · ")}
              hint="Opens Feedback"
              onPress={() => router.navigate({ pathname: "/(tabs)/feedback", params: { show: "all" } })}
            />
          ) : null}
        </View>
      ) : null}

      {unread.length > 0 ? (
        <Group title="Unread feedback">
          {unread.map((item) => (
            <Row
              key={item.id}
              onPress={() => router.push(`/feedback/${item.id}`)}
              accessibilityLabel={[
                `${item.rating} out of 5 stars`,
                "Unread",
                item.hasNote ? "Has a message" : null,
                item.tagLabel,
                dayAndTime(item.submittedAt, timeZone),
              ]
                .filter(Boolean)
                .join(". ")}
              accessibilityHint="Opens this rating"
            >
              <View style={styles.ratingRow}>
                <View style={styles.unreadDot} />
                <Stars rating={item.rating} size={20} />
                <View style={styles.ratingMeta}>
                  {item.hasNote ? <Icon name="text.bubble" glyph="✎" size={15} color={colors.inkMuted} /> : null}
                  <Text style={styles.when} numberOfLines={1}>
                    {dayAndTime(item.submittedAt, timeZone)}
                  </Text>
                </View>
              </View>
              {item.tagLabel ? <Text style={styles.tagLine}>{item.tagLabel}</Text> : null}
            </Row>
          ))}
        </Group>
      ) : null}

      <Group>
        <Row onPress={() => router.navigate("/(tabs)/stands")} accessibilityHint="Opens Tags">
          <Text style={styles.sectionLabel}>Tags</Text>
          <Text style={styles.tagStatus}>{home.tagStatusLine}</Text>
        </Row>
      </Group>
    </>
  );
}

function EmptyHome({ home }: { home: HomeData }) {
  const { model } = home;
  const blocker = model.attentions[0] ?? null;
  return (
    <>
      <View>
        <StateLabel calm={!blocker} />
        {blocker ? (
          <Headline title={blocker.title} body={blocker.body} />
        ) : (
          <Headline title="No ratings yet." body="Your Tag is ready. Put it where people pay." />
        )}
        <PrimaryAction primary={model.primary} />
      </View>

      {model.setup ? (
        // The headline already says how to set up the Tag; the step under it
        // does not say it a second time.
        <SetupSteps steps={model.setup} quietStep={blocker?.kind === "tag-unprogrammed" ? "tag" : null} />
      ) : null}

      {model.planNote ? (
        <View style={styles.alsoRow}>
          <View style={[styles.dot, styles.alsoDot]} />
          <Text style={styles.alsoText}>{model.planNote.title}.</Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Where an "Also" line leads in the app. Plan and payment lines lead nowhere
 * (App Store 3.1.3(f)), so they stay plain text, without a chevron that
 * promises a tap.
 */
function alsoHref(kind: AttentionKind): string | null {
  switch (kind) {
    case "unread":
    case "unsorted":
      return "/feedback";
    case "tag-missing":
    case "tag-unprogrammed":
    case "tag-rewrite":
      return "/stands";
    case "google":
    case "google-upgrade":
      return "/settings";
    default:
      return null;
  }
}

function AlsoRow({ kind, title }: { kind: AttentionKind; title: string }) {
  const href = alsoHref(kind);
  const body = (
    <>
      <View style={[styles.dot, styles.alsoDot]} />
      <Text style={styles.alsoText}>{title}</Text>
      {href ? <Icon name="chevron.right" glyph="›" size={13} color={colors.inkMuted} weight="semibold" /> : null}
    </>
  );
  if (!href) return <View style={styles.alsoRow}>{body}</View>;
  return (
    <Tappable
      kind="row"
      onPress={() => go(href)}
      accessibilityRole="button"
      accessibilityLabel={title}
      {...(opensBrowser(href) ? { accessibilityHint: "Opens the website in your browser" } : {})}
      style={[styles.alsoRow, styles.alsoTappable]}
    >
      {body}
    </Tappable>
  );
}

function SetupSteps({ steps, quietStep }: { steps: HomeSetupStep[]; quietStep: string | null }) {
  const current = steps.findIndex((step) => !step.done);
  const done = steps.filter((step) => step.done).length;
  return (
    <View>
      <View style={styles.setupHeader}>
        <Text style={styles.sectionLabel}>Getting set up</Text>
        <Text style={styles.sectionLabel}>
          {done} of {steps.length} done
        </Text>
      </View>
      <Group>
        {steps.map((step, index) => {
          const isCurrent = index === current;
          const body = (
            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepBadge,
                  step.done ? styles.stepDone : isCurrent ? styles.stepCurrent : styles.stepLater,
                ]}
              >
                {step.done ? (
                  <Icon name="checkmark" glyph="✓" size={14} color={colors.brandText} weight="bold" />
                ) : (
                  <Text style={[styles.stepNumber, isCurrent ? styles.stepNumberCurrent : null]}>{step.number}</Text>
                )}
              </View>
              <View style={styles.stepText}>
                <Text style={[styles.stepTitle, isCurrent ? styles.stepTitleCurrent : null]}>
                  {step.title}
                </Text>
                {isCurrent && step.key !== quietStep ? <Text style={styles.stepBody}>{step.body}</Text> : null}
              </View>
            </View>
          );
          return step.action && isCurrent ? (
            <Row
              key={step.key}
              onPress={() => go(step.action!.href)}
              accessibilityLabel={`${step.title}. ${step.action.label}`}
              {...(opensBrowser(step.action.href) ? { accessibilityHint: "Opens the website in your browser" } : {})}
            >
              {body}
            </Row>
          ) : (
            <Row key={step.key} accessibilityLabel={`${step.title}${step.done ? ", done" : ""}`}>
              {body}
            </Row>
          );
        })}
      </Group>
    </View>
  );
}

/**
 * One number to read from arm's length: what it counts, the number big, the
 * word for it, one quiet line of context. The whole card is the button.
 */
/** frontend/features/dashboard/home-model.ts weekTile */
function weekTile(week: { count: number; change: string | null; taps?: number | null }): {
  value: string;
  unit: string;
  note: string | null;
} {
  if (week.taps == null) {
    return { value: week.count.toLocaleString("en-US"), unit: week.count === 1 ? "rating" : "ratings", note: week.change };
  }
  return { value: week.taps.toLocaleString("en-US"), unit: week.taps === 1 ? "tap" : "taps", note: `${week.count} rated` };
}

function NumberTile({
  label,
  value,
  unit,
  note,
  star = false,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  unit: string;
  note: string | null;
  star?: boolean;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Tappable
      kind="row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[label, `${value}${star ? " stars" : ""} ${unit}`, note].filter(Boolean).join(". ")}
      accessibilityHint={hint}
      style={styles.tile}
    >
      <View style={styles.tileHead}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Icon name="chevron.right" glyph="›" size={12} color={colors.inkMuted} weight="semibold" />
      </View>
      <View style={styles.tileValueRow}>
        <Text style={styles.tileValue}>{value}</Text>
        {star ? <Text style={styles.tileStar}>★</Text> : null}
      </View>
      <Text style={styles.tileUnit}>{unit}</Text>
      {note ? <Text style={styles.tileNote}>{note}</Text> : null}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 16 },
  noticeText: { ...type.callout, color: colors.ink },
  stateLabel: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  stateLabelText: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headline: { ...type.title, color: colors.ink, letterSpacing: -0.4 },
  headlineBody: { ...type.callout, color: colors.inkMuted, marginTop: 8 },
  primary: { marginTop: 20 },
  also: { marginTop: 24 },
  sectionLabel: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  alsoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  alsoDot: { backgroundColor: colors.starFilled },
  alsoText: { ...type.callout, color: colors.ink, flex: 1 },
  alsoTappable: { minHeight: 44, marginTop: 4 },
  tiles: { flexDirection: "row", gap: 12 },
  tile: { ...card, flex: 1, padding: 16, minHeight: 150 },
  tileHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tileLabel: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  tileValueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  tileValue: { ...type.number, color: colors.ink, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  tileStar: { fontSize: 28, lineHeight: 34, color: colors.starFilled },
  tileUnit: { ...type.callout, fontWeight: "600", color: colors.ink, marginTop: 2 },
  tileNote: { ...type.footnote, color: colors.inkMuted, marginTop: 4 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.ink },
  ratingMeta: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  when: { ...type.subhead, color: colors.ink },
  tagLine: { ...type.footnote, color: colors.inkMuted, marginTop: 2, marginLeft: 18 },
  tagStatus: { ...type.callout, color: colors.ink, marginTop: 2 },
  setupHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginHorizontal: 4 },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  stepBadge: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  stepDone: { backgroundColor: colors.successBg },
  stepCurrent: { backgroundColor: colors.ink },
  stepLater: { borderWidth: 1, borderColor: colors.borderLight },
  stepNumber: { fontSize: 13, fontWeight: "600", color: colors.inkMuted },
  stepNumberCurrent: { color: colors.onAction },
  stepText: { flex: 1, paddingTop: 3 },
  stepTitle: { ...type.callout, color: colors.inkMuted },
  stepTitleCurrent: { fontWeight: "600", color: colors.ink },
  stepBody: { ...type.subhead, color: colors.inkMuted, marginTop: 4 },
});
