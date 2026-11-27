// Caval chauffeur — app entry: fonts, theme/language, auth, demo mode, navigation.
import "react-native-get-random-values";
import React, { useRef } from "react";
import { View, ActivityIndicator, StatusBar, Pressable } from "react-native";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DemoProvider, useDemo } from "./context/DemoContext";
import ErrorBoundary from "./components/ErrorBoundary";
import { AppText } from "./components/ui";
import { FONT_FILES, installAppFont } from "./utils/fonts";
import { reportError } from "./utils/report";
import { t } from "./utils/i18n/index";
import { setOnline } from "./services/driverApi";

import LoginScreen from "./screens/LoginScreen";
import RegisterScreen from "./screens/RegisterScreen";
import HomeScreen from "./screens/HomeScreen";
import RideScreen from "./screens/RideScreen";
import EarningsScreen from "./screens/EarningsScreen";
import ProfileScreen from "./screens/ProfileScreen";
import PreferencesScreen from "./screens/PreferencesScreen";
import ModifyInfo from "./screens/ModifyInfo";
import PaymentScreen from "./screens/PaymentScreen";
import ApprovalStatusScreen from "./screens/ApprovalStatusScreen";
import DriverInboxScreen from "./screens/DriverInboxScreen";
import { showAlert, DialogHost } from "./components/Dialog";

installAppFont();

// Log uncaught JS errors before React Native's default handler.
if (global.ErrorUtils?.setGlobalHandler) {
  const previous = global.ErrorUtils.getGlobalHandler?.();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    try { reportError(error, { where: isFatal ? "fatal" : "uncaught" }); } catch (e) { /* ignore */ }
    previous?.(error, isFatal);
  });
}

const Stack = createStackNavigator();

// "MODE DÉMO" tab at the top while signed in to the demo account. Tap to leave.
function DemoBanner() {
  const { demo, leaveDemo } = useDemo();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!demo) return null;
  const ask = () => showAlert(t("Quitter la démo ?"), t("Vous serez déconnecté du compte de démonstration."), [
    { text: t("Annuler"), style: "cancel" },
    { text: t("Quitter"), style: "destructive", onPress: async () => { await setOnline(false).catch(() => {}); await leaveDemo().catch(() => {}); } },
  ]);
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top, left: 0, right: 0, alignItems: "center" }}>
      <Pressable onPress={ask} accessibilityRole="button" accessibilityLabel={t("Quitter la démo")} hitSlop={8}
        style={{ paddingHorizontal: 10, paddingVertical: 2, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: colors.primary }}>
        <AppText variant="overline" color={colors.onPrimary} style={{ fontSize: 11 }}>{t("Mode démo")} · {t("Quitter")}</AppText>
      </Pressable>
    </View>
  );
}

function Screens() {
  const { user, loading } = useAuth();
  const { colors, isDark, textSize, language, ready } = useTheme();
  const navigationRef = useRef(null);
  global.navigationRef = navigationRef; // NotificationService opens screens from a tapped notification

  if (loading || !ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = { ...base, colors: { ...base.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.primary } };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} key={`${textSize}-${language}`}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <Stack.Navigator screenOptions={{ headerShown: false, cardStyle: { backgroundColor: colors.background } }}>
        {user ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Ride" component={RideScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="EarningsScreen" component={EarningsScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="PreferencesScreen" component={PreferencesScreen} />
            <Stack.Screen name="ModifyInfo" component={ModifyInfo} />
            <Stack.Screen name="PaymentScreen" component={PaymentScreen} />
            <Stack.Screen name="ApprovalStatusScreen" component={ApprovalStatusScreen} />
            <Stack.Screen name="DriverInboxScreen" component={DriverInboxScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="LoginScreen" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
      <DemoBanner />
      <DialogHost />
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts(FONT_FILES);
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: "#FAF8F5" }} />;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AuthProvider>
            <DemoProvider>
              <Screens />
            </DemoProvider>
          </AuthProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
