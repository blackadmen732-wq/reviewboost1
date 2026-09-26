import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import type { NfcScene, SceneCopy } from "@/lib/nfc-scenes";
import { colors } from "@/theme";

/**
 * Programming a Tag, full screen — the native twin of the web sheet.
 *
 * Top to bottom: the logo, one large figure, a title and one sentence, and the
 * actions low enough for a thumb. It reads like a payment or pairing sheet
 * rather than a settings dialog, because to the owner that is what it is: hold
 * something near the phone until it says it worked.
 *
 * The figure is drawn with plain views and the core Animated API. No SVG
 * library: adding a native module means a new build of the app for the sake
 * of five circles.
 *
 * This file decides nothing about when a Tag is read or written. The screen
 * that opens it owns the machine; this only draws the scene it is given.
 */
export function NfcProgramSheet({
  visible,
  scene,
  copy,
  onPrimary,
  onDismiss,
}: {
  visible: boolean;
  scene: NfcScene;
  copy: SceneCopy;
  onPrimary: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const controls = scene !== "success";
  // Short phones get a smaller figure, so even the longest message fits
  // without scrolling. The figure is drawn once at full size and scaled.
  const { height } = useWindowDimensions();
  const compact = height < 640;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      // Android's back button is a Cancel wherever Cancel is offered, and
      // nothing at all on the success check, which leaves on its own.
      onRequestClose={() => {
        if (controls && copy.dismiss) onDismiss();
      }}
    >
      {/* A modal renders outside the app's root, so it needs its own provider
          for the safe-area insets to be measured at all. */}
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
          {/* Ordinary scenes fit and never scroll. A longer exception message
              on a small phone may, rather than squeezing the figure. */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.brand} accessible accessibilityLabel="ReviewBoost">
            {/* A raster of the canonical mark (frontend/components/brand/
                logo-mark.tsx), made by scripts/brand/render-native-logo-mark.mjs.
                Regenerate it there; never edit the PNGs by hand. */}
            <Image
              source={require("../assets/logo-mark.png")}
              style={styles.mark}
              accessibilityIgnoresInvertColors
            />
            <Text style={styles.word} importantForAccessibility="no">
              Review<Text style={styles.wordAccent}>Boost</Text>
            </Text>
          </View>

          <View style={[styles.stage, compact && styles.stageCompact]}>
            <View style={compact ? styles.figureCompact : undefined}>
              <View style={compact ? { transform: [{ scale: COMPACT_SCALE }] } : undefined}>
                <NfcFigure scene={scene} reduceMotion={reduceMotion} />
              </View>
            </View>
            <View style={styles.words}>
              <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">
                {copy.title}
              </Text>
              {copy.body ? <Text style={styles.body}>{copy.body}</Text> : null}
            </View>
          </View>

          <View style={styles.actions}>
            {controls && copy.action ? (
              <Pressable
                accessibilityRole="button"
                onPress={onPrimary}
                style={({ pressed }) => [styles.button, styles.primary, pressed && styles.primaryPressed]}
              >
                <Text style={styles.primaryText}>{copy.action}</Text>
              </Pressable>
            ) : null}
            {controls && copy.dismiss ? (
              <Pressable
                accessibilityRole="button"
                onPress={onDismiss}
                style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.secondaryPressed]}
              >
                <Text style={styles.secondaryText}>{copy.dismiss}</Text>
              </Pressable>
            ) : null}
          </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (live) setReduce(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}

const FIGURE = 220;
const COMPACT_SCALE = 0.7;

/**
 * Soft rings, a white disc, and inside it the contactless symbol, a check or a
 * warning. While writing, an arc turns around the disc without ever filling:
 * NFC reports no distance and no progress, so nothing here may creep toward
 * "done".
 */
