import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Button } from "@/components/button";
import { Checkbox, RadioCard } from "@/components/choice";
import { Group, Row } from "@/components/group";
import { TabScreen } from "@/components/screen";
import { useAuth } from "@/data/auth-context";
import { balanceView } from "@/data/billing-view";
import { useStands } from "@/data/use-stands";
import { useTextComposer, type Draft } from "@/data/text-composer";
import { useTextRequests, type ComposeOptions, type TextRequestItem } from "@/data/use-text-requests";
import { plural, relativeDay, textStatus } from "@/lib/words";
import { card, colors, radii, type } from "@/theme";

/**
 * Text Requests: send one customer the link to your Tag, the website's way.
 * The approved messages and consent methods come from the server, the
 * preview is the server's exact text, and agreement is recorded only when
 * the owner says, separately and on purpose, how the customer gave it.
 *
 * Every number is the ledger's. Nothing on this screen knows what a plan
 * includes, and nothing here sells or points at where to buy (App Store
 * 3.1.3(f)).
 */
export default function TextRequestsScreen() {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.orgId;
  const canSend = activeOrg?.role === "owner" || activeOrg?.role === "admin";
  const { items, balance, compose, loading, refreshing, error, refresh } = useTextRequests(orgId);
  const { stands, refresh: refreshStands } = useStands(orgId);
  const sendable = useMemo(() => stands.filter((stand) => stand.status === "active"), [stands]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      if (orgId) void refreshStands();
    }, [refresh, refreshStands, orgId]),
  );

  const view = balanceView(balance);

  return (
    <TabScreen
      title="Text Requests"
      subtitle="Send a customer the link to your Tag. One message, one review request."
      refreshing={refreshing}
      onRefresh={() => {
        refresh();
        void refreshStands();
      }}
    >
      {view.kind === "loading" ? (
        // Zero is a real state; it is never shown before it is known.
        error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={refresh} />
          </View>
        ) : (
          <ActivityIndicator color={colors.inkMuted} style={styles.spinner} />
        )
      ) : (
        <View>
          <View style={styles.balance} accessible accessibilityLabel={`${view.total} texts left`}>
            <Text style={styles.balanceNumber}>{view.total.toLocaleString("en-US")}</Text>
            <Text style={styles.balanceUnit}>texts left</Text>
          </View>
          {!view.canSend ? (
            <Text style={styles.muted}>You have no texts left. Your next included texts arrive on your billing date.</Text>
          ) : null}
        </View>
      )}

      {view.kind === "ready" ? (
        canSend ? (
          compose && sendable.length > 0 ? (
            <Composer
              orgId={orgId}
              compose={compose}
              tags={sendable.map((stand) => ({
                standId: stand.standId,
                label: sendable.length > 1 && stand.locationName ? `${stand.label} — ${stand.locationName}` : stand.label,
              }))}
              balance={view.total}
              onSent={refresh}
            />
          ) : sendable.length === 0 && stands.length > 0 ? (
            <Text style={styles.muted}>Make a Tag live to send its link.</Text>
          ) : null
        ) : (
          <Text style={styles.muted}>Only owners and admins can send text requests.</Text>
        )
      ) : null}

      <Recent items={items} loading={loading} />
    </TabScreen>
  );
}

