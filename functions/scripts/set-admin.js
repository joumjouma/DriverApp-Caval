// Give (or remove) admin access to the Caval dashboard.
//   cd functions && node scripts/set-admin.js <email> [--remove]
// Needs Application Default Credentials for eco-share-92ef1
// (gcloud auth application-default login) or GOOGLE_APPLICATION_CREDENTIALS.
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");

initializeApp({projectId: "eco-share-92ef1"});
const [email, flag] = process.argv.slice(2);
if (!email) {
  console.error("Usage: node scripts/set-admin.js <email> [--remove]");
  process.exit(1);
}
(async () => {
  const user = await getAuth().getUserByEmail(email);
  const claims = {...(user.customClaims || {}), admin: flag !== "--remove"};
  await getAuth().setCustomUserClaims(user.uid, claims);
  console.log(`${email}: admin = ${claims.admin}. They must sign out and back in.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
