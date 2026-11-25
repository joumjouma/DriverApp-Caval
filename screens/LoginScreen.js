// Connexion chauffeur — email + password, password reset, link to sign up.
// Once signed in, App.js shows the app; HomeScreen handles approval and the
// privacy notice.
import React, { useState } from "react";
import { View, KeyboardAvoidingView, Platform, ScrollView, Image, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button, Input, ErrorBanner } from "../components/ui";
import { useTheme } from "../context/ThemeContext";
import { auth } from "../config/firebase";
import { t } from "../utils/i18n/index";
import CavalLogo from "../assets/Caval_courrier_logo-removebg-preview.png";

const MESSAGES = {
  "auth/invalid-email": "Adresse email invalide.",
  "auth/user-not-found": "Email ou mot de passe incorrect.",
  "auth/wrong-password": "Email ou mot de passe incorrect.",
  "auth/invalid-credential": "Email ou mot de passe incorrect.",
  "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
  "auth/network-request-failed": "Pas de connexion internet. Vérifiez votre réseau.",
  "auth/user-disabled": "Ce compte a été désactivé. Contactez le support.",
};
const message = (e) => t(MESSAGES[e?.code] || "Connexion impossible. Réessayez.");

export default function LoginScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [focus, setFocus] = useState(null);

  const signIn = async () => {
    setError(""); setInfo("");
    if (!email.trim() || !password) { setError(t("Entrez votre email et votre mot de passe.")); return; }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(""); setInfo("");
    if (!email.trim()) { setError(t("Entrez votre email pour recevoir le lien de réinitialisation.")); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo(t("Email envoyé. Pensez à vérifier vos spams."));
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 32, gap: 4, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
            <Image source={CavalLogo} style={{ width: 48, height: 48 }} resizeMode="contain" accessibilityIgnoresInvertColors />
          </View>
          <AppText variant="overline" color={colors.primaryText}>{t("Caval chauffeur")}</AppText>
          <AppText variant="display" accessibilityRole="header" style={{ marginBottom: 6 }}>{t("Connexion")}</AppText>
          <AppText color={colors.textSecondary} style={{ marginBottom: 24 }}>{t("Connectez-vous pour recevoir des courses et des colis.")}</AppText>

          <Input label={t("Email")} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address"
            textContentType="emailAddress" placeholder="nom@exemple.com" focused={focus === "email"} onFocus={() => setFocus("email")} onBlur={() => setFocus(null)} />
          <View>
            <Input label={t("Mot de passe")} value={password} onChangeText={setPassword} secureTextEntry={!show} autoComplete="password"
              textContentType="password" focused={focus === "pw"} onFocus={() => setFocus("pw")} onBlur={() => setFocus(null)}
              onSubmitEditing={signIn} returnKeyType="go" inputStyle={{ paddingRight: 52 }} />
            <Pressable onPress={() => setShow((v) => !v)} accessibilityRole="button" accessibilityLabel={show ? t("Masquer le mot de passe") : t("Afficher le mot de passe")}
              hitSlop={8} style={{ position: "absolute", right: 14, top: 38 }}>
              <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ErrorBanner message={error} style={{ marginBottom: 12 }} />
          {info ? <AppText color={colors.successText} style={{ marginBottom: 12 }} accessibilityLiveRegion="polite">{info}</AppText> : null}

          <Button title={t("Se connecter")} onPress={signIn} loading={busy} />
          <Button title={t("Mot de passe oublié ?")} variant="ghost" size="sm" onPress={reset} style={{ marginTop: 4 }} />

          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingTop: 24 }}>
            <AppText color={colors.textSecondary}>{t("Nouveau chauffeur ?")}</AppText>
            <Pressable onPress={() => navigation.navigate("Register")} accessibilityRole="link" hitSlop={8}>
              <AppText variant="bodyStrong" color={colors.primaryText}>{t("Créer un compte")}</AppText>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
