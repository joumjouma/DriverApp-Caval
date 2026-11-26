// Firebase UIDs (28 characters) become Supabase UUIDs. Same input → same UUID
// (UUID v5), so the data migration can work out every user's new id without a lookup.
const crypto = require("crypto");
const NAMESPACE = "6f1c7a52-4d0e-4b8e-9a51-0c2c5a3e7d10"; // Caval, fixed forever

function uuidFromFirebaseUid(uid) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = crypto.createHash("sha1").update(Buffer.concat([ns, Buffer.from(String(uid), "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
module.exports = { uuidFromFirebaseUid, NAMESPACE };
