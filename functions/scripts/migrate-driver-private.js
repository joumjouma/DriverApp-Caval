/**
 * One-time migration: move carteGrisePhoto and paymentMethods off the public
 * Drivers/{id} doc into Drivers/{id}/private/profile.
 *
 * Run from the functions/ folder, signed in to the Firebase CLI with access
 * to eco-share-92ef1:
 *   gcloud auth application-default login     (or set GOOGLE_APPLICATION_CREDENTIALS)
 *   node scripts/migrate-driver-private.js            # dry run, changes nothing
 *   node scripts/migrate-driver-private.js --apply    # does the migration
 */
const {initializeApp, applicationDefault} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

const APPLY = process.argv.includes("--apply");
const FIELDS = ["carteGrisePhoto", "paymentMethods"];

initializeApp({credential: applicationDefault(), projectId: "eco-share-92ef1"});
const db = getFirestore();

(async () => {
  const snap = await db.collection("Drivers").get();
  let moved = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const present = FIELDS.filter((f) => data[f] !== undefined);
    if (present.length === 0) continue;
    moved++;
    console.log(`${APPLY ? "Moving" : "Would move"} ${present.join(", ")} for driver ${d.id}`);
    if (!APPLY) continue;
    const priv = Object.fromEntries(present.map((f) => [f, data[f]]));
    const batch = db.batch();
    batch.set(d.ref.collection("private").doc("profile"), {...priv, migratedAt: new Date()}, {merge: true});
    batch.update(d.ref, Object.fromEntries(present.map((f) => [f, FieldValue.delete()])));
    await batch.commit();
  }
  console.log(`${moved} of ${snap.size} drivers ${APPLY ? "migrated" : "need migrating (dry run)"}.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