function NfcFigure({ scene, reduceMotion }: { scene: NfcScene; reduceMotion: boolean }) {
  const tone =
    scene === "error" ? colors.danger : scene === "conflict" ? colors.inkMuted : colors.brand;
  const mark = scene === "success" ? "check" : scene === "error" ? "alert" : "waves";

  return (
    <View style={styles.figure} importantForAccessibility="no-hide-descendants">
      {/* Keyed by the mark, so the entrance plays when the mark changes. */}
      <Rings key={mark} tone={tone} reduceMotion={reduceMotion} fade={mark === "alert"} />
      <View style={styles.disc} />
      {mark === "waves" ? (
        <>
          <Spinner active={scene === "writing"} reduceMotion={reduceMotion} />
          <Waves tone={tone} active={scene === "writing"} reduceMotion={reduceMotion} />
        </>
      ) : null}
      {mark === "check" ? <Check reduceMotion={reduceMotion} /> : null}
      {mark === "alert" ? <Alert /> : null}
    </View>
  );
}

function Rings({ tone, reduceMotion, fade }: { tone: string; reduceMotion: boolean; fade: boolean }) {
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: fade ? 220 : 420,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [enter, fade, reduceMotion]);

  const scale = fade ? 1 : enter.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.centre, { opacity: enter, transform: [{ scale }] }]}>
      <View style={[styles.ring, { width: FIGURE, height: FIGURE, backgroundColor: tint(tone, 0.07) }]} />
      <View style={[styles.ring, { width: 176, height: 176, backgroundColor: tint(tone, 0.09) }]} />
    </Animated.View>
  );
}

/** A quarter arc that turns. Under reduced motion, a still full ring instead. */
function Spinner({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || reduceMotion) return undefined;
    turn.setValue(0);
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, turn]);

  if (!active) return null;

  if (reduceMotion) {
    return <View style={[styles.spinner, { borderColor: tint(colors.brand, 0.5) }]} />;
  }

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View
      style={[
        styles.spinner,
        { borderColor: "transparent", borderTopColor: colors.brand, transform: [{ rotate }] },
      ]}
    />
  );
}

/** Three arcs opening to the right, the contactless symbol. */
function Waves({ tone, active, reduceMotion }: { tone: string; active: boolean; reduceMotion: boolean }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(1))).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      values.forEach((value) => value.setValue(1));
      return undefined;
    }
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 180),
          Animated.timing(value, { toValue: 0.28, duration: 560, useNativeDriver: true }),
          Animated.timing(value, { toValue: 1, duration: 680, useNativeDriver: true }),
          Animated.delay((2 - index) * 180),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [active, reduceMotion, values]);

  return (
    <View style={styles.wavesCentre}>
      {[16, 30, 44].map((radius, index) => (
        <Animated.View
          key={radius}
          style={[
            styles.wave,
            {
              left: -radius,
              top: -radius,
              width: radius * 2,
              height: radius * 2,
              borderRadius: radius,
              borderRightColor: tone,
              opacity: values[index],
            },
          ]}
        />
      ))}
    </View>
  );
}

