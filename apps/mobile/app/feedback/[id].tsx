import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { stackHeader } from "@/components/screen";
import { Stars } from "@/components/stars";
import { useAuth } from "@/data/auth-context";
import { useHome } from "@/data/home";
import { useFeedbackDetail } from "@/data/use-feedback-detail";
import { clock, relativeDay } from "@/lib/words";
import { card, colors, radii, space, type } from "@/theme";

const MAX_NOTE = 2000;

/**
 * One rating, as the website's rating page shows it: the stars, when and from
 * which Tag, the customer's words, Mark as sorted, and "What we did", the
 * team's own notes. Opening it marks it read.
 */
export default function FeedbackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activeOrg } = useAuth();
  const { refresh: refreshHome } = useHome();
  const orgId = activeOrg?.orgId;
  const { item, loading, error, notFound, load, markRead, setResolved, addNote } = useFeedbackDetail(orgId, id);

  const [sorting, setSorting] = useState(false);
  const [sortError, setSortError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const markedFor = useRef<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening it is reading it. Once per rating, and Home's count follows.
  useEffect(() => {
    if (!item || item.isRead || markedFor.current === item.id) return;
    markedFor.current = item.id;
    void markRead().then((ok) => {
      if (ok) void refreshHome();
    });
  }, [item, markRead, refreshHome]);

  if (notFound) {
    return (
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <Stack.Screen options={stackHeader("Rating")} />
        <Text style={styles.empty}>That rating could not be found.</Text>
      </SafeAreaView>
    );
  }

  if (!item) {
    return (
      <SafeAreaView style={styles.screen} edges={["bottom"]}>
        <Stack.Screen options={stackHeader("Rating")} />
        {error ? (
          <View style={styles.centered}>
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ActivityIndicator style={styles.spinner} color={colors.inkMuted} />
        )}
      </SafeAreaView>
    );
  }

  const timeZone = activeOrg?.timezone ?? "UTC";
  const when = `${relativeDay(item.submittedAt, timeZone)} at ${clock(item.submittedAt, timeZone)}`;
  // A low rating is the one that may need doing something about; praise can
  // still be marked sorted, quietly.
  const needsAction = item.rating <= 3 && !item.isResolved;

  const sort = async (resolved: boolean) => {
    setSorting(true);
    setSortError(null);
    const result = await setResolved(resolved);
    setSorting(false);
    if (!result.ok) setSortError(result.message);
    else void refreshHome();
  };

  const save = async () => {
    setSaving(true);
    setNoteError(null);
    const result = await addNote(note);
    setSaving(false);
    if (result.ok) setNote("");
    else setNoteError(result.message);
  };

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <Stack.Screen options={stackHeader("Rating")} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={96}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Stars rating={item.rating} size={32} />
          <Text style={styles.meta}>
            {when}
            {item.tagLabel ? ` · ${item.tagLabel}` : ""}
          </Text>

          {item.note ? (
            <Text style={styles.customerNote} selectable>
              {item.note}
            </Text>
          ) : (
            <Text style={styles.noMessage}>A rating with no message.</Text>
          )}

          <View style={styles.sortBar}>
            {item.isResolved || needsAction ? (
              <Text style={styles.sortState}>{item.isResolved ? "Sorted" : "Not sorted yet"}</Text>
            ) : null}
            {item.isResolved ? (
              <Button
                label="Not sorted after all"
                variant="quiet"
                busy={sorting}
                busyLabel="Saving…"
                onPress={() => void sort(false)}
                icon={<Icon name="arrow.uturn.backward" glyph="↺" size={15} color={colors.inkMuted} />}
              />
            ) : (
              <Button
                label="Mark as sorted"
                variant={needsAction ? "action" : "secondary"}
                busy={sorting}
                busyLabel="Saving…"
                onPress={() => void sort(true)}
                style={styles.sortButton}
                icon={<Icon name="checkmark" glyph="✓" size={17} color={needsAction ? colors.onAction : colors.ink} weight="semibold" />}
              />
            )}
          </View>
          {sortError ? (
            <Text style={styles.errorInline} accessibilityLiveRegion="polite">
              {sortError}
            </Text>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              What we did
            </Text>
            <View style={styles.privateLine}>
              <Icon name="lock" glyph="🔒" size={14} color={colors.inkMuted} />
              <Text style={styles.privateText}>
                Only your team sees this. The customer stays anonymous, so there is no way to write back to them.
              </Text>
            </View>

            {item.notes.length > 0 ? (
              <View style={styles.notes}>
                {item.notes.map((entry, index) => (
                  <View key={entry.id} style={[styles.noteRow, index > 0 ? styles.noteDivider : null]}>
                    <View style={styles.noteHead}>
                      <Text style={styles.noteAuthor} numberOfLines={1}>
                        {entry.authorName}
                      </Text>
                      <Text style={styles.noteWhen}>{relativeDay(entry.createdAt, timeZone)}</Text>
                    </View>
                    <Text style={styles.noteBody} selectable>
                      {entry.body}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {noteError ? (
              <Text style={styles.errorInline} accessibilityLiveRegion="polite">
                {noteError}
              </Text>
            ) : null}
            <TextInput
              value={note}
              onChangeText={(value) => {
                setNote(value);
                if (noteError) setNoteError(null);
              }}
              editable={!saving}
              multiline
              maxLength={MAX_NOTE}
              placeholder="Checked with the team and agreed what to change…"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel="Write what you did about this"
              style={styles.input}
              textAlignVertical="top"
            />
            <Button
              label="Save note"
              variant="secondary"
              busy={saving}
              busyLabel="Saving…"
              disabled={note.trim().length === 0}
              onPress={() => void save()}
              style={styles.saveButton}
              icon={<Icon name="paperplane" glyph="➤" size={16} color={colors.ink} />}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  fill: { flex: 1 },
  content: { padding: space.gutter, paddingBottom: 48 },
  spinner: { marginTop: 60 },
  centered: { padding: space.gutter, gap: 16 },
  empty: { ...type.callout, color: colors.inkMuted, textAlign: "center", marginTop: 40 },
  errorText: { ...type.callout, color: colors.danger },
  meta: { ...type.callout, color: colors.inkMuted, marginTop: 12 },
  customerNote: { ...type.body, fontSize: 19, lineHeight: 28, color: colors.ink, marginTop: 20 },
  noMessage: { ...type.callout, color: colors.inkMuted, marginTop: 20 },
  sortBar: {
    marginTop: 24,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 12,
  },
  sortState: { ...type.subhead, color: colors.inkMuted },
  sortButton: { alignSelf: "stretch" },
  errorInline: { ...type.subhead, color: colors.danger, marginTop: 10 },
  section: { marginTop: 28 },
  sectionTitle: { ...type.headline, fontSize: 20, lineHeight: 25, color: colors.ink },
  privateLine: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 },
  privateText: { ...type.subhead, color: colors.inkMuted, flex: 1 },
  notes: { ...card, marginTop: 16, paddingHorizontal: 16 },
  noteRow: { paddingVertical: 14 },
  noteDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  noteHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  noteAuthor: { ...type.subhead, fontWeight: "600", color: colors.ink, flex: 1 },
  noteWhen: { ...type.subhead, color: colors.inkMuted },
  noteBody: { ...type.callout, color: colors.ink },
  input: {
    marginTop: 16,
    minHeight: 112,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    padding: 14,
    ...type.callout,
    color: colors.ink,
  },
  saveButton: { marginTop: 12 },
});