function Composer({
  orgId,
  compose,
  tags,
  balance,
  onSent,
}: {
  orgId: string | undefined;
  compose: ComposeOptions;
  tags: Array<{ standId: string; label: string }>;
  balance: number;
  onSent: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [standId, setStandId] = useState(tags[0]?.standId ?? "");
  const [templateId, setTemplateId] = useState(compose.defaultTemplateId);
  const [method, setMethod] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const composer = useTextComposer(orgId);
  const { preview, busy } = composer;

  // A Tag that went away (retired, another business) is never the one sent.
  useEffect(() => {
    if (!tags.some((tag) => tag.standId === standId)) setStandId(tags[0]?.standId ?? "");
  }, [tags, standId]);

  const draft: Draft = { phone, standId, templateId };
  // Anything that changes who gets the text, or what it says, needs a fresh preview.
  const change = (apply: () => void) => {
    apply();
    composer.clear();
    setMethod(null);
    setConfirmed(false);
    setMissing(null);
    setSent(false);
  };

  const needsConsent = preview !== null && !preview.eligibility.allowed && preview.eligibility.reason === "no_consent";
  const blocked = preview !== null && !preview.eligibility.allowed && !needsConsent;
  const short = preview !== null && balance < preview.segments;
  const canSendNow = preview !== null && preview.eligibility.allowed && !short && !composer.sendUncertain;

  return (
    <View style={styles.composer}>
      <Text style={styles.heading} accessibilityRole="header">
        Send a request
      </Text>

      {composer.sendUncertain ? (
        <View style={styles.info}>
          <Text style={styles.infoText}>Could not confirm sending. Check Recent before trying again.</Text>
          <Button
            label="Check recent requests"
            variant="secondary"
            onPress={() => {
              onSent();
              composer.resolveUncertain();
            }}
          />
        </View>
      ) : null}

      {sent ? (
        <View style={styles.success} accessibilityLiveRegion="polite">
          <Text style={styles.successTitle}>Scheduled</Text>
          <Text style={styles.infoText}>It goes out shortly. Its status shows under Recent.</Text>
        </View>
      ) : null}

      <View>
        <Text style={styles.label} nativeID="phone-label">
          Customer’s mobile number
        </Text>
        <TextInput
          value={phone}
          onChangeText={(value) => change(() => setPhone(value))}
          placeholder="+1 555 123 4567"
          placeholderTextColor={colors.inkMuted}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          autoComplete="tel"
          accessibilityLabel="Customer’s mobile number"
          editable={busy === null}
          style={styles.input}
        />
      </View>

      {tags.length > 1 ? (
        <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel="Which Tag">
          <Text style={styles.label}>Which Tag</Text>
          {tags.map((tag) => (
            <RadioCard key={tag.standId} selected={standId === tag.standId} onPress={() => change(() => setStandId(tag.standId))}>
              {tag.label}
            </RadioCard>
          ))}
        </View>
      ) : (
        <View>
          <Text style={styles.label}>Which Tag</Text>
          <Text style={styles.value}>{tags[0]?.label}</Text>
        </View>
      )}

      <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel="Message">
        <Text style={styles.label}>Message</Text>
        {compose.templates.map((template) => (
          <RadioCard
            key={template.id}
            selected={templateId === template.id}
            onPress={() => change(() => setTemplateId(template.id))}
          >
            {template.text.replace(/\{\{link\}\}/g, "[your Tag link]")}
          </RadioCard>
        ))}
        <Text style={styles.footnote}>
          Your business name goes in front, and every text ends with “Reply STOP to opt out.”
        </Text>
      </View>

      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.previewHead}>What ••• {preview.recipientLastFour} will get</Text>
          {/* As it lands on their phone: one grey bubble, the exact text the
              server will send, link and all. */}
          <View style={styles.phone}>
            <Text style={styles.phoneLabel}>Text message</Text>
            <View style={styles.bubble}>
              <Text style={styles.bubbleText} selectable>
                {preview.body.split(/(https?:\/\/\S+)/).map((part, index) =>
                  index % 2 === 1 ? (
                    <Text key={index} style={styles.link}>
                      {part}
                    </Text>
                  ) : (
                    part
                  ),
                )}
              </Text>
            </View>
          </View>
          <Text style={styles.footnote}>
            Counts as {plural(preview.segments, "text")}. You have {balance.toLocaleString("en-US")} left.
          </Text>
        </View>
      ) : null}

      {blocked && preview ? (
        <View style={styles.error}>
          <Text style={styles.errorTitle}>You can’t text this number</Text>
          {preview.eligibility.message ? <Text style={styles.errorText}>{preview.eligibility.message}</Text> : null}
        </View>
      ) : null}

      {needsConsent && preview ? (
        <View style={styles.consent}>
          <Text style={styles.heading} accessibilityRole="header">
            Did this customer agree to a text?
          </Text>
          <Text style={styles.muted}>
            {preview.eligibility.message ? `${preview.eligibility.message} ` : ""}Only continue if they said yes.
          </Text>
          <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel="How they agreed">
            <Text style={styles.label}>How they agreed</Text>
            {compose.consentMethods.map((option) => (
              <RadioCard
                key={option.id}
                selected={method === option.id}
                onPress={() => setMethod(option.id)}
                disabled={busy !== null}
              >
                {option.label}
              </RadioCard>
            ))}
          </View>
          <Checkbox checked={confirmed} onChange={setConfirmed} label={preview.consentStatement} disabled={busy !== null} />
          <Button
            label="Save their agreement"
            variant="secondary"
            busy={busy === "consent"}
            busyLabel="Saving…"
            disabled={!method || !confirmed}
            onPress={() => {
              if (method) void composer.recordConsent(draft, method, compose.consentWordingVersion);
            }}
          />
        </View>
      ) : null}

      {composer.error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Text style={styles.errorTitle}>That did not go through</Text>
          <Text style={styles.errorText}>{composer.error}</Text>
        </View>
      ) : null}

      {short && preview ? (
        <View style={styles.info}>
          <Text style={styles.infoText}>
            This needs {plural(preview.segments, "text")} and you have {balance.toLocaleString("en-US")} left.
          </Text>
        </View>
      ) : null}

      {/* One button, and it is the next step: Preview until the server has
          shown the exact text, then Send once that number may be texted. */}
      {preview === null ? (
        <Button
          label="Preview text request"
          busy={busy === "preview"}
          busyLabel="Getting the exact text…"
          onPress={() => {
            if (phone.trim().length < 3) {
              setMissing("Type the customer’s mobile number first.");
              return;
            }
            setMissing(null);
            setSent(false);
            void composer.runPreview(draft);
          }}
        />
      ) : canSendNow ? (
        <Button
          label="Send text request"
          busy={busy === "send"}
          busyLabel="Sending…"
          onPress={() => {
            void composer.send(draft).then((ok) => {
              if (!ok) return;
              setPhone("");
              setMethod(null);
              setConfirmed(false);
              setSent(true);
              onSent();
            });
          }}
        />
      ) : null}
      {missing ? (
        <Text style={styles.missing} accessibilityLiveRegion="polite">
          {missing}
        </Text>
      ) : null}
    </View>
  );
}

