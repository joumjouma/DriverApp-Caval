// Chat with the customer during a ride (opened from the ride screen).
import React, { useEffect, useRef, useState } from "react";
import { View, FlatList, TextInput, Pressable, KeyboardAvoidingView, Platform, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Header, EmptyState, ErrorBanner } from "../components/ui";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { radius, spacing } from "../constants/theme";
import { t } from "../utils/i18n/index";
import { formatTime } from "../utils/format";
import { me } from "../config/supabase";
import { watchMessages, sendMessage, markConversationAsRead } from "../utils/messaging";
import { reportError } from "../utils/report";

const QUICK = ["Je suis arrivé", "J'arrive dans 2 minutes", "Je suis devant", "D'accord"];

export default function DriverInboxScreen() {
  const navigation = useNavigation();
  const { conversationId, customerName, customerPhoto } = useRoute().params || {};
  const { colors } = useTheme();
  const styles = useStyles();
  const [messages, setMessages] = useState(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const list = useRef(null);

  useEffect(() => {
    if (!conversationId) return undefined;
    return watchMessages(conversationId, (m) => {
      setMessages(m);
      markConversationAsRead(conversationId);
      setTimeout(() => list.current?.scrollToEnd?.({ animated: true }), 80);
    });
  }, [conversationId]);

  const send = async (value) => {
    const body = (value ?? text).trim();
    if (!body || sending) return;
    setSending(true); setError("");
    try {
      await sendMessage(conversationId, body);
      if (value === undefined) setText("");
    } catch (e) {
      reportError(e, { where: "sendMessage" });
      setError(t("Message non envoyé. Vérifiez votre connexion."));
    } finally { setSending(false); }
  };

  const mine = me();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <Header title={customerName || t("Client")} onBack={() => navigation.goBack()}
        right={customerPhoto ? <Image source={{ uri: customerPhoto }} style={{ width: 36, height: 36, borderRadius: 18 }} /> : null} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={8}>
        {error ? <ErrorBanner message={error} style={{ marginHorizontal: spacing.xl }} /> : null}
        <FlatList
          ref={list}
          data={messages || []}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing.lg, gap: 8, flexGrow: 1 }}
          ListEmptyComponent={messages ? (
            <View style={{ flex: 1, justifyContent: "center" }}>
              <EmptyState icon="chatbubbles-outline" title={t("Aucun message")} message={t("Écrivez au client ou utilisez une réponse rapide.")} />
            </View>
          ) : null}
          renderItem={({ item }) => {
            const own = item.senderId === mine;
            return (
              <View style={[styles.bubble, own ? styles.own : styles.their]}>
                <AppText variant="body" color={own ? colors.onPrimary : colors.text}>{item.text}</AppText>
                <AppText variant="caption" color={own ? colors.onPrimary : colors.textMuted} style={{ fontSize: 11, alignSelf: "flex-end", opacity: 0.8 }}>
                  {formatTime(item.at)}{own && item.read ? ` · ${t("lu")}` : ""}
                </AppText>
              </View>
            );
          }}
        />
        <View style={styles.quick}>
          {QUICK.map((q) => (
            <Pressable key={q} onPress={() => send(t(q))} style={styles.chip} accessibilityRole="button">
              <AppText variant="caption" style={{ fontWeight: "700" }}>{t(q)}</AppText>
            </Pressable>
          ))}
        </View>
        <View style={styles.bar}>
          <TextInput value={text} onChangeText={setText} placeholder={t("Votre message")} placeholderTextColor={colors.textMuted}
            style={styles.input} multiline maxLength={1000} accessibilityLabel={t("Votre message")} />
          <Pressable onPress={() => send()} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel={t("Envoyer")}
            style={[styles.send, (!text.trim() || sending) && { opacity: 0.5 }]}>
            <Ionicons name="send" size={18} color={colors.onPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  bubble: { maxWidth: "80%", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, gap: 2 },
  own: { alignSelf: "flex-end", backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  their: { alignSelf: "flex-start", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: spacing.lg, paddingBottom: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  bar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: spacing.lg, paddingBottom: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 16 },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
}));
