// Appearance: light / dark / follow the phone, and text size.
// Saved on the phone (AsyncStorage key "appearance").
//
//   const { colors, isDark } = useTheme();
//   const useStyles = makeStyles((colors) => ({ box: { backgroundColor: colors.surface } }));
//   const styles = useStyles();   // inside the component
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { lightColors, darkColors } from "../constants/theme";
import { setTextScale } from "../utils/fonts";
import { LANGUAGES, setLanguage as setI18nLanguage, applyDirection } from "../utils/i18n/index";

const KEY = "appearance";

// Names used by older driver screens
const aliasCache = new Map();
function withAliases(p) {
  if (!aliasCache.has(p)) aliasCache.set(p, { ...p, card: p.surface, inputText: p.text, textLight: p.textMuted });
  return aliasCache.get(p);
}
export const TEXT_SIZES = [
  { id: "normal", label: "Normal", scale: 1 },
  { id: "large", label: "Grand", scale: 1.12 },
  { id: "xlarge", label: "Très grand", scale: 1.25 },
];

const ThemeContext = createContext({
  colors: withAliases(lightColors), isDarkMode: false, toggleTheme: () => {}, isDark: false, mode: "system", setMode: () => {},
  textSize: "normal", setTextSize: () => {}, language: "fr", setLanguage: () => false, ready: true,
});

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState("system"); // system | light | dark
  const [textSize, setTextSizeState] = useState("normal");
  const [dataSaver, setDataSaverState] = useState(false); // low-data mode
  const [ready, setReady] = useState(false);
  // French unless the user picks another language in Préférences / Langue.
  const [language, setLanguageState] = useState("fr");

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        const saved = v ? JSON.parse(v) : {};
        if (["system", "light", "dark"].includes(saved.mode)) setModeState(saved.mode);
        if (TEXT_SIZES.some((t) => t.id === saved.textSize)) setTextSizeState(saved.textSize);
        if (LANGUAGES.some((l) => l.id === saved.language)) setLanguageState(saved.language);
        if (typeof saved.dataSaver === "boolean") setDataSaverState(saved.dataSaver);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const save = (next) => AsyncStorage.setItem(KEY, JSON.stringify({ mode, textSize, language, dataSaver, ...next })).catch(() => {});

  // Keep the layout direction in line with the saved language (applies on next start)
  useEffect(() => { if (ready) applyDirection(language); }, [ready]);

  const isDark = mode === "dark" || (mode === "system" && system === "dark");
  const scale = (TEXT_SIZES.find((t) => t.id === textSize) || TEXT_SIZES[0]).scale;
  setTextScale(scale);
  setI18nLanguage(language);

  const value = useMemo(() => ({
    colors: withAliases(isDark ? darkColors : lightColors),
    isDark,
    isDarkMode: isDark, // older screens
    toggleTheme: () => { const m = isDark ? "light" : "dark"; setModeState(m); save({ mode: m }); },
    mode,
    setMode: (m) => { setModeState(m); save({ mode: m }); },
    textSize,
    setTextSize: (t) => { setTextSizeState(t); save({ textSize: t }); },
    language,
    dataSaver,
    setDataSaver: (v) => { setDataSaverState(v); save({ dataSaver: v }); },
    /** Returns true when the app must restart (switching to/from Arabic) */
    setLanguage: (l) => { setLanguageState(l); save({ language: l }); return applyDirection(l); },
    ready,
  }), [isDark, mode, textSize, language, dataSaver, ready]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Theme-aware StyleSheet: returns a hook that rebuilds styles when the theme changes. */
export function makeStyles(factory) {
  return function useStyles() {
    const { colors, isDark } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors, isDark)), [colors, isDark]);
  };
}
