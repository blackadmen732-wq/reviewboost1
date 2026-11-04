import { StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { recoveryWords as words } from "@/data/recovery";
import { useAutoRetry } from "@/data/use-auto-retry";
import { colors, type } from "@/theme";

/**
 * A screen that could not load: what failed, then that it is trying again by
 * itself (3 s, 10 s, 30 s, counting down) with "Try now", or, offline, that
 * it will try when the connection is back. Nobody has to keep tapping.
 */
export function RetryBlock({
  message,
  retryKey,
  onRetry,
}: {
  /** What failed, as the screen's loader said it. */
  message: string;
  /** What failed, so the count of tries survives the screen reloading. */
  retryKey: string;
  onRetry: () => void;
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
        variant="secondary"
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
});
