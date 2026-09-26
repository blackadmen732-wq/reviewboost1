import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/data/auth-context";
import { colors, radii, fonts } from "@/theme";

const RESEND_SECONDS = 30;
const CODE_LENGTH = 6;

export default function LoginScreen() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const codeField = useRef<TextInput>(null);
  const { sendCode, verifyCode } = useAuth();
  const router = useRouter();
  // The back link sits under the status bar / Dynamic Island on every
  // iPhone, rather than at a fixed 64pt that only fits some of them.
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const canSubmitEmail = email.trim().length >= 5 && email.includes("@") && !submitting;
  const canSubmitCode = code.length === CODE_LENGTH && !submitting;

  const handleSendCode = async () => {
    if (!canSubmitEmail) return;
    const address = email.trim().toLowerCase();
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
      setError("We could not send the code. Check the address and try again.");
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
      setError("We could not send the code. Check the address and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerify = async () => {
    if (!canSubmitCode) return;
    setError(null);
    setSubmitting(true);

    try {
      const err = await verifyCode(email, code);
      if (err) {
        setError(err);
        setCode("");
        codeField.current?.focus();
        return;
      }
      router.replace("/select-org");
    } catch {
      setError("We could not verify the code. Please try again.");
      setCode("");
      codeField.current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "code") {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.inner}>
          <Pressable
            style={[styles.backButton, { top: insets.top + 8 }]}
            onPress={() => {
              setStep("email");
              setError(null);
              setCode("");
            }}
            accessibilityRole="button"
          >
            <Text style={styles.backText}>← Use a different email</Text>
          </Pressable>

          <Text style={styles.brand}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a {CODE_LENGTH}-digit code to {email}
          </Text>

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
            onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            editable={!submitting}
          />

          <Pressable
            style={[styles.button, !canSubmitCode && styles.buttonDisabled]}
            onPress={handleVerify}
            disabled={!canSubmitCode}
            accessibilityRole="button"
          >
            {submitting ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.resendButton}
            onPress={handleResend}
            disabled={secondsLeft > 0 || submitting}
            accessibilityRole="button"
          >
            <Text style={[styles.resendText, secondsLeft > 0 && styles.resendDisabled]}>
              {secondsLeft > 0 ? `Send a new code in ${secondsLeft}s` : "Send a new code"}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.inner}>
        <Text style={styles.brand}>ReviewBoost</Text>
        <Text style={styles.subtitle}>
          Enter your email and we&apos;ll send you a sign-in code. No password needed.
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="you@yourbusiness.com"
          placeholderTextColor={colors.inkFaint}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          editable={!submitting}
        />

        <Pressable
          style={[styles.button, !canSubmitEmail && styles.buttonDisabled]}
          onPress={handleSendCode}
          disabled={!canSubmitEmail}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  brand: { fontSize: 32, ...fonts.heading, color: colors.brandText, textAlign: "center" },
  subtitle: {
    fontSize: 16,
    color: colors.inkMuted,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 32,
    lineHeight: 22,
  },
  backButton: { position: "absolute", left: 16, minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  backText: { fontSize: 15, color: colors.inkMuted },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.badge,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
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
    backgroundColor: colors.brand,
    borderRadius: radii.control,
    padding: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.onBrand, fontSize: 16, ...fonts.subheading },
  resendButton: { alignItems: "center", marginTop: 20, padding: 8 },
  resendText: { fontSize: 15, color: colors.brandText },
  resendDisabled: { color: colors.inkFaint },
});
