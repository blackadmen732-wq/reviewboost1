import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useOnline } from "@/data/connection";
import { recoveryWords as words } from "@/data/recovery";
import { colors, radii, type } from "@/theme";

/** How long "Back online." stays before the bar goes. */
const BACK_ONLINE_MS = 3_000;

/**
 * A bar while ReviewBoost cannot be reached, so a failure is explained before
 * the owner taps into it: nothing saves offline. When the connection comes
 * back it says "Back online." for three seconds, and what failed tries again
 * by itself.
 */
export function OfflineBar() {
  const online = useOnline();
  const [wasOffline, setWasOffline] = useState(false);
  const [back, setBack] = useState(false);
  if (!online && !wasOffline) {
    setWasOffline(true);
    setBack(false);
  }
  if (online && wasOffline) {
    setWasOffline(false);
    setBack(true);
  }

  useEffect(() => {
    if (!back) return;
    const timer = setTimeout(() => setBack(false), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [back]);

  if (online && !back) return null;
  return (
    <View style={styles.bar} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={styles.text}>{online ? words.backOnline : words.offlineBanner}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.control,
    backgroundColor: colors.infoBg,
  },
  text: { ...type.subhead, color: colors.ink, textAlign: "center" },
});
