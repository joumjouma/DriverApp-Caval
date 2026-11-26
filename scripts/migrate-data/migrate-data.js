// Copies Caval data from Firestore + Firebase Storage into Supabase.
// Run scripts/migrate-auth first: only people who have a Supabase login are copied.
//
//   node migrate-data.js --check                  counts only, changes nothing
//   node migrate-data.js --run                    copy (re-runnable: existing rows are kept)
//   node migrate-data.js --run --rides finished   also copy cancelled / no-driver rides
//   node migrate-data.js --run --rides none       profiles and drivers only
//   node migrate-data.js --run --no-files         skip copying photos
//
// Default --rides completed: completed, non-demo rides (history, ratings,
// past earnings). Searching, demo and abandoned rides are never copied.
require("dotenv").config();
const fs = require("fs");
const admin = require("firebase-admin");
const { createClient } = require("@supabase/supabase-js");
const { uuidFromFirebaseUid } = require("./ids");

const args = process.argv.slice(2);
const RUN = args.includes("--run");
const RIDES = args.includes("--rides") ? args[args.indexOf("--rides") + 1] : "completed";
const FILES = !args.includes("--no-files");
if (!["completed", "finished", "none"].includes(RIDES)) { console.error("--rides must be completed, finished or none"); process.exit(1); }
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]) {
  if (!process.env[k]) { console.error(`Missing ${k} in .env (see .env.example)`); process.exit(1); }
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------- helpers
const id = (fbUid) => (fbUid ? uuidFromFirebaseUid(String(fbUid)) : null);
const rideId = (docId) => uuidFromFirebaseUid("ride:" + docId);
const ts = (v) => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
};
const txt = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? (max ? s.slice(0, max) : s) : null;
};
const num = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
const rideType = (v) => (/moto/i.test(String(v || "")) ? "Caval moto" : "Caval Privé");
const djiboutiDay = (iso) => new Date(new Date(iso).getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const RIDE_STATUSES = new Set(["completed", "declined", "cancelled", "cancelled_by_driver", "no_drivers_available"]);
const report = { at: new Date().toISOString(), rides: RIDES, counts: {}, skipped: {}, files: { copied: 0, failed: 0 }, problems: [] };
const skip = (what, why) => { report.skipped[`${what}: ${why}`] = (report.skipped[`${what}: ${why}`] || 0) + 1; };

async function importRows(table, rows) {
  report.counts[table] = (report.counts[table] || 0) + rows.length;
  if (!RUN || !rows.length) return;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.rpc("import_rows", { p_table: table, p_rows: rows.slice(i, i + 200) });
    if (error) { report.problems.push(`${table}: ${error.message}`); console.error(`✗ ${table}: ${error.message}`); }
  }
}

// Firebase Storage URL → Supabase Storage. Returns the new public URL (public
// bucket) or the object path (private buckets), or the old URL if copying fails.
async function copyFile(url, bucket, path) {
  if (!url || !/^https:\/\/firebasestorage\.googleapis\.com\//.test(url)) return url || null;
  if (!RUN || !FILES) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const type = res.headers.get("content-type") || "image/jpeg";
    const { error } = await sb.storage.from(bucket).upload(path, Buffer.from(await res.arrayBuffer()), { contentType: type, upsert: true });
    if (error) throw error;
    report.files.copied++;
    return bucket === "avatars" ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : path;
  } catch (e) {
    report.files.failed++; report.problems.push(`file ${bucket}/${path}: ${e.message}`);
    return url;
  }
}

async function allDocs(name) {
  const snap = await db.collection(name).get();
  return snap.docs;
}

