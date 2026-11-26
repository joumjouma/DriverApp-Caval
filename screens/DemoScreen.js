// Mode démo — test the customer and driver apps together.
// Shows this account's user ID (to add to appConfig/demo.testers) and the
// switch. See context/DemoContext.js for what demo mode changes.
import React, { useEffect, useState } from "react";
import { View, ScrollView, Alert, Switch } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { AppText, Card, Header, Button } from "../components/ui";
import { useTheme } from "../context/ThemeContext";
import { useDemo } from "../context/DemoContext";
import { watchDriver } from "../services/driverApi";
import { radius } from "../constants/theme";
import { t } from "../utils/i18n/index";

const STEPS = [
  "Ajoutez l'identifiant ci-dessous dans Supabase : table app_config, ligne demo, liste testers.",
  "Faites de même avec le compte client de l'application Caval.",
  "Activez le mode démo dans les deux applications.",
  "Passez en ligne ici, puis commandez une course ou un colis côté client.",
];

export default function DemoScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { demo, allowed, uid, setDemo, refresh } = useDemo();
  const [online, setOnline] = useState(false);

  useEffect(() => { refresh(); return watchDriver((d) => setOnline(d?.isOnline === true)); }, []);

  const toggle = async (on) => {
    if (online) { Alert.alert(t("Passez hors ligne d'abord"), t("Changez de mode quand vous n'êtes pas en ligne.")); return; }
    const ok = await setDemo(on);
    if (!ok) Alert.alert(t("Compte non autorisé"), t("Ajoutez votre identifiant dans appConfig/demo.testers, puis revenez sur cet écran."));
  };

  const copy = async () => { if (uid) { await Clipboard.setStringAsync(uid); Alert.alert(t("Copié"), uid); } };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <Header title={t("Mode démo")} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 14, paddingBottom: 48 }}>
        <Card style={{ padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{t("Mode démo")}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {allowed ? (demo ? t("Activé : vous recevez uniquement des courses de démo") : t("Désactivé")) : t("Ce compte n'est pas encore autorisé")}
            </AppText>
          </View>
          <Switch value={demo} onValueChange={toggle} trackColor={{ true: colors.primary, false: colors.radioBorder }}
            thumbColor={colors.white} accessibilityLabel={t("Mode démo")} />
        </Card>

        <AppText color={colors.textSecondary} style={{ fontSize: 15 }}>
          {t("En mode démo, le téléphone se place à Djibouti (Plateau du Serpent) et ne reçoit que les courses de démo. Les vrais clients ne vous voient pas. Les courses de démo ne donnent pas de points de fidélité et ne figurent pas dans les relevés des entreprises.")}
        </AppText>

        <AppText variant="overline" color={colors.textMuted} style={{ marginTop: 6 }}>{t("Comment tester")}</AppText>
        <Card style={{ padding: 16, gap: 12 }}>
          {STEPS.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <AppText variant="label" color={colors.primaryText}>{i + 1}</AppText>
              </View>
              <AppText style={{ flex: 1, fontSize: 15 }}>{t(s)}</AppText>
            </View>
          ))}
        </Card>

        <AppText variant="overline" color={colors.textMuted} style={{ marginTop: 6 }}>{t("Votre identifiant")}</AppText>
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}>
          <AppText selectable style={{ fontSize: 14, fontFamily: undefined }}>{uid || "—"}</AppText>
        </View>
        <Button title={t("Copier l'identifiant")} icon="copy-outline" variant="outline" size="md" onPress={copy} />
      </ScrollView>
    </SafeAreaView>
  );
}
