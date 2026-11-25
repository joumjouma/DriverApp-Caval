// Translations. French is the source language: t("Où allez-vous ?") returns
// the string in the current language, or the French text if there's no
// translation yet. The language is set by ThemeProvider (Préférences) and
// the navigator remounts when it changes, so screens re-render.
import { I18nManager } from "react-native";
import en from "./en";
import ar from "./ar";
import so from "./so";
import aa from "./aa";

const DICTS = { en, ar, so, aa };

export const LANGUAGES = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
  { id: "ar", label: "العربية", rtl: true },
  { id: "so", label: "Soomaali", draft: true },
  { id: "aa", label: "Qafar af", draft: true },
].filter((l) => l.id === "fr" || Object.keys(DICTS[l.id] || {}).length > 0);

let current = "fr";
export const getLanguage = () => current;
export function setLanguage(id) {
  current = LANGUAGES.some((l) => l.id === id) ? id : "fr";
}
/**
 * t("Bonjour {name}", { name }) → translated text with {placeholders} filled.
 * Missing translation → the French text (should not happen: see scripts/check-i18n.js).
 */
export function t(fr, vars) {
  if (!fr) return fr;
  let out = current === "fr" ? fr : DICTS[current]?.[fr] ?? fr;
  if (vars) for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k] ?? ""));
  return out;
}

/** Right-to-left layout for Arabic. Takes effect after the app restarts. Returns true if a restart is needed. */
export function applyDirection(id) {
  const rtl = !!LANGUAGES.find((l) => l.id === id)?.rtl;
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

// Language code for Google Maps / Geocoding results (addresses).
// Somali/Afar aren't supported by Google, so they fall back to French (Djibouti's address language).
export function mapsLanguage() {
  return current === "en" ? "en" : current === "ar" ? "ar" : "fr";
}
