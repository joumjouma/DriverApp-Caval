// In-app dialogs in Caval's design, instead of the iOS / Android system alerts.
//
//   showAlert(title, message?, buttons?)  same arguments as React Native's
//     Alert.alert: buttons = [{ text, style: "cancel" | "destructive", onPress }]
//   askPermission({ icon, title, message, request, settingsHint })
//     explains why first, then asks the system (the OS permission prompt itself
//     can't be replaced: Apple and Google require it). If the answer is "no" for
//     good, offers to open the phone's settings.
//
// <DialogHost /> is rendered once at the root of App.js.
import React, { useEffect, useState } from "react";
import { Modal, View, Pressable, Linking, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button } from "./ui";
import { useTheme } from "../context/ThemeContext";
import { radius, spacing } from "../constants/theme";
import { t } from "../utils/i18n/index";

let push = null;          // set by DialogHost
const pending = [];       // dialogs requested before the host mounted

export function showAlert(title, message, buttons, options) {
  const d = { title, message, buttons: buttons?.length ? buttons : [{ text: "OK" }], icon: options?.icon, cancelable: options?.cancelable !== false };
  if (push) push(d); else pending.push(d);
}

/** Resolves true if the permission is granted. `request` returns { status, canAskAgain }. */
export function askPermission({ icon = "information-circle-outline", title, message, request, settingsHint }) {
  return new Promise((resolve) => {
    showAlert(title, message, [
      { text: t("Plus tard"), style: "cancel", onPress: () => resolve(false) },
      {
        text: t("Continuer"),
        onPress: async () => {
          const res = await request().catch(() => ({ status: "denied", canAskAgain: false }));
          if (res?.status === "granted") return resolve(true);
          if (res?.canAskAgain === false) {
            showAlert(t("Autorisation désactivée"), settingsHint || t("Activez-la dans les réglages du téléphone pour utiliser cette fonction."), [
              { text: t("Plus tard"), style: "cancel" },
              { text: t("Ouvrir les réglages"), onPress: () => Linking.openSettings().catch(() => {}) },
            ], { icon: "settings-outline" });
          }
          resolve(false);
        },
      },
    ], { icon });
  });
}

/**
 * Permission with Caval's own explanation first. `get` / `request` are the
 * Expo permission functions. Already granted → true without asking.
 * Refused for good → offers the phone's settings.
 */
export async function ensurePermission({ get, request, icon, title, message, settingsHint }) {
  const cur = await get().catch(() => ({ status: "undetermined" }));
  if (cur?.status === "granted") return true;
  if (cur?.status === "denied" && cur?.canAskAgain === false) {
    showAlert(t("Autorisation désactivée"), settingsHint || t("Activez-la dans les réglages du téléphone pour utiliser cette fonction."), [
      { text: t("Plus tard"), style: "cancel" },
      { text: t("Ouvrir les réglages"), onPress: () => Linking.openSettings().catch(() => {}) },
    ], { icon: "settings-outline" });
    return false;
  }
  return askPermission({ icon, title, message, request, settingsHint });
}

export function DialogHost() {
  const { colors } = useTheme();
  const [queue, setQueue] = useState([]);
  useEffect(() => {
    push = (d) => setQueue((q) => [...q, d]);
    if (pending.length) setQueue((q) => [...q, ...pending.splice(0)]);
    return () => { push = null; };
  }, []);

  const d = queue[0];
  const close = (btn) => {
    setQueue((q) => q.slice(1));
    if (btn?.onPress) setTimeout(() => btn.onPress(), 0);
  };
  if (!d) return null;
  const cancelBtn = d.buttons.find((b) => b.style === "cancel");
  const stacked = d.buttons.length > 2;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => d.cancelable && close(cancelBtn)} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay || "rgba(23,19,15,0.45)" }]}
        onPress={() => d.cancelable && cancelBtn && close(cancelBtn)} accessibilityLabel={t("Fermer")}>
        <Pressable style={[styles.card, { backgroundColor: colors.surface }]} accessibilityRole="alert" onPress={() => {}}>
          {d.icon ? (
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={d.icon} size={26} color={colors.primaryText} />
            </View>
          ) : null}
          {d.title ? <AppText variant="title" style={{ fontSize: 19, textAlign: "center" }}>{d.title}</AppText> : null}
          {d.message ? <AppText color={colors.textSecondary} style={{ textAlign: "center", fontSize: 15, lineHeight: 21 }}>{d.message}</AppText> : null}
          <View style={[styles.buttons, stacked && { flexDirection: "column" }]}>
            {(stacked ? d.buttons : [...d.buttons].sort((a, b) => (a.style === "cancel" ? -1 : b.style === "cancel" ? 1 : 0))).map((b, i) => (
              <View key={`${b.text}-${i}`} style={stacked ? null : { flex: 1 }}>
                <Button size="md" title={b.text}
                  variant={b.style === "destructive" ? "dangerOutline" : b.style === "cancel" ? "secondary" : "primary"}
                  onPress={() => close(b)} />
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: spacing?.lg || 24 },
  card: { borderRadius: radius?.lg || 20, padding: 22, gap: 12, alignItems: "stretch" },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  buttons: { flexDirection: "row", gap: 10, marginTop: 6 },
});
