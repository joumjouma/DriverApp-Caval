// Préférences — language, appearance (light/dark/system), text size, data saver.
import React from "react";
import { View, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { radius } from "../constants/theme";
import { AppText, Card, Header } from "../components/ui";
import { useTheme, TEXT_SIZES } from "../context/ThemeContext";
import { LANGUAGES, t } from "../utils/i18n/index";
import { showAlert } from "../components/Dialog";

const MODES = [
  { id: "system", label: "Système", detail: "Suit le réglage du téléphone", icon: "phone-portrait-outline" },
  { id: "light", label: "Clair", icon: "sunny-outline" },
  { id: "dark", label: "Sombre", icon: "moon-outline" },
];

function Choice({ label, detail, icon, selected, onPress, last }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, minHeight: 58, paddingVertical: 10 },
        !last && { borderBottomWidth: 1, borderBottomColor: colors.divider }, pressed && { backgroundColor: colors.background }]}>
      {icon ? <Ionicons name={icon} size={20} color={colors.textSecondary} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" style={{ fontSize: 15 }}>{label}</AppText>
        {detail ? <AppText variant="caption" color={colors.textMuted}>{detail}</AppText> : null}
      </View>
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.primary : colors.radioBorder, alignItems: "center", justifyContent: "center" }}>
        {selected && <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.primary }} />}
      </View>
    </Pressable>
  );
}

export default function PreferencesScreen() {
  const navigation = useNavigation();
  const { colors, mode, setMode, textSize, setTextSize, language, setLanguage } = useTheme();
  const chooseLanguage = (id) => {
    const restart = setLanguage(id);
    if (restart) {
      showAlert(t("Langue"), t("Fermez et rouvrez l'application pour appliquer le sens de lecture."));
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <Header title={t("Préférences")} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}>
        <AppText variant="label" color={colors.textMuted}>{t("Langue")}</AppText>
        <Card style={{ overflow: "hidden" }} accessibilityRole="radiogroup">
          {LANGUAGES.map((l, i) => (
            <Choice key={l.id} label={l.label} detail={l.draft ? t("Traduction en cours de relecture") : undefined}
              selected={language === l.id} onPress={() => chooseLanguage(l.id)} last={i === LANGUAGES.length - 1} />
          ))}
        </Card>

        <AppText variant="label" color={colors.textMuted} style={{ marginTop: 12 }}>{t("Apparence")}</AppText>
        <Card style={{ overflow: "hidden" }} accessibilityRole="radiogroup">
          {MODES.map((m, i) => (
            <Choice key={m.id} {...m} label={t(m.label)} detail={m.detail && t(m.detail)} selected={mode === m.id} onPress={() => setMode(m.id)} last={i === MODES.length - 1} />
          ))}
        </Card>

        <AppText variant="label" color={colors.textMuted} style={{ marginTop: 12 }}>{t("Taille du texte")}</AppText>
        <Card style={{ overflow: "hidden" }} accessibilityRole="radiogroup">
          {TEXT_SIZES.map((size, i) => (
            <Choice key={size.id} label={t(size.label)} selected={textSize === size.id} onPress={() => setTextSize(size.id)} last={i === TEXT_SIZES.length - 1} />
          ))}
        </Card>

        <View style={{ padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 4 }}>
          <AppText variant="caption" color={colors.textMuted}>{t("Aperçu")}</AppText>
          <AppText variant="bodyStrong">{t("Nouvelle course")}</AppText>
          <AppText color={colors.textSecondary}>{t("Le client vous attend à Plateau du Serpent.")}</AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
