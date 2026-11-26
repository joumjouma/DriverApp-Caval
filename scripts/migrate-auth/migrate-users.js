// Copies Firebase Auth users to Supabase Auth, keeping passwords.
//
//   node migrate-users.js --check            what would happen, changes nothing
//   node migrate-users.js --only you@x.com   one account (test with your own first)
//   node migrate-users.js --all              everyone
//
// Needs users.json (firebase auth:export) and .env (see .env.example), both in
// this folder and never committed. Safe to re-run: existing users are skipped.
require("dotenv").config();
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const { uuidFromFirebaseUid } = require("./ids");

const args = process.argv.slice(2);
const mode = args.includes("--all") ? "all" : args.includes("--only") ? "only" : "check";
const onlyEmail = mode === "only" ? String(args[args.indexOf("--only") + 1] || "").toLowerCase() : null;

const env = (k) => {
  const v = (process.env[k] || "").trim();
  if (!v) { console.error(`Missing ${k} in .env (see .env.example)`); process.exit(1); }
  return v;
};
if (!fs.existsSync("users.json")) {
  console.error("users.json not found. Run: firebase auth:export users.json --format=json --project eco-share-92ef1");
  process.exit(1);
}
const { users = [] } = JSON.parse(fs.readFileSync("users.json", "utf8"));
const params = mode === "check" ? null : {
  sk: env("FIREBASE_SIGNER_KEY"), ss: env("FIREBASE_SALT_SEPARATOR"),
  r: env("FIREBASE_ROUNDS"), n: env("FIREBASE_MEM_COST"),
};
const supabase = mode === "check" ? null : createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fbHash = (u) => u.passwordHash && u.salt
  ? `$fbscrypt$v=1,n=${params.n},r=${params.r},p=1,ss=${params.ss},sk=${params.sk}$${u.salt}$${u.passwordHash}`
  : undefined;

(async () => {
  const picked = users.filter((u) => mode !== "only" || (u.email || "").toLowerCase() === onlyEmail);
  if (mode === "only" && !picked.length) { console.error(`No Firebase user with email ${onlyEmail}`); process.exit(1); }
  const report = { mode, at: new Date().toISOString(), created: 0, skipped: 0, failed: 0, rows: [] };
  const stats = { password: 0, phone: 0, noLogin: 0 };

  for (const u of picked) {
    const id = uuidFromFirebaseUid(u.localId);
    const kind = u.passwordHash ? "password" : u.phoneNumber ? "phone" : "noLogin";
    stats[kind]++;
    if (mode === "check") continue;
    const { error } = await supabase.auth.admin.createUser({
      id,
      email: u.email || undefined,
      phone: u.phoneNumber || undefined,
      password_hash: fbHash(u),
      email_confirm: !!u.email,
      phone_confirm: !!u.phoneNumber,
      user_metadata: { firebase_uid: u.localId, name: u.displayName || undefined },
      app_metadata: { migrated_from: "firebase" },
    });
    const who = u.email || u.phoneNumber || u.localId;
    if (!error) { report.created++; report.rows.push({ who, id, result: "created", kind }); continue; }
    if (/already|exists|registered/i.test(error.message)) { report.skipped++; report.rows.push({ who, id, result: "already there" }); continue; }
    report.failed++; report.rows.push({ who, id, result: "failed", error: error.message });
    console.error(`✗ ${who}: ${error.message}`);
  }

  console.log(`Firebase users: ${picked.length}  (password: ${stats.password}, phone only: ${stats.phone}, no way to log in: ${stats.noLogin})`);
  if (mode === "check") { console.log("Nothing changed. Next: node migrate-users.js --only <your email>"); return; }
  console.log(`Created: ${report.created}  Already there: ${report.skipped}  Failed: ${report.failed}`);
  fs.writeFileSync("report.json", JSON.stringify(report, null, 2)); // no passwords in here
  console.log("Details in report.json");
})();
