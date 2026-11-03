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
import { BrandLockup } from "@/components/brand-lockup";
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
  detected = false,
  copy,
  onPrimary,
  onDismiss,
}: {
  visible: boolean;
  scene: NfcScene;
  /** While writing: the phone has found the chip, so it stays against it. */
  detected?: boolean;
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
          <View style={styles.brand}>
            <BrandLockup height={28} />
          </View>

          <View style={[styles.stage, compact && styles.stageCompact]}>
            <View style={compact ? styles.sceneFrameCompact : styles.sceneFrame}>
              <View style={{ transform: [{ scale: compact ? COMPACT_SCALE : SCENE_SCALE }] }}>
                <NfcFigure scene={scene} detected={detected} reduceMotion={reduceMotion} />
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

/** The picture's own box. The web draws the same scene in the same box. */
const SCENE_W = 300;
const SCENE_H = 380;
const SCENE_SCALE = 0.86;
const COMPACT_SCALE = 0.56;

const TAG_ART = require("../assets/nfc-tag.png");
const PHONE_ART = require("../assets/nfc-phone.png");

/** Where the phone sits, in points: waiting below, against the Tag, gone. */
const PHONE_REST = 14;
const PHONE_LOW = 18;
const PHONE_UP = -32;
const PHONE_GONE = 90;
/** How far the Tag settles once the phone has gone. */
const TAG_SETTLE = 84;

/**
 * The owner's Tag, their phone coming up to it, and what happens between the
 * two: the native twin of `frontend/features/tags/nfc-visuals.tsx`, drawn
 * like Apple's "Hold Near Reader" so nobody has to read a word to know what
 * to do.
 *
 * - ready:    the phone waits below the Tag, breathing a little.
 * - writing:  the phone rises to the Tag and back while waves pulse; once the
 *             chip is found it stays against it, with a spinner on its screen.
 * - success:  the phone drops away, the Tag rings green, a check draws.
 * - error:    a red mark, and the phone shakes once.
 * - conflict, partial: an amber mark. Each needs the owner to decide.
 *
 * Blue while it works, green when it worked, amber when it needs the owner,
 * red when it failed (DESIGN.md §3.3). Nothing measures anything: NFC reports
 * no distance and no progress. The Tag and the phone are images
 * (`scripts/brand/generate-nfc-art.mjs`): no SVG library, so no new native
 * module and no new build for two drawings. Under Reduce Motion every scene is
 * shown still and finished.
 */
function NfcFigure({
  scene,
  detected,
  reduceMotion,
}: {
  scene: NfcScene;
  detected: boolean;
  reduceMotion: boolean;
}) {
  const tone =
    scene === "success"
      ? colors.brand
      : scene === "error"
        ? colors.danger
        : scene === "conflict" || scene === "partial"
          ? colors.warning
          : colors.info;
  const mark = scene === "success" || scene === "partial" ? "check" : scene === "error" || scene === "conflict" ? "alert" : null;
  const looking = scene === "writing" && !detected;
  const found = scene === "writing" && detected;

  const phoneY = useRef(new Animated.Value(PHONE_REST)).current;
  const phoneX = useRef(new Animated.Value(0)).current;
  const phoneOpacity = useRef(new Animated.Value(1)).current;
  const tagY = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(1)).current;
  const badge = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const waves = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  // Where everything is, and how it moves, for this scene.
  useEffect(() => {
    const running: Animated.CompositeAnimation[] = [];
    const run = (animation: Animated.CompositeAnimation) => {
      running.push(animation);
      animation.start();
    };
    const settle = (value: Animated.Value, toValue: number, duration = 300) =>
      reduceMotion
        ? value.setValue(toValue)
        : run(Animated.timing(value, { toValue, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }));
    const spring = (value: Animated.Value, toValue: number) =>
      reduceMotion
        ? value.setValue(toValue)
        : run(Animated.spring(value, { toValue, speed: 14, bounciness: 9, useNativeDriver: true }));

    const success = scene === "success";
    const answered = mark !== null;

    // The phone.
    phoneX.setValue(0);
    if (success) {
      settle(phoneY, PHONE_GONE, 450);
      settle(phoneOpacity, 0, 350);
    } else {
      phoneOpacity.setValue(1);
      if (found || (looking && reduceMotion)) spring(phoneY, PHONE_UP);
      else if (looking) {
        run(
          Animated.loop(
            Animated.sequence([
              Animated.timing(phoneY, { toValue: PHONE_UP, duration: 1080, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.delay(600),
              Animated.timing(phoneY, { toValue: PHONE_LOW, duration: 720, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
          ),
        );
      } else if (scene === "ready" && !reduceMotion) {
        phoneY.setValue(PHONE_REST);
        run(
          Animated.loop(
            Animated.sequence([
              Animated.timing(phoneY, { toValue: PHONE_REST - 8, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.timing(phoneY, { toValue: PHONE_REST, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
          ),
        );
      } else settle(phoneY, PHONE_REST);
    }
    if (scene === "error" && !reduceMotion) {
      // One shake, the way a phone says "no". It does not repeat.
      run(
        Animated.sequence(
          [-9, 8, -6, 4, 0].map((toValue) =>
            Animated.timing(phoneX, { toValue, duration: 90, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ),
        ),
      );
    }

    // The Tag settles into the middle once the phone has gone.
    if (success) spring(tagY, TAG_SETTLE);
    else settle(tagY, 0);
    settle(ring, success ? 1 : 0, 250);

    // The answer over the Tag.
    if (answered) {
      badge.setValue(reduceMotion ? 1 : 0);
      spring(badge, 1);
    } else badge.setValue(0);

    // The waves between the phone and the Tag, and the halo behind it all.
    waves.forEach((value) => value.setValue(found || (looking && reduceMotion) ? 0.85 : 0));
    halo.setValue(1);
    if (looking && !reduceMotion) {
      waves.forEach((value, index) =>
        run(
          Animated.loop(
            Animated.sequence([
              Animated.delay(index * 250),
              Animated.timing(value, { toValue: 1, duration: 1500, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
              Animated.delay((2 - index) * 250),
            ]),
          ),
        ),
      );
      run(
        Animated.loop(
          Animated.sequence([
            Animated.timing(halo, { toValue: 1.06, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(halo, { toValue: 0.94, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        ),
      );
    }

    // The phone's screen while it writes.
    spin.setValue(0);
    if (found && !reduceMotion) {
      run(Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true })));
    }

    return () => running.forEach((animation) => animation.stop());
  }, [badge, found, halo, looking, mark, phoneOpacity, phoneX, phoneY, reduceMotion, ring, scene, spin, tagY, waves]);

  const badgeScale = badge.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.scene} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View
        style={[styles.halo, { backgroundColor: tint(tone, 0.07), transform: [{ scale: halo }] }]}
      >
        <View style={[styles.haloInner, { backgroundColor: tint(tone, 0.08) }]} />
      </Animated.View>

      <Animated.View style={[styles.tagWrap, { transform: [{ translateY: tagY }] }]}>
        <Animated.View style={[styles.tagRing, { opacity: ring }]} />
        <View style={styles.tagShadow}>
          <Image source={TAG_ART} style={styles.tagArt} accessibilityIgnoresInvertColors />
        </View>
      </Animated.View>

      {[18, 30, 42].map((radius, index) => {
        const cy = 178 - index * 4;
        const value = waves[index] as Animated.Value;
        const scale = looking && !reduceMotion ? value.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] }) : 1;
        const opacity = looking && !reduceMotion
          ? value.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] })
          : value;
        return (
          <Animated.View
            key={radius}
            style={[
              styles.wave,
              {
                left: 150 - radius,
                top: cy - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: radius,
                borderTopColor: tone,
                borderRightColor: tone,
                opacity,
                transform: [{ translateY: radius }, { scale }, { translateY: -radius }, { rotate: "-45deg" }],
              },
            ]}
          />
        );
      })}

      <Animated.View
        style={[
          styles.phone,
          {
            opacity: phoneOpacity,
            transform: [{ translateX: phoneX }, { translateY: phoneY }, { rotate: "-6deg" }],
          },
        ]}
      >
        <Image source={PHONE_ART} style={styles.phoneArt} accessibilityIgnoresInvertColors />
        {found ? (
          <View style={styles.spinnerBox}>
            <View style={styles.spinnerTrack} />
            {reduceMotion ? (
              <View style={[styles.spinnerTrack, { borderColor: colors.info }]} />
            ) : (
              <Animated.View style={[styles.spinnerArc, { transform: [{ rotate }] }]} />
            )}
          </View>
        ) : null}
      </Animated.View>

      <Animated.View
        style={[
          styles.badge,
          { backgroundColor: tone, opacity: badge, transform: [{ translateY: tagY }, { scale: badgeScale }] },
        ]}
      >
        {mark === "check" ? <Check reduceMotion={reduceMotion} /> : null}
        {mark === "alert" ? (
          <>
            <View style={styles.alertBar} />
            <View style={styles.alertDot} />
          </>
        ) : null}
      </Animated.View>

      {scene === "success" && !reduceMotion ? <Sparks /> : null}
    </View>
  );
}

/** The tick draws itself, A to B then B to C, once. */
function Check({ reduceMotion }: { reduceMotion: boolean }) {
  const short = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const long = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const draw = Animated.sequence([
      Animated.delay(200),
      Animated.timing(short, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(long, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    draw.start();
    return () => draw.stop();
  }, [long, reduceMotion, short]);
  return (
    <View style={styles.checkBox}>
      <Animated.View style={[styles.stroke, { left: 6, top: 19, width: 16, transform: [{ rotate: "45deg" }, { scaleX: short }] }]} />
      <Animated.View style={[styles.stroke, { left: 17, top: 30, width: 30, transform: [{ rotate: "-47deg" }, { scaleX: long }] }]} />
    </View>
  );
}

/** Where each spark travels from the badge. They fly once and fade; nothing loops. */
const SPARKS: ReadonlyArray<readonly [number, number]> = [
  [-70, -36],
  [-44, -70],
  [0, -84],
  [46, -68],
  [72, -32],
  [-82, 12],
  [84, 14],
  [0, 46],
];

function Sparks() {
  const burst = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const fly = Animated.sequence([
      Animated.delay(250),
      Animated.timing(burst, { toValue: 1, duration: 800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    fly.start();
    return () => fly.stop();
  }, [burst]);
  return (
    <>
      {SPARKS.map(([dx, dy], index) => (
        <Animated.View
          key={index}
          style={[
            styles.spark,
            index % 2 === 1 && styles.sparkGold,
            {
              opacity: burst.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateY: TAG_SETTLE },
                { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
                { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) },
              ],
            },
          ]}
        />
      ))}
    </>
  );
}

/** A hex colour at an alpha, for the soft halo. */
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
    paddingVertical: 8,
  },
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

  scene: { width: SCENE_W, height: SCENE_H },
  sceneFrame: { width: SCENE_W * SCENE_SCALE, height: SCENE_H * SCENE_SCALE, alignItems: "center", justifyContent: "center" },
  sceneFrameCompact: { width: SCENE_W * COMPACT_SCALE, height: SCENE_H * COMPACT_SCALE, alignItems: "center", justifyContent: "center" },
  halo: {
    position: "absolute",
    left: 10,
    top: 0,
    width: 280,
    height: 280,
    borderRadius: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  haloInner: { width: 196, height: 196, borderRadius: 98 },
  tagWrap: { position: "absolute", left: 56, top: 16, width: 188, height: 124 },
  tagRing: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 188,
    height: 124,
    borderRadius: 24,
    borderWidth: 4,
    borderColor: colors.brand,
  },
  tagShadow: {
    position: "absolute",
    left: 4,
    top: 4,
    width: 180,
    height: 116,
    borderRadius: 20,
    backgroundColor: colors.white,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  tagArt: { width: 180, height: 116 },
  wave: {
    position: "absolute",
    borderWidth: 5,
    borderColor: "transparent",
  },
  phone: {
    position: "absolute",
    left: 98,
    top: 168,
    width: 104,
    height: 204,
    // Rounded like the phone, so the shadow is too wherever it is drawn as a box.
    borderRadius: 26,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 14 },
  },
  phoneArt: { width: 104, height: 204 },
  spinnerBox: { position: "absolute", left: 22, top: 72, width: 60, height: 60 },
  spinnerTrack: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 5,
    borderColor: "#e3ecf6",
  },
  spinnerArc: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 5,
    borderColor: "transparent",
    borderTopColor: colors.info,
  },
  badge: {
    position: "absolute",
    left: 114,
    top: 42,
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
  },
  checkBox: { width: 52, height: 52 },
  stroke: {
    position: "absolute",
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.canvas,
    transformOrigin: "left center",
  },
  alertBar: { width: 8, height: 22, borderRadius: 4, backgroundColor: colors.canvas },
  alertDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.canvas, marginTop: 6 },
  spark: {
    position: "absolute",
    left: 150 - 4.5,
    top: 78 - 4.5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.brand,
  },
  sparkGold: { backgroundColor: colors.starFilled, width: 7, height: 7, borderRadius: 3.5, left: 150 - 3.5, top: 78 - 3.5 },
});