function Recent({ items, loading }: { items: TextRequestItem[]; loading: boolean }) {
  if (loading && items.length === 0) return null;
  return items.length === 0 ? (
    <View>
      <Text style={styles.groupTitle}>Recent</Text>
      <Text style={styles.muted}>Nothing sent yet.</Text>
    </View>
  ) : (
    <Group title="Recent">
      {items.map((item) => {
        const status = textStatus(item.status);
        return (
          <Row key={item.id} accessibilityLabel={`Ending ${item.recipientLastFour ?? "unknown"}. ${status.label}. ${relativeDay(item.createdAt)}`}>
            <View style={styles.recentRow}>
              <Text style={styles.recentNumber}>••• {item.recipientLastFour ?? "····"}</Text>
              <View style={styles.recentMeta}>
                <View style={[styles.dot, { backgroundColor: TONE[status.tone] }]} />
                <Text style={styles.recentStatus}>{status.label}</Text>
              </View>
            </View>
            <Text style={styles.recentWhen}>{relativeDay(item.createdAt)}</Text>
          </Row>
        );
      })}
    </Group>
  );
}

const TONE = { ok: colors.brand, wait: colors.starFilled, bad: colors.danger, off: colors.borderLight } as const;

const styles = StyleSheet.create({
  spinner: { marginTop: 8, alignSelf: "flex-start" },
  notice: { gap: 16 },
  noticeText: { ...type.callout, color: colors.ink },
  balance: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  balanceNumber: { ...type.number, color: colors.ink, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  balanceUnit: { ...type.callout, color: colors.inkMuted },
  muted: { ...type.callout, color: colors.inkMuted },
  composer: { gap: 20 },
  heading: { ...type.headline, color: colors.ink },
  field: { gap: 10 },
  label: { ...type.subhead, fontWeight: "600", color: colors.ink, marginBottom: 8 },
  value: { ...type.callout, color: colors.ink },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    ...type.body,
    color: colors.ink,
  },
  footnote: { ...type.footnote, color: colors.inkMuted },
  preview: { ...card, padding: 16, gap: 12 },
  previewHead: { ...type.subhead, fontWeight: "500", color: colors.inkMuted },
  phone: { backgroundColor: colors.surfaceAlt, borderRadius: 20, padding: 12 },
  phoneLabel: { ...type.footnote, fontWeight: "500", color: colors.inkMuted, textAlign: "center", marginBottom: 8 },
  bubble: {
    maxWidth: "88%",
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleText: { ...type.callout, color: colors.ink },
  link: { color: colors.brandText, textDecorationLine: "underline" },
  consent: {
    gap: 14,
    paddingVertical: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  error: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, borderWidth: 1, borderRadius: radii.control, padding: 14, gap: 4 },
  errorTitle: { ...type.subhead, fontWeight: "600", color: colors.danger },
  errorText: { ...type.subhead, color: colors.ink },
  info: { backgroundColor: colors.infoBg, borderRadius: radii.control, padding: 14, gap: 12 },
  infoText: { ...type.subhead, color: colors.ink },
  success: { backgroundColor: colors.successBg, borderRadius: radii.control, padding: 14, gap: 2 },
  successTitle: { ...type.subhead, fontWeight: "600", color: colors.brandText },
  missing: { ...type.subhead, fontWeight: "500", color: colors.danger },
  groupTitle: { ...type.subhead, color: colors.inkMuted, marginBottom: 8, marginLeft: 4 },
  recentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  recentNumber: { ...type.callout, color: colors.ink, fontVariant: ["tabular-nums"] },
  recentMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  recentStatus: { ...type.subhead, color: colors.ink, flexShrink: 1 },
  recentWhen: { ...type.footnote, color: colors.inkMuted, marginTop: 2 },
});
