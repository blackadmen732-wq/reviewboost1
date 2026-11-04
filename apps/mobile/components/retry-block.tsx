import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { recoveryWords as words } from "@/data/recovery";
import { useAutoRetry } from "@/data/use-auto-retry";
import { colors, radii, type } from "@/theme";

/**
 * A screen that could not load: what failed, then that it is trying again by
 * itself (3 s, 10 s, 30 s, counting down) with "Try now", or, offline, that
 * it will try when the connection is back. Nobody has to keep tapping.
 *
 * `compact`: the screen still shows what it had (a refresh failed, the old
 * list is on screen), so this is one quiet line above it rather than a block
 * in its place, and its button is the quiet kind.
 */
export function RetryBlock({
  message,
  retryKey,
  onRetry,
  compact = false,
}: {
  /** What failed, as the screen's loader said it. */
  message: string;
  /** What failed, so the count of tries survives the screen reloading. */
  retryKey: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const retry = useAutoRetry({ key: retryKey, failure: message, onRetry });
  const line =
    retry.phase === "offline"
      ? words.offlineTry
      : retry.phase === "stopped"
        ? words.stoppedBody
        : retry.phase === "retrying"
          ? words.retrying
          : words.retryingIn(retry.secondsLeft);
  if (compact) {
    return (
      <View style={styles.compact}>
        <Text
          style={styles.compactLine}
          accessibilityLabel={`${message} ${retry.phase === "waiting" ? words.retryingSoon : line}`}
        >
          {message} {line}
        </Text>
        <Button
          label={retry.phase === "stopped" ? words.tryAgain : words.tryNow}
          variant="quiet"
          busy={retry.phase === "retrying"}
          busyLabel={words.retrying}
          onPress={retry.retryNow}
        />
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <Text style={styles.message}>{message}</Text>
      {/* VoiceOver reads one steady sentence, not a number that changes. */}
      <Text
        style={styles.line}
        accessibilityLabel={retry.phase === "waiting" ? words.retryingSoon : line}
      >
        {line}
      </Text>
      <Button
        label={retry.phase === "stopped" ? words.tryAgain : words.tryNow}
        busy={retry.phase === "retrying"}
        busyLabel={words.retrying}
        onPress={retry.retryNow}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12, paddingVertical: 24 },
  message: { ...type.subhead, color: colors.ink },
  line: { ...type.subhead, color: colors.inkMuted },
  compact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: radii.control,
    backgroundColor: colors.infoBg,
  },
  compactLine: { ...type.subhead, color: colors.ink, flex: 1, paddingVertical: 10 },
});
