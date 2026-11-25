// Crash safety net: if a screen throws while rendering, show a calm error
// screen with "Réessayer" instead of closing the app.
import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button } from "./ui";
import { useTheme } from "../context/ThemeContext";
import { reportError } from "../utils/report";
import { t } from "../utils/i18n/index";

function Fallback({ onRetry }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12, backgroundColor: colors.background }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="refresh" size={32} color={colors.primaryText} />
      </View>
      <AppText variant="heading" style={{ textAlign: "center" }} accessibilityRole="header">{t("Une erreur est survenue")}</AppText>
      <AppText color={colors.textSecondary} style={{ textAlign: "center", fontSize: 15 }}>
        {t("Désolé, cet écran n'a pas pu s'afficher. Vos courses en cours ne sont pas affectées.")}
      </AppText>
      <Button title={t("Réessayer")} onPress={onRetry} style={{ alignSelf: "stretch", marginTop: 8 }} />
    </View>
  );
}

export default class ErrorBoundary extends React.Component {
  state = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError(error, { where: "render", componentStack: info?.componentStack });
  }

  retry = () => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));

  render() {
    if (this.state.error) return <Fallback onRetry={this.retry} />;
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
