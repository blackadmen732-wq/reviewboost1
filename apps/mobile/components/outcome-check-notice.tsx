import { useId } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { RECHECK_SECONDS, recoveryWords as words } from "@/data/recovery";
import { useAutoRetry } from "@/data/use-auto-retry";
import type { OutcomeCheck } from "@/data/use-outcome-check";
import { colors, radii, type } from "@/theme";

/**
 * What the owner sees while the app finds out whether a change went through:
 * "Checking whether that went through…", then, if ReviewBoost could not be
 * reached, a countdown to checking again with "Check now". Nothing here asks
 * the owner to go and look.
 */
export function OutcomeCheckNotice({ check }: { check: OutcomeCheck }) {
  if (check.phase === "idle") return null;
  if (check.unanswered === 0) {
    return (
      <View style={styles.checking} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.inkMuted} />
        <Text style={styles.line}>{words.checking}</Text>
      </View>
    );
  }
  return <Unanswered check={check} />;
}

function Unanswered({ check }: { check: OutcomeCheck }) {
  const id = useId();
  const auto = useAutoRetry({
    key: `outcome-check:${id}`,
    failure: check.unanswered,
    onRetry: check.checkNow,
    delays: RECHECK_SECONDS,
  });
  const checking = check.phase === "checking";
  if (checking) {
    // Said once, with the spinner: a busy "Checking again…" button under a
    // "Checking again…" line said it twice.
    return (
      <View style={[styles.notice, styles.checkingRow]} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.inkMuted} />
        <Text style={styles.line}>{words.checkingAgain}</Text>
      </View>
    );
  }
  const line =
    auto.phase === "offline"
      ? words.offlineCheck
      : auto.phase === "stopped"
        ? words.stillNoAnswer
        : words.noAnswerIn(auto.secondsLeft);
  return (
    <View style={styles.notice}>
      <Text style={styles.line} accessibilityLabel={auto.phase === "waiting" ? words.noAnswerSoon : line}>
        {line}
      </Text>
      {/* Secondary: the app checks again by itself, so this only skips the
          wait. The screen's one black button stays its own. */}
      <Button
        label={auto.phase === "stopped" ? words.checkAgain : words.checkNow}
        variant="secondary"
        onPress={auto.retryNow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  checking: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  checkingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  notice: {
    gap: 12,
    padding: 16,
    borderRadius: radii.control,
    backgroundColor: colors.infoBg,
  },
  line: { ...type.subhead, color: colors.ink, flexShrink: 1 },
});
