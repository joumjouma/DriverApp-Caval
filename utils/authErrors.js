// Supabase Auth errors → messages people understand (French keys, translated by t()).
import { t } from "./i18n/index";

const MESSAGES = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  email_not_confirmed: "Confirmez d'abord votre email : ouvrez le lien que nous vous avons envoyé.",
  email_address_invalid: "Adresse email invalide.",
  validation_failed: "Adresse email invalide.",
  user_already_exists: "Un compte existe déjà avec cet email. Connectez-vous.",
  email_exists: "Un compte existe déjà avec cet email. Connectez-vous.",
  weak_password: "Mot de passe trop faible : au moins 6 caractères.",
  over_request_rate_limit: "Trop de tentatives. Réessayez dans quelques minutes.",
  over_email_send_rate_limit: "Trop d'emails envoyés. Réessayez dans quelques minutes.",
  user_banned: "Ce compte a été désactivé. Contactez le support.",
  same_password: "Choisissez un mot de passe différent de l'ancien.",
  reauthentication_needed: "Reconnectez-vous puis réessayez.",
};

export function authMessage(e, fallback = "Connexion impossible. Réessayez.") {
  if (e?.name === "AuthRetryableFetchError" || e?.status === 0 || /network|fetch/i.test(e?.message || "")) {
    return t("Pas de connexion internet. Vérifiez votre réseau.");
  }
  return t(MESSAGES[e?.code] || fallback);
}

/** Where the password-reset email sends people (a page that sets the new password). */
export const RESET_URL = "https://eco-share-92ef1.web.app/reset";
