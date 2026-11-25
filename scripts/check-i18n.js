// Fails if a French text in the app has no translation in en / ar / so.
//   node scripts/check-i18n.js
// It looks at every t("…") key and every French-looking string literal in the
// app code. Data values that are not shown to users go in ALLOW.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["screens", "components", "utils", "constants", "context", "services", "hooks"];
const LANGS = ["en", "ar", "so"];
const ALLOW = new Set([
  "Caval Privé", "Caval moto", "Caval Moto", "Caval", "OK", "nom@exemple.com", "Ahmed Ali", "MM/AA", "CVV",
  "Chauffeur", // stored driver name fallback (data)
  // Android notification channels (system settings, French only)
  "Course Caval", "Approbation Chauffeur", "Notifications Générales",
  "Notifications pour les nouvelles courses et demandes de transport",
  "Notifications pour l'approbation des comptes chauffeurs", "Notifications générales de l'application",
  // Privacy policy body: legal text kept in French (a note says so in other languages)
  "POLITIQUE DE CONFIDENTIALITÉ — L'ESSENTIEL",
]);
// Texts kept in constants and translated with t(variable) at render time
const EXTRA = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  "lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim.", "Jour", "Semaine", "Mois",
  "Petit", "Moyen", "Grand", "Normal", "Très grand", "Système", "Clair", "Sombre", "Suit le réglage du téléphone",
  "Femme", "Homme", "Colis",
];
const FRENCH = /[àâçéèêëîïôûùüÿœÀÂÇÉÈÊÎÔÛ]|\b(le|la|les|un|une|des|du|de|votre|vos|pour|avec|sur|est|pas|aucun|course|chauffeur|colis|départ|annuler|retour|fermer|commander|espèces|livreur|réessayer|erreur|minutes?|aujourd|demain|bonjour|merci|vers|dans|ou|et)\b/i;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : files(p);
    return p.endsWith(".js") ? [p] : [];
  });
}

const sources = [path.join(ROOT, "App.js"), ...DIRS.flatMap((d) => files(path.join(ROOT, d)))];
// Files whose literal French text is intentionally French-only (legal text); their t() keys are still checked.
const FRENCH_ONLY = new Set(["components/PrivacyPolicyModal.js"]);
const keys = new Map(); // text -> first location
for (const file of sources) {
  if (FRENCH_ONLY.has(path.relative(ROOT, file))) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*|import )/.test(line)) return;
    if (/console\.(log|error|warn)|reportError\(/.test(line)) return;
    for (const m of line.matchAll(/(?<![\w$])(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      let text = m[2];
      if (m[1] === "`" && text.includes("${")) continue; // template: its parts are checked separately
      text = text.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (text.length < 2 || !/[A-Za-zÀ-ÿ]{2}/.test(text) || !FRENCH.test(text) || ALLOW.has(text)) continue;
      if (!keys.has(text)) keys.set(text, `${path.relative(ROOT, file)}:${i + 1}`);
    }
  });
}

for (const text of EXTRA) if (!keys.has(text)) keys.set(text, "EXTRA");
// Every literal t("…") key, French-looking or not
for (const file of sources) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const text = m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    if (!ALLOW.has(text) && !keys.has(text)) keys.set(text, path.relative(ROOT, file));
  }
}

let missing = 0;
for (const lang of LANGS) {
  const src = fs.readFileSync(path.join(ROOT, "utils/i18n", `${lang}.js`), "utf8");
  const dict = eval("(" + src.replace(/^\s*\/\/.*$/gm, "").replace("export default", "").trim().replace(/;\s*$/, "") + ")");
  for (const [text, where] of keys) {
    if (!(text in dict)) { missing++; console.log(`${lang}: missing ${JSON.stringify(text)}  (${where})`); }
  }
}
if (missing) { console.error(`\n${missing} missing translations`); process.exit(1); }
console.log(`OK: ${keys.size} texts translated in ${LANGS.join(", ")}`);