// ---------------------------------------------------------------- run
(async () => {
  // Who has a Supabase login (from scripts/migrate-auth)
  const known = new Set();
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error("Can't list Supabase users:", error.message); process.exit(1); }
    data.users.forEach((u) => known.add(u.id));
    if (data.users.length < 1000) break;
  }
  console.log(`Supabase logins found: ${known.size}`);
  if (!known.size) console.log("⚠ Run scripts/migrate-auth first, or nothing will be copied.");

  // Customers
  const customers = new Map();
  for (const d of await allDocs("Customers")) {
    const uid = id(d.id); const c = d.data();
    if (!known.has(uid)) { skip("customer", "no Supabase login"); continue; }
    customers.set(d.id, {
      id: uid, firebase_uid: d.id,
      first_name: txt(c.firstName, 80) || "", last_name: txt(c.lastName, 80),
      email: txt(c.email, 200), phone: txt(c.number || c.phoneNumber || c.phone, 30),
      photo_url: await copyFile(c.photo || c.photoURL, "avatars", `${uid}/photo.jpg`),
      push_token: txt(c.expoPushToken || c.pushToken, 200),
      created_at: ts(c.createdAt) || new Date().toISOString(),
    });
  }
  await importRows("customers", [...customers.values()]);

  // Drivers (+ private profile)
  const drivers = new Map(); const privates = [];
  for (const d of await allDocs("Drivers")) {
    const uid = id(d.id); const v = d.data();
    if (!known.has(uid)) { skip("driver", "no Supabase login"); continue; }
    let priv = {};
    try { const p = await db.doc(`Drivers/${d.id}/private/profile`).get(); if (p.exists) priv = p.data(); } catch {}
    const status = ["pending", "approved", "rejected"].includes(v.approvalStatus) ? v.approvalStatus : v.isApproved ? "approved" : "pending";
    drivers.set(d.id, {
      id: uid, firebase_uid: d.id,
      first_name: txt(v.firstName, 80) || "", last_name: txt(v.lastName, 80) || "",
      driver_type: rideType(v.driverType || v.vehicleType),
      car_make: txt(v.carMake, 40), car_model: txt(v.carModel, 40), car_color: txt(v.carColor, 30),
      plate: txt(v.plaqueImmatriculation, 20), city: txt(v.city, 60), country: txt(v.country, 60),
      photo_url: await copyFile(v.photo, "avatars", `${uid}/photo.jpg`),
      gender: ["female", "male"].includes(v.gender) ? v.gender : null,
      demo: false, is_online: false, is_available: false,
      approval_status: status, approved_at: status === "approved" ? ts(v.approvalDate) || ts(v.updatedAt) : null,
      documents_verified: !!v.documentsVerified,
      rating_avg: num(v.averageRating), rating_count: Number(v.totalRatings) || 0,
      created_at: ts(v.createdAt) || new Date().toISOString(),
    });
    privates.push({
      driver_id: uid, email: txt(v.email, 200), phone: txt(v.phoneNumber, 30),
      registration_card_url: await copyFile(priv.carteGrisePhoto || v.carteGrisePhoto, "driver-documents", `${uid}/registration.jpg`),
      payout: priv.paymentMethods || v.paymentMethods || null,
      push_token: txt(v.expoPushToken, 200),
    });
  }
  await importRows("drivers", [...drivers.values()]);
  await importRows("driver_private", privates);

  // Rides, earnings, ratings, rewards
  const rides = [], contacts = [], earnings = [], ratings = [], rideIds = new Map();
  const doneByCustomer = new Map();
  if (RIDES !== "none") {
    for (const d of await allDocs("rideRequests")) {
      const r = d.data();
      if (r.demo) { skip("ride", "demo"); continue; }
      if (!RIDE_STATUSES.has(r.status)) { skip("ride", `status ${r.status || "?"}`); continue; }
      if (RIDES === "completed" && r.status !== "completed") { skip("ride", `not completed (${r.status})`); continue; }
      const cust = customers.get(r.userId);
      if (!cust) { skip("ride", "customer not copied"); continue; }
      const service = ["ride", "delivery", "hourly"].includes(r.serviceType) ? r.serviceType : "ride";
      if (service !== "hourly" && num(r.destinationLat) === null) { skip("ride", "no destination"); continue; }
      if (service === "delivery" && !r.package) { skip("ride", "delivery without package"); continue; }
      const drv = r.driverId ? drivers.get(r.driverId) : null;
      const rid = rideId(d.id); rideIds.set(d.id, rid);
      const done = ts(r.completedAt) || ts(r.updatedAt);
      rides.push({
        id: rid, firebase_id: d.id, customer_id: cust.id, service_type: service, ride_type: rideType(r.rideType), status: r.status,
        pickup_lat: num(r.pickupLat), pickup_lng: num(r.pickupLng), pickup_address: txt(r.pickupAddress, 300),
        destination_lat: num(r.destinationLat), destination_lng: num(r.destinationLng), destination_address: txt(r.destinationAddress, 300),
        stops: Array.isArray(r.stops) ? r.stops.slice(0, 2) : [],
        distance_km: num(r.distance) !== null ? Math.min(99999, Math.round(num(r.distance) * 100) / 100) : null,
        duration_min: num(r.duration) !== null ? Math.min(999999, Math.round(num(r.duration) * 10) / 10) : null,
        hours: service === "hourly" ? Math.min(12, Math.max(1, Number(r.hours) || 1)) : null,
        pickup_note: txt(r.pickupNote, 140), passenger: r.passenger || null,
        package: r.package ? { ...r.package } : null,
        payment_method: "cash", fare: num(r.fare) !== null ? Math.round(num(r.fare)) : null,
        client_fare: num(r.clientFare), billed_distance_km: num(r.billedDistanceKm),
        driver_id: drv ? drv.id : null, driver_name: txt(r.driverName, 120), driver_phone: txt(r.driverPhone, 30),
        driver_photo: drv ? drv.photo_url : txt(r.driverPhoto, 500),
        pickup_photo_url: r.pickupPhotoUrl ? await copyFile(r.pickupPhotoUrl, "package-photos", `${rid}/pickup.jpg`) : null,
        delivery_verified: !!r.deliveryVerified,
        created_at: ts(r.createdAt) || done || new Date().toISOString(),
        accepted_at: ts(r.acceptedAt || r.assignedAt), arrived_at: ts(r.driverArrivedAt || r.arrivedAt),
        picked_up_at: ts(r.pickedUpAt), completed_at: r.status === "completed" ? done : null,
        cancelled_at: r.status !== "completed" ? ts(r.cancelledAt) || done : null,
        cancelled_by: r.status === "cancelled_by_driver" ? "driver" : ["cancelled", "declined"].includes(r.status) ? "customer" : r.status === "no_drivers_available" ? "system" : null,
        // Old rides are history: mark money/points as done so nothing runs on them again.
        earnings_recorded_at: done, points_awarded_at: done, discount_refunded_at: done,
      });
      contacts.push({ ride_id: rid, first_name: cust.first_name || null, phone: cust.phone, photo_url: cust.photo_url });
      if (r.status === "completed") {
        doneByCustomer.set(cust.id, (doneByCustomer.get(cust.id) || 0) + 1);
        if (drv && num(r.fare) > 0) {
          const fare = Math.round(num(r.fare));
          // Before Supabase there was no commission and the driver kept the cash: already settled.
          earnings.push({ ride_id: rid, driver_id: drv.id, kind: "ride", amount: fare, gross: fare, platform_discount: 0,
            commission: 0, cash_collected: fare, balance: 0, day: djiboutiDay(done), demo: false, created_at: done });
        }
      }
    }
    for (const d of await allDocs("driverRatings")) {
      const v = d.data(); const rid = rideIds.get(v.rideId);
      const drv = drivers.get(v.driverId); const cust = customers.get(v.customerId);
      const stars = Math.round(Number(v.rating));
      if (!rid || !drv || !cust || !(stars >= 1 && stars <= 5)) { skip("rating", "ride/driver/customer not copied"); continue; }
      const comment = [...(Array.isArray(v.comments) ? v.comments : []), txt(v.customReview)].filter(Boolean).join(" · ");
      ratings.push({ ride_id: rid, driver_id: drv.id, customer_id: cust.id, stars, comment: comment ? comment.slice(0, 500) : null,
        tip: 0, created_at: ts(v.createdAt) || new Date().toISOString() });
    }
  }
  await importRows("rides", rides);
  await importRows("ride_contacts", contacts);
  await importRows("earnings", earnings);
  // One rating per ride (Firebase sometimes has several)
  await importRows("ratings", [...new Map(ratings.map((x) => [x.ride_id, x])).values()]);
  await importRows("customer_rewards", [...doneByCustomer].map(([cid, n]) => ({ customer_id: cid, completed_rides: n, points: n })));

  // Recompute driver ratings from what was copied
  if (RUN) {
    const { error } = await sb.rpc("refresh_driver_ratings");
    if (error) report.problems.push(`ratings refresh: ${error.message}`);
  }

  console.log(RUN ? "Copied:" : "Would copy:", report.counts);
  console.log("Skipped:", report.skipped);
  if (RUN) console.log("Files:", report.files);
  if (report.problems.length) console.log(`⚠ ${report.problems.length} problems, see report.json`);
  fs.writeFileSync("report.json", JSON.stringify(report, null, 2));
  if (!RUN) console.log("Nothing changed. Next: node migrate-data.js --run");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
