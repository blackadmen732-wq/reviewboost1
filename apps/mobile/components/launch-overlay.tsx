import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { colors } from "@/theme";

/**
 * The launch screen, after the operating system's one.
 *
 * TWO LAYERS, ON PURPOSE
 * ----------------------
 * iOS draws a launch screen before a single line of this app runs, and it
 * cannot animate: it is a still image. So `app.json` configures that still
 * image as the brand green with the wordmark centred, and this component
 * mounts on top looking exactly the same. The handoff between them is
 * invisible, which is the whole trick — anything that moves has to live here,
 * on the second layer.
 *
 * WHY IT DOES NOT PLAY EVERY TIME
 * -------------------------------
 * Most opens never see this at all: returning to a backgrounded app resumes
 * it, with no launch screen. Only a cold start — first install, after a
 * restart, or once iOS has evicted the app — reaches this code.
 *
 * Even then the full animation runs once, on the very first launch on this
 * device. After that the wordmark simply fades up. A signature is worth
 * watching the first time and is an obstacle by the fifth, and an owner opens
 * this app daily.
 *
 * IT NEVER ADDS WAITING
 * ---------------------
 * The animation runs while the app loads, not before it. `ready` says the
 * tree behind this is mounted; the overlay leaves at the later of "animation
 * finished" and "app ready", and HOLD_CAP stops a slow cold start from
 * stranding anyone on a green screen.
 */

// The first frame must match the still image in app.json exactly, or the
// handoff flickers. Keep these two in step.
const LOGO_WIDTH_RATIO = 0.76; // of screen width
const LOGO_ASPECT = 615 / 203; // the asset's own ratio

const WRITE_MS = 480; // the wordmark writing itself on, first launch only
const FADE_MS = 260; // every cold start after that
const HOLD_MS = 180; // a beat at full size before leaving
const EXIT_MS = 320;
const HOLD_CAP = 2600; // never sit on the green longer than this

const SEEN_KEY = "reviewboost.launch.animated.v1";

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or the module is unavailable in this runtime. Either way
  // the overlay still renders and still leaves; there is nothing to recover.
});

export function LaunchOverlay({ ready }: { ready: boolean }) {
  const { width } = useWindowDimensions();
  const logoWidth = Math.round(width * LOGO_WIDTH_RATIO);
  const logoHeight = Math.round(logoWidth / LOGO_ASPECT);

  const [done, setDone] = useState(false);
  const [plan, setPlan] = useState<"write" | "fade" | null>(null);
  const started = useRef(false);

  // reveal: 0 → 1 uncovers the wordmark left to right, the way it is written.
  const reveal = useSharedValue(0);
  const fade = useSharedValue(0);
  const cover = useSharedValue(1); // the green layer itself
  const lift = useSharedValue(1);

  // Decide which animation this launch gets before anything is drawn, so the
  // first frame is never the wrong one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [seen, reduceMotion] = await Promise.all([
        AsyncStorage.getItem(SEEN_KEY).catch(() => null),
        AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      ]);
      if (cancelled) return;
      // Reduce Motion gets the plain fade; writing is motion, and a launch
      // screen is not the place to argue with that setting.
      setPlan(seen || reduceMotion ? "fade" : "write");
      if (!seen) void AsyncStorage.setItem(SEEN_KEY, "1").catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(() => setDone(true), []);

  // Run once, as soon as the plan is known.
  useEffect(() => {
    if (!plan || started.current) return;
    started.current = true;
    void SplashScreen.hideAsync().catch(() => {});
    if (plan === "write") {
      reveal.value = withTiming(1, { duration: WRITE_MS, easing: Easing.out(Easing.cubic) });
      fade.value = 1;
    } else {
      reveal.value = 1;
      fade.value = withTiming(1, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
    }
  }, [fade, plan, reveal]);

  // Leave at the later of "animation finished" and "app ready", capped.
  useEffect(() => {
    if (!plan) return;
    const entrance = plan === "write" ? WRITE_MS : FADE_MS;
    const earliest = entrance + HOLD_MS;
    const leave = () => {
      lift.value = withTiming(1.09, { duration: EXIT_MS, easing: Easing.in(Easing.quad) });
      cover.value = withTiming(0, { duration: EXIT_MS, easing: Easing.in(Easing.quad) }, (ok) => {
        if (ok) runOnJS(finish)();
      });
    };
    const delay = ready ? earliest : HOLD_CAP;
    const timer = setTimeout(leave, delay);
    return () => clearTimeout(timer);
  }, [cover, finish, lift, plan, ready]);

  const coverStyle = useAnimatedStyle(() => ({
    opacity: cover.value,
    transform: [{ scale: lift.value }],
  }));
  // A window whose width grows; the image inside keeps its full width, so the
  // lettering is uncovered rather than stretched.
  const windowStyle = useAnimatedStyle(() => ({
    width: logoWidth * reveal.value,
    opacity: fade.value,
  }));

  if (done) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.cover, coverStyle]} pointerEvents="none">
      <Animated.View style={[styles.window, { height: logoHeight }, windowStyle]}>
        <Image
          source={require("@/assets/launch-wordmark.png")}
          style={{ width: logoWidth, height: logoHeight }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
      {/* The name, for anyone who cannot see the wordmark. */}
      <View accessible accessibilityRole="image" accessibilityLabel="ReviewBoost" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    alignItems: "center",
    backgroundColor: colors.brand,
    justifyContent: "center",
    zIndex: 100,
  },
  window: { overflow: "hidden" },
});
