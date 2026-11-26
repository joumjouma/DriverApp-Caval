// Profil chauffeur — identity, vehicle, settings, help, demo mode (hidden),
// sign out and account deletion.
import React, { useEffect, useRef, useState } from "react";
import { View, ScrollView, Image, Alert, Pressable, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppText, Card, Header, ListRow, ModalSheet, Button, Chip } from "../components/ui";
import { useTheme } from "../context/ThemeContext";
import { useDemo } from "../context/DemoContext";
import { useAuth } from "../context/AuthContext";
import { APP_CONFIG } from "../constants/appConfig";
import { LANGUAGES, t } from "../utils/i18n/index";
import { watchDriver, updateDriver, setOnline, deleteDriverAccount } from "../services/driverApi";
import { supabase, me } from "../config/supabase";
import { reportError } from "../utils/report";

const GENDERS = [
  { id: "female", label: "Femme" },
  { id: "male", label: "Homme" },
];

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { colors, language } = useTheme();
  const { demo, allowed } = useDemo();
  const { logout } = useAuth();
  const [driver, setDriver] = useState(null);
  const [genderOpen, setGenderOpen] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const taps = useRef(0);

  useEffect(() => watchDriver(setDriver), []);
  useEffect(() => { if (allowed || demo) setShowDemo(true); }, [allowed, demo]);

  const version = Constants.expoConfig?.version || APP_CONFIG.version;
  const name = [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || t("Chauffeur");
  const car = [driver?.carMake, driver?.carModel, driver?.carColor].filter(Boolean).join(" ");
  const rating = Number(driver?.averageRating || driver?.rating) || 0;
  const languageName = LANGUAGES.find((l) => l.id === language)?.label;
  const genderName = GENDERS.find((g) => g.id === driver?.gender)?.label;

  const tapVersion = () => {
    taps.current += 1;
    if (taps.current >= 5) { taps.current = 0; setShowDemo(true); navigation.navigate("DemoScreen"); }
  };

  const setGender = async (g) => {
    setGenderOpen(false);
    await updateDriver({ gender: g }).catch((e) => reportError(e, { where: "setGender" }));
  };

  const signOut = () => Alert.alert(t("Se déconnecter ?"), undefined, [
    { text: t("Annuler"), style: "cancel" },
    { text: t("Se déconnecter"), style: "destructive", onPress: async () => {
      if (driver?.isOnline) await setOnline(false).catch(() => {});
      await logout().catch(() => {});
    } },
  ]);

  const deleteAccount = () => Alert.alert(t("Supprimer votre compte ?"),
    t("Votre profil chauffeur et vos documents seront supprimés définitivement. Cette action est irréversible."), [
      { text: t("Annuler"), style: "cancel" },
      { text: t("Supprimer"), style: "destructive", onPress: async () => {
        try {
          // Photo and carte grise first (the database can't delete files), then the account
          const id = me();
          await supabase.storage.from("avatars").remove([`${id}/photo.jpg`]).catch(() => {});
          await supabase.storage.from("driver-documents").remove([`${id}/registration.jpg`]).catch(() => {});
          await deleteDriverAccount();
          await AsyncStorage.clear().catch(() => {});
        } catch (e) {
          if (e?.code === "55000") {
            // Ride in progress, or money still owed: the server explains which
            Alert.alert(t("Suppression impossible pour l'instant"), e.message);
          } else {
            reportError(e, { where: "deleteDriverAccount" });
            Alert.alert(t("Erreur"), t("La suppression a échoué. Réessayez ou contactez le support."));
          }
        }
      } },
    ]);

  const help = () => Linking.openURL(`https://wa.me/${APP_CONFIG.supportPhone.replace(/[^\d]/g, "")}`).catch(() => {});

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <Header title={t("Profil")} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12, paddingBottom: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 }}>
          {driver?.photo
            ? <Image source={{ uri: driver.photo }} style={{ width: 72, height: 72, borderRadius: 36 }} accessibilityIgnoresInvertColors />
            : <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" }}>
                <AppText variant="title" color={colors.primaryText}>{name[0]}</AppText>
              </View>}
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="heading">{name}</AppText>
            <AppText variant="caption" color={colors.textMuted} style={{ fontSize: 14 }}>
              {[driver?.driverType, rating ? `${rating.toFixed(1).replace(".", ",")} ★` : null].filter(Boolean).join(" · ")}
            </AppText>
            {car || driver?.plaqueImmatriculation ? (
              <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14 }}>
                {[car, driver?.plaqueImmatriculation].filter(Boolean).join(" · ")}
              </AppText>
            ) : null}
          </View>
        </View>
        {demo ? <Chip tone="orange" label={t("Mode démo activé")} /> : null}

        <Card style={{ overflow: "hidden" }}>
          <ListRow icon="stats-chart-outline" label={t("Gains")} onPress={() => navigation.navigate("EarningsScreen")} />
          <ListRow icon="person-outline" label={t("Mes informations")} onPress={() => navigation.navigate("ModifyInfo")} />
          <ListRow icon="people-outline" label={t("Genre")} sublabel={t("Certaines clientes préfèrent une conductrice")}
            hint={genderName ? t(genderName) : t("Non renseigné")} onPress={() => setGenderOpen(true)} />
          <ListRow icon="wallet-outline" label={t("Paiements")} onPress={() => navigation.navigate("PaymentScreen")} last />
        </Card>

        <Card style={{ overflow: "hidden" }}>
          <ListRow icon="language-outline" label={t("Langue")} hint={languageName} onPress={() => navigation.navigate("PreferencesScreen")} />
          <ListRow icon="color-palette-outline" label={t("Préférences")} sublabel={t("Apparence, taille du texte")} onPress={() => navigation.navigate("PreferencesScreen")} last={!showDemo} />
          {showDemo ? <ListRow icon="flask-outline" label={t("Mode démo")} hint={demo ? t("Activé") : t("Désactivé")} onPress={() => navigation.navigate("DemoScreen")} last /> : null}
        </Card>

        <Card style={{ overflow: "hidden" }}>
          <ListRow icon="logo-whatsapp" label={t("Aide et support")} sublabel={t("WhatsApp, 7j/7")} onPress={help} />
          <ListRow icon="log-out-outline" label={t("Se déconnecter")} onPress={signOut} />
          <ListRow icon="trash-outline" label={t("Supprimer mon compte")} destructive onPress={deleteAccount} last />
        </Card>

        <Pressable onPress={tapVersion} accessibilityRole="text" style={{ alignSelf: "center", padding: 12 }}>
          <AppText variant="caption" color={colors.textMuted}>{t("Caval chauffeur · version {v}", { v: version })}</AppText>
        </Pressable>
      </ScrollView>

      <ModalSheet visible={genderOpen} onClose={() => setGenderOpen(false)} title={t("Genre")}>
        {GENDERS.map((g) => (
          <Button key={g.id} title={t(g.label)} variant={driver?.gender === g.id ? "primary" : "outline"} size="md" onPress={() => setGender(g.id)} />
        ))}
      </ModalSheet>
    </SafeAreaView>
  );
}
