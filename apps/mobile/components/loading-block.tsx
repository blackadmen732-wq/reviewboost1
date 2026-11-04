import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { recoveryWords, STILL_WORKING_AFTER_MS } from "@/data/recovery";
import { colors, type } from "@/theme";

/**
 * A screen on its way: the spinner and what it is loading ("Loading your
 * Tags…"), then "Still working…" once it has taken four seconds, the way a
 * busy button does. A bare spinner on a slow connection looked frozen, and
 * with Reduce Motion it does not even turn.
 */
export function LoadingBlock({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  const words = slow ? recoveryWords.stillWorking : label;
  return (
    <View style={styles.block} accessibilityRole="progressbar" accessibilityLabel={words} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.inkMuted} />
      <Text style={styles.label}>{words}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { alignItems: "center", gap: 12, paddingVertical: 40 },
  label: { ...type.callout, color: colors.inkMuted, textAlign: "center" },
});