/** The check: its circle settles in, then the tick draws itself, once. */
function Check({ reduceMotion }: { reduceMotion: boolean }) {
  const ring = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const short = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const long = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const specks = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(short, { toValue: 1, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(long, { toValue: 1, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.delay(360),
      Animated.timing(specks, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [long, reduceMotion, ring, short, specks]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const speckOpacity = specks.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.9, 0] });

  return (
    <>
      {!reduceMotion
        ? SPECKS.map(([x, y, size], index) => (
            <Animated.View
              key={index}
              style={[
                styles.speck,
                { left: x, top: y, width: size, height: size, borderRadius: size / 2, opacity: speckOpacity },
              ]}
            />
          ))
        : null}
      <Animated.View style={[styles.checkRing, { opacity: ring, transform: [{ scale: ringScale }] }]}>
        {/* Two strokes from the tick's corners, each growing from its start
            point — A to B, then B to C — so the check draws rather than pops. */}
        <Animated.View
          style={[
            styles.stroke,
            { left: 28, top: 51 - 4.5, width: 23, transform: [{ rotate: "45deg" }, { scaleX: short }] },
          ]}
        />
        <Animated.View
          style={[
            styles.stroke,
            { left: 44, top: 67 - 4.5, width: 43, transform: [{ rotate: "-46deg" }, { scaleX: long }] },
          ]}
        />
      </Animated.View>
    </>
  );
}

/** Quiet: it fades in with the rings. It does not shake. */
function Alert() {
  return (
    <View style={styles.alertRing}>
      <View style={styles.alertBar} />
      <View style={styles.alertDot} />
    </View>
  );
}

const SPECKS: ReadonlyArray<readonly [number, number, number]> = [
  [44, 66, 7],
  [172, 58, 5],
  [186, 132, 7],
  [36, 146, 5],
  [132, 184, 7],
  [80, 26, 5],
];

/** A hex colour at an alpha, for the soft rings. */
function tint(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  mark: { width: 31, height: 28 },
  word: { fontSize: 18, fontWeight: "600", letterSpacing: -0.3, color: colors.ink },
  wordAccent: { color: colors.brandText },
  // Grows into the space between the logo and the actions, and never
  // shrinks below its content: a figure squeezed to nothing is worse than a
  // screen that scrolls.
  stage: {
    flexGrow: 1,
    flexShrink: 0,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
  },
  stageCompact: { gap: 18, paddingVertical: 8 },
  figureCompact: {
    width: FIGURE * COMPACT_SCALE,
    height: FIGURE * COMPACT_SCALE,
    alignItems: "center",
    justifyContent: "center",
  },
  words: { alignItems: "center", gap: 10, paddingHorizontal: 8 },
  title: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.ink,
    textAlign: "center",
  },
  body: {
    maxWidth: 300,
    fontSize: 17,
    lineHeight: 24,
    color: colors.inkMuted,
    textAlign: "center",
  },
  actions: {
    gap: 10,
    // The same height with or without buttons, so the figure does not jump
    // when the success scene removes them.
    minHeight: 118,
    justifyContent: "flex-end",
  },
  button: {
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.action },
  primaryPressed: { backgroundColor: colors.actionPressed },
  primaryText: { color: colors.onAction, fontSize: 17, fontWeight: "600" },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  secondaryPressed: { backgroundColor: colors.surfaceAlt },
  secondaryText: { color: colors.ink, fontSize: 17, fontWeight: "600" },

  figure: { width: FIGURE, height: FIGURE, alignItems: "center", justifyContent: "center" },
  centre: { alignItems: "center", justifyContent: "center" },
  // Absolutely placed children without insets are centred by the parent.
  ring: {
    position: "absolute",
    borderRadius: 999,
  },
  disc: {
    position: "absolute",
    width: 144,
    height: 144,
    borderRadius: 72,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  spinner: {
    position: "absolute",
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 4,
  },
  // All three arcs share one centre, set a little left of the disc's, so the
  // symbol as a whole sits in the middle.
  wavesCentre: {
    position: "absolute",
    left: FIGURE / 2 - 14,
    top: FIGURE / 2,
    width: 0,
    height: 0,
  },
  wave: {
    position: "absolute",
    borderWidth: 9,
    borderColor: "transparent",
  },
  checkRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 7,
    borderColor: colors.brand,
  },
  stroke: {
    position: "absolute",
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.brand,
    transformOrigin: "left center",
    // The ring's border offsets its children; the tick is placed in the
    // ring's outer box, so pull it back by the border width.
    marginLeft: -7,
    marginTop: -7,
  },
  speck: { position: "absolute", backgroundColor: colors.brand },
  alertRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 6,
    borderColor: colors.danger,
    backgroundColor: colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  alertBar: { width: 9, height: 30, borderRadius: 4.5, backgroundColor: colors.danger },
  alertDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
});
