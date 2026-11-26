// Mes informations: name, phone, photo, vehicle, email and password.
// Changing the vehicle plate or type sends the profile back for review.
import React, { useEffect, useState } from "react";
import { View, Alert, Image, Pressable, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Screen, Header, Card, Input, Button, ErrorBanner } from "../components/ui";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { spacing } from "../constants/theme";
import { t } from "../utils/i18n/index";
import { supabase } from "../config/supabase";
import { getDriver, updateDriver, uploadProfilePhoto } from "../services/driverApi";
import { authMessage } from "../utils/authErrors";
import { reportError } from "../utils/report";

const validPhone = (p) => /^\+?[0-9]{8,15}$/.test(String(p).replace(/\s/g, ""));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());

export default function ModifyInfo() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useStyles();
  const [d, setD] = useState(null);
  const [form, setForm] = useState({});
  const [authEmail, setAuthEmail] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [driver, { data }] = await Promise.all([getDriver(), supabase.auth.getUser()]);
        setD(driver);
        setAuthEmail(data.user?.email || "");
        setForm({
          firstName: driver?.firstName || "", lastName: driver?.lastName || "", phone: driver?.phoneNumber || "",
          carMake: driver?.carMake || "", carModel: driver?.carModel || "", carColor: driver?.carColor || "",
          plate: driver?.plaqueImmatriculation || "", email: data.user?.email || "",
        });
      } catch (e) {
        reportError(e, { where: "ModifyInfo.load" });
        setError(t("Impossible de charger vos informations. Veuillez réessayer."));
      }
    })();
  }, []);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const run = async (key, fn, okMessage) => {
    setBusy(key); setError("");
    try { await fn(); if (okMessage) Alert.alert(t("Enregistré"), t(okMessage)); }
    catch (e) { reportError(e, { where: `ModifyInfo.${key}` }); setError(authMessage(e, "Impossible d'enregistrer. Vérifiez votre connexion et réessayez.")); }
    finally { setBusy(null); }
  };

  const saveProfile = () => {
    if (!form.firstName.trim() || !form.lastName.trim()) { setError(t("Le prénom et le nom ne peuvent pas être vides.")); return; }
    if (!validPhone(form.phone)) { setError(t("Veuillez entrer un numéro de téléphone valide.")); return; }
    run("profile", () => updateDriver({ firstName: form.firstName.trim(), lastName: form.lastName.trim(), phoneNumber: form.phone.replace(/\s/g, "") }),
      "Vos informations ont été mises à jour.");
  };

  const saveVehicle = () => {
    const plateChanged = form.plate.trim().toUpperCase() !== (d?.plaqueImmatriculation || "");
    const save = () => run("vehicle", () => updateDriver({
      carMake: form.carMake.trim(), carModel: form.carModel.trim(), carColor: form.carColor.trim(), plaqueImmatriculation: form.plate.trim().toUpperCase(),
    }), plateChanged ? "Véhicule enregistré. L'équipe Caval vérifiera la nouvelle plaque." : "Véhicule enregistré.");
    if (plateChanged) {
      Alert.alert(t("Changer de plaque ?"), t("L'équipe Caval vérifiera votre nouveau véhicule."), [
        { text: t("Annuler"), style: "cancel" }, { text: t("Continuer"), onPress: save },
      ]);
    } else save();
  };

  const changePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert(t("Caméra refusée"), t("Autorisez la caméra dans les réglages du téléphone.")); return; }
    const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.6, cameraType: ImagePicker.CameraType.front });
    if (res.canceled) return;
    run("photo", async () => { const url = await uploadProfilePhoto(res.assets[0].uri); setD((x) => ({ ...x, photo: url })); }, "Photo mise à jour.");
  };

  const saveEmail = () => {
    if (!validEmail(form.email)) { setError(t("Veuillez entrer une adresse email valide.")); return; }
    if (form.email.trim().toLowerCase() === authEmail.toLowerCase()) return;
    run("email", async () => {
      const { error: err } = await supabase.auth.updateUser({ email: form.email.trim().toLowerCase() });
      if (err) throw err;
      await updateDriver({ email: form.email.trim().toLowerCase() });
    }, "Un lien de confirmation a été envoyé à la nouvelle adresse. Elle sera utilisée après confirmation.");
  };

  const savePassword = () => {
    if (!pw.current) { setError(t("Le mot de passe actuel est requis.")); return; }
    if (pw.next.length < 6) { setError(t("Le mot de passe doit contenir au moins 6 caractères.")); return; }
    if (pw.next !== pw.confirm) { setError(t("Les nouveaux mots de passe ne correspondent pas.")); return; }
    run("password", async () => {
      const check = await supabase.auth.signInWithPassword({ email: authEmail, password: pw.current });
      if (check.error) { const e = new Error("wrong"); e.code = "invalid_credentials"; throw e; }
      const { error: err } = await supabase.auth.updateUser({ password: pw.next });
      if (err) throw err;
      setPw({ current: "", next: "", confirm: "" });
    }, "Le mot de passe a été mis à jour avec succès.");
  };

  if (!d && !error) {
    return <Screen><View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View></Screen>;
  }

  return (
    <Screen scroll>
      <Header title={t("Mes informations")} onBack={() => navigation.goBack()} />
      <View style={{ padding: spacing.xl, paddingTop: 4, gap: spacing.lg }}>
        {error ? <ErrorBanner message={error} /> : null}

        <Pressable onPress={changePhoto} style={styles.photoRow} accessibilityRole="button" accessibilityLabel={t("Changer la photo")}>
          {d?.photo ? <Image source={{ uri: d.photo }} style={styles.photo} /> : <View style={[styles.photo, styles.photoEmpty]}><Ionicons name="person" size={28} color={colors.primaryText} /></View>}
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong">{t("Photo de profil")}</AppText>
            <AppText variant="caption" color={colors.textMuted}>{t("Les clients la voient quand vous acceptez une course.")}</AppText>
          </View>
          {busy === "photo" ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />}
        </Pressable>

        <Card style={styles.card}>
          <AppText variant="heading">{t("Informations personnelles")}</AppText>
          <Input label={t("Prénom")} value={form.firstName} onChangeText={set("firstName")} autoCapitalize="words" />
          <Input label={t("Nom")} value={form.lastName} onChangeText={set("lastName")} autoCapitalize="words" />
          <Input label={t("Téléphone")} value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" hint={t("Le client vous appelle sur ce numéro.")} />
          <Button title={t("Enregistrer")} onPress={saveProfile} loading={busy === "profile"} />
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading">{t("Véhicule")}</AppText>
          <AppText variant="caption" color={colors.textMuted}>{d?.driverType === "Caval moto" ? t("Moto") : t("Voiture")}</AppText>
          <Input label={t("Marque")} value={form.carMake} onChangeText={set("carMake")} />
          <Input label={t("Modèle")} value={form.carModel} onChangeText={set("carModel")} />
          <Input label={t("Couleur")} value={form.carColor} onChangeText={set("carColor")} />
          <Input label={t("Plaque d'immatriculation")} value={form.plate} onChangeText={(v) => set("plate")(v.toUpperCase())} autoCapitalize="characters" />
          <Button title={t("Enregistrer")} onPress={saveVehicle} loading={busy === "vehicle"} />
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading">{t("Email")}</AppText>
          <Input label={t("Adresse email")} value={form.email} onChangeText={set("email")} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
          <Button title={t("Changer l'email")} variant="secondary" onPress={saveEmail} loading={busy === "email"} />
        </Card>

        <Card style={styles.card}>
          <AppText variant="heading">{t("Mot de passe")}</AppText>
          <Input label={t("Mot de passe actuel")} value={pw.current} onChangeText={(v) => setPw((p) => ({ ...p, current: v }))} secureTextEntry autoComplete="password" />
          <Input label={t("Nouveau mot de passe")} value={pw.next} onChangeText={(v) => setPw((p) => ({ ...p, next: v }))} secureTextEntry autoComplete="new-password" />
          <Input label={t("Confirmez")} value={pw.confirm} onChangeText={(v) => setPw((p) => ({ ...p, confirm: v }))} secureTextEntry autoComplete="new-password" />
          <Button title={t("Changer le mot de passe")} variant="secondary" onPress={savePassword} loading={busy === "password"} />
        </Card>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { gap: 12 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  photo: { width: 56, height: 56, borderRadius: 28 },
  photoEmpty: { backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center" },
}));
