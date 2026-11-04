import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tappable } from "@/components/tappable";
import { BrandLockup } from "@/components/brand-lockup";
import { Button } from "@/components/button";
import { OfflineBar } from "@/components/offline-bar";
import { useAuth } from "@/data/auth-context";
import { takeDeletionNotice } from "@/data/farewell";
import { EMAIL_INCOMPLETE_MESSAGE, isCompleteEmail } from "@/data/send-code";
import {
  availableSocialProviders,
  signInWithApple,
  signInWithGoogle,
  type SocialProvider,
  type SocialResult,
} from "@/data/social-sign-in";
import * as Linking from "expo-linking";
import { PUBLIC_LINKS } from "@/data/public-links";
import { colors, radii, fonts, type } from "@/theme";

const TERMS_URL = PUBLIC_LINKS.find((link) => link.key === "terms")!.url;
const PRIVACY_URL = PUBLIC_LINKS.find((link) => link.key === "privacy")!.url;

const RESEND_SECONDS = 30;
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // After a deletion, the one line that says what was deleted, once.
  const [farewell] = useState<string | null>(() => takeDeletionNotice());
  const [submitting, setSubmitting] = useState(false);
  /** A sign-in in flight: a typed and an autofilled code never both go. */
  const verifying = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const codeField = useRef<TextInput>(null);
  const { sendCode, verifyCode, sessionError } = useAuth();
  const router = useRouter();
  // The back link sits under the status bar / Dynamic Island on every
  // iPhone, rather than at a fixed 64pt that only fits some of them.
  const insets = useSafeAreaInsets();
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [socialBusy, setSocialBusy] = useState<SocialProvider | null>(null);

  useEffect(() => {
    let live = true;
    void availableSocialProviders().then((list) => {
      if (live) setProviders(list);
    });
    return () => {
      live = false;
    };
  }, []);

  const handleSocial = async (provider: SocialProvider) => {
    if (socialBusy || submitting) return;
    setError(null);
    setSocialBusy(provider);
    let result: SocialResult;
    try {
      result = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
    } catch {
      result = { kind: "failed", message: "That sign-in didn't finish. Try again, or use your email." };
    } finally {
      setSocialBusy(null);
    }
    if (result.kind === "signedIn") router.replace("/select-org");
    else if (result.kind === "failed") setError(result.message);
  };

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Not pre-disabled past an "@": tapping Continue says what is missing.
  const canSubmitEmail = email.includes("@") && !submitting;
  const canSubmitCode = code.length === CODE_LENGTH && !submitting;

  const handleSendCode = async () => {
    if (!canSubmitEmail) return;
    const address = email.trim().toLowerCase();
    // "you@example" would send a code nowhere and wait for it forever.
    if (!isCompleteEmail(address)) {
      setError(EMAIL_INCOMPLETE_MESSAGE);
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const result = await sendCode(address);
      if (result.kind === "failed") {
        setError(result.message);
        return;
      }
      setEmail(address);
      setCode("");
      setStep("code");
      if (result.kind === "throttled") setError(result.message);
      setSecondsLeft(RESEND_SECONDS);
      setTimeout(() => codeField.current?.focus(), 100);
    } catch {
      setError("We could not send the code. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await sendCode(email);
      if (result.kind !== "sent") {
        setError(result.message);
        if (result.kind === "throttled") setSecondsLeft(RESEND_SECONDS);
        return;
      }
      setCode("");
      setSecondsLeft(RESEND_SECONDS);
    } catch {
      setError("We could not send the code. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * `typed` is the code as it is right now: the six digits that just arrived
   * from typing, pasting or the keyboard's one-time-code suggestion are
   * signed in at once, before React has stored them.
   */
  const handleVerify = async (typed: string = code) => {
    if (typed.length !== CODE_LENGTH || verifying.current) return;
    verifying.current = true;
    setError(null);
    setSubmitting(true);

    try {
      const result = await verifyCode(email, typed);
      if (result.kind === "signed-in") {
        router.replace("/select-org");
        return;
      }
      setError(result.message);
      // A refused code is cleared to type again. Offline, slow or down, the
      // code is still good, so it stays.
      if (result.kind === "wrong") setCode("");
      codeField.current?.focus();
    } catch {
      setError("We could not check the code. Your code still works.");
      codeField.current?.focus();
    } finally {
      verifying.current = false;
      setSubmitting(false);
    }
  };

  if (step === "code") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.inner, { paddingTop: insets.top + 8 }]}>
          <Tappable
            kind="row"
            style={styles.backButton}
            onPress={() => {
              setStep("email");
              setError(null);
              setCode("");
            }}
            accessibilityRole="button"
          >
            <Text style={styles.backText}>← Use a different email</Text>
          </Tappable>

          <OfflineBar />
          <Text style={styles.title} accessibilityRole="header">
            Check your email
          </Text>
          <Text style={styles.subtitle}>
            We sent a {CODE_LENGTH}-digit code to {email}
          </Text>

          {sessionError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{sessionError}</Text>
            </View>
          )}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TextInput
            ref={codeField}
            style={[styles.input, styles.codeInput]}
            placeholder="000000"
            placeholderTextColor={colors.inkFaint}
            value={code}
            onChangeText={(value) => {
              const next = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
              setCode(next);
              if (error) setError(null);
              // Six digits is the whole code: signing in is the only next step.
              if (next.length === CODE_LENGTH) void handleVerify(next);
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="go"
            onSubmitEditing={() => void handleVerify()}
            maxLength={CODE_LENGTH}
            editable={!submitting}
          />

          <Button
            label="Sign in"
            busy={submitting}
            busyLabel="Signing in…"
            disabled={!canSubmitCode}
            onPress={() => void handleVerify()}
            style={styles.buttonSpacing}
          />

          <Tappable
            style={styles.resendButton}
            onPress={handleResend}
            disabled={secondsLeft > 0 || submitting}
            accessibilityRole="button"
          >
            <Text
              style={[
                styles.resendText,
                secondsLeft > 0 && styles.resendDisabled,
              ]}
            >
              {secondsLeft > 0
                ? `Send a new code in ${secondsLeft}s`
                : "Send a new code"}
            </Text>
          </Tappable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[styles.inner, { paddingTop: insets.top + 12 }]}>
        <View style={styles.brand}>
          <BrandLockup height={30} />
        </View>
        {/* The website's sign-in words: one page for new and returning owners. */}
        <Text style={styles.title} accessibilityRole="header">
          Get started
        </Text>
        <Text style={styles.subtitle}>
          Use your business email. We will send you a code to sign in. No
          password to remember.
        </Text>

        <OfflineBar />
        {farewell ? (
          <View style={styles.doneBox}>
            <Text style={styles.doneText} accessibilityLiveRegion="polite">
              {farewell}
            </Text>
          </View>
        ) : null}

        {sessionError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {sessionError}
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.fieldLabel} nativeID="email-label">
          Email
        </Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Email"
          accessibilityLabelledBy="email-label"
          placeholder="you@yourbusiness.com"
          placeholderTextColor={colors.inkFaint}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (error === EMAIL_INCOMPLETE_MESSAGE) setError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          returnKeyType="go"
          onSubmitEditing={() => void handleSendCode()}
          editable={!submitting}
        />

        <Button
          label="Continue"
          busy={submitting}
          busyLabel="Sending code…"
          disabled={!canSubmitEmail}
          onPress={() => void handleSendCode()}
          style={styles.buttonSpacing}
        />

        {providers.length > 0 ? (
          <View style={styles.social}>
            <View style={styles.divider} accessible={false}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            {providers.includes("apple") ? (
              // Apple's own button, first and in solid black: Apple's required
              // styling (Guideline 4.8, HIG), the same height as the others.
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={radii.control}
                style={[styles.appleButton, socialBusy !== null && styles.buttonDisabled]}
                onPress={() => void handleSocial("apple")}
              />
            ) : null}

            {providers.includes("google") ? (
              <Tappable
                style={[styles.googleButton, socialBusy !== null && styles.buttonDisabled]}
                onPress={() => void handleSocial("google")}
                disabled={socialBusy !== null}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
              >
                {socialBusy === "google" ? (
                  <ActivityIndicator color={colors.ink} />
                ) : (
                  <>
                    <Image
                      source={require("../assets/google-g.png")}
                      style={styles.googleLogo}
                      accessibilityIgnoresInvertColors
                    />
                    <Text style={styles.googleText}>Continue with Google</Text>
                  </>
                )}
              </Tappable>
            ) : null}

          </View>
        ) : null}

        <Text style={styles.terms}>
          By continuing you agree to our{" "}
          <Text style={styles.termsLink} accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>
            terms
          </Text>{" "}
          and{" "}
          <Text style={styles.termsLink} accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
            privacy{"\u00A0"}policy
          </Text>
          .
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  inner: { flex: 1, paddingHorizontal: 24 },
  brand: { alignItems: "flex-start", minHeight: 48, justifyContent: "center" },
  title: { ...type.largeTitle, color: colors.ink, marginTop: 40 },
  subtitle: {
    ...type.callout,
    color: colors.inkMuted,
    marginTop: 10,
    marginBottom: 28,
  },
  fieldLabel: { ...type.subhead, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  terms: { ...type.footnote, color: colors.inkMuted, marginTop: 28 },
  termsLink: { color: colors.ink, textDecorationLine: "underline" },
  backButton: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  backText: { fontSize: 15, color: colors.inkMuted },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.badge,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: { color: colors.danger, fontSize: 15, textAlign: "center" },
  doneBox: {
    backgroundColor: colors.successBg,
    borderRadius: radii.badge,
    padding: 12,
    marginBottom: 16,
  },
  doneText: { color: colors.ink, fontSize: 15, textAlign: "center" },
  buttonSpacing: { marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.control,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    marginBottom: 12,
  },
  codeInput: {
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  button: {
    backgroundColor: colors.action,
    borderRadius: radii.control,
    minHeight: 52,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.onAction, fontSize: 17, ...fonts.subheading },
  resendButton: { alignItems: "center", marginTop: 20, padding: 8 },
  social: { marginTop: 20, gap: 12 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderLight },
  dividerText: { fontSize: 14, color: colors.inkMuted },
  // Google's light button: white, #747775 outline, the four-colour G.
  googleButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: "#747775",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
  },
  googleLogo: { width: 20, height: 20 },
  googleText: { color: "#1F1F1F", fontSize: 16, ...fonts.subheading },
  appleButton: { width: "100%", height: 52 },
  resendText: { fontSize: 15, fontWeight: "500", color: colors.ink },
  resendDisabled: { color: colors.inkFaint },
});
