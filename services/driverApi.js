// Every database call the driver makes. The server (Supabase: supabase/migrations)
// picks the driver, sets the price, records earnings and checks the PIN and the
// delivery code; the app only moves the ride forward, through RPCs.
//
// Rows are converted to the camelCase shape the screens use (toRide, toDriver),
// and timestamps get .toDate() so screen code stays simple.
//
// Ride statuses, in order:
//   driver_selected (offer) → assigned → driver_arrived → picked_up → completed
import { supabase, me, check, fileBody } from "../config/supabase";

export const ACTIVE_STATUSES = ["assigned", "driver_arrived", "picked_up"];

export const isDelivery = (ride) => ride?.serviceType === "delivery";
export const isHourly = (ride) => ride?.serviceType === "hourly";

/** Who pays, and when: "pickup" | "dropoff" | "none" (business, prepaid). */
export function cashMoment(ride) {
  if (!ride) return "pickup";
  if (ride.paymentMethod === "business") return "none";
  if (isDelivery(ride)) return ride.package?.payer === "recipient" ? "dropoff" : "pickup";
  return "dropoff";
}

// ---------------------------------------------------------------- shapes
const when = (v) => (v ? { toDate: () => new Date(v), toMillis: () => new Date(v).getTime(), iso: v } : null);

export function toRide(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.customer_id,
    status: r.status,
    serviceType: r.service_type,
    rideType: r.ride_type,
    pickupLat: r.pickup_lat, pickupLng: r.pickup_lng, pickupAddress: r.pickup_address,
    destinationLat: r.destination_lat, destinationLng: r.destination_lng, destinationAddress: r.destination_address,
    stops: (r.stops || []).map((s) => ({ ...s, latitude: s.latitude ?? s.lat, longitude: s.longitude ?? s.lng })),
    distance: r.billed_distance_km ?? r.distance_km,
    duration: r.duration_min,
    hours: r.hours,
    scheduledFor: when(r.scheduled_for),
    pickupNote: r.pickup_note,
    passenger: r.passenger,
    package: r.package,
    paymentMethod: r.payment_method,
    businessName: r.business_name,
    fare: r.fare,
    fareBeforeDiscount: r.fare_before_discount,
    discount: r.discount,
    previousFee: r.previous_fee,
    intercity: r.intercity,
    demo: r.demo,
    driverId: r.driver_id,
    driverName: r.driver_name,
    pickupPhotoUrl: r.pickup_photo_url,
    pickupPinVerified: r.pickup_pin_verified,
    robotCustomer: r.customer_id === DEMO_ROBOT_CUSTOMER,
    countdownExpiryTime: when(r.offer_expires_at),
    createdAt: when(r.created_at),
    acceptedAt: when(r.accepted_at),
    arrivedAt: when(r.arrived_at),
    pickedUpAt: when(r.picked_up_at),
    completedAt: when(r.completed_at),
    cancelledBy: r.cancelled_by,
    cancellationFee: r.cancellation_fee,
  };
}

// Demo mode: the robot customer behind "Recevoir une course test" (migration 0016)
const DEMO_ROBOT_CUSTOMER = "d0000000-0000-4000-a000-00000000c0b0";

/** My 30-day reliability: { offers, accepted, declined, missed, acceptanceRate, completed, cancels } */
export async function getReliability() {
  return check(await supabase.rpc("my_reliability"));
}

/** Demo driver only: a test ride ("ride") or package ("delivery") from the robot customer, offered to me. */
export async function demoRequestRide(service = "ride") {
  return check(await supabase.rpc("demo_request_ride", { p_service: service }));
}

/** Demo only: the delivery code of a robot customer's package (nobody can tell it to you). */
export async function demoDeliveryCode(rideId) {
  const { data } = await supabase.rpc("demo_delivery_code", { p_ride_id: rideId });
  return data || null;
}

export function toDriver(d, priv) {
  if (!d) return null;
  return {
    id: d.id,
    firstName: d.first_name, lastName: d.last_name,
    driverType: d.driver_type, vehicleType: d.driver_type,
    carMake: d.car_make, carModel: d.car_model, carColor: d.car_color,
    plaqueImmatriculation: d.plate,
    city: d.city, country: d.country,
    photo: d.photo_url,
    gender: d.gender,
    demo: d.demo,
    isOnline: d.is_online, isAvailable: d.is_available,
    onlineStartTime: when(d.online_since),
    approvalStatus: d.approval_status,
    isApproved: d.approval_status === "approved",
    approvalDate: when(d.approved_at),
    documentsVerified: d.documents_verified,
    rating: d.rating_avg, averageRating: d.rating_avg, totalRatings: d.rating_count,
    createdAt: when(d.created_at),
    email: priv?.email, phoneNumber: priv?.phone, carteGrisePhoto: priv?.registration_card_url, payout: priv?.payout,
  };
}

/** Realtime: calls onChange on any change to rows matching `filter`. Returns an unsubscribe function. */
function listen(table, filter, onChange) {
  const ch = supabase
    .channel(`${table}:${filter}:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table, filter }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// ---------------------------------------------------------------- profile
export async function getDriver() {
  const id = me();
  if (!id) return null;
  const [d, p] = await Promise.all([
    supabase.from("drivers").select("*").eq("id", id).maybeSingle(),
    supabase.from("driver_private").select("*").eq("driver_id", id).maybeSingle(),
  ]);
  return toDriver(check(d), p.data);
}

export function watchDriver(cb) {
  const id = me();
  if (!id) { cb(null); return () => {}; }
  let alive = true;
  const load = () => getDriver().then((d) => alive && cb(d), () => alive && cb(null));
  load();
  const off = listen("drivers", `id=eq.${id}`, load);
  return () => { alive = false; off(); };
}

/** Profile fields the driver may change (camelCase in, columns out). */
export async function updateDriver(fields) {
  const map = {
    firstName: "first_name", lastName: "last_name", carMake: "car_make", carModel: "car_model", carColor: "car_color",
    plaqueImmatriculation: "plate", city: "city", country: "country", photo: "photo_url", gender: "gender", driverType: "driver_type",
  };
  const row = {};
  for (const [k, v] of Object.entries(fields)) if (map[k]) row[map[k]] = v;
  if (Object.keys(row).length) check(await supabase.from("drivers").update(row).eq("id", me()));
  const priv = {};
  if ("phoneNumber" in fields) priv.phone = fields.phoneNumber;
  if ("email" in fields) priv.email = fields.email;
  if ("payout" in fields) priv.payout = fields.payout;
  if ("carteGrisePhoto" in fields) priv.registration_card_url = fields.carteGrisePhoto;
  if (Object.keys(priv).length) check(await supabase.from("driver_private").upsert({ driver_id: me(), ...priv }));
}

/** Photo → avatars/{uid}/photo.jpg (public). Returns the URL, with a version so phones reload it. */
export async function uploadProfilePhoto(uri) {
  const path = `${me()}/photo.jpg`;
  check(await supabase.storage.from("avatars").upload(path, await fileBody(uri), { contentType: "image/jpeg", upsert: true }));
  const url = `${supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  await updateDriver({ photo: url });
  return url;
}

/** Carte grise → driver-documents/{uid}/registration.jpg (private). Returns the stored path. */
export async function uploadRegistrationCard(uri) {
  const path = `${me()}/registration.jpg`;
  check(await supabase.storage.from("driver-documents").upload(path, await fileBody(uri), { contentType: "image/jpeg", upsert: true }));
  await updateDriver({ carteGrisePhoto: path });
  return path;
}

export async function setOnline(online, position) {
  if (position) await reportPosition(position);
  check(await supabase.from("drivers").update({
    is_online: online,
    is_available: online,
    online_since: online ? new Date().toISOString() : null,
    ...(online ? { current_ride_id: null } : {}),
  }).eq("id", me()));
}

export async function reportPosition(position) {
  const id = me();
  if (!id || !position) return;
  await supabase.from("driver_locations").upsert({
    driver_id: id,
    position: `SRID=4326;POINT(${position.longitude} ${position.latitude})`,
    heading: Number.isFinite(position.heading) ? position.heading : null,
    updated_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}

export async function savePushToken(token) {
  if (!me() || !token) return;
  // Private table: a push token lets anyone send this phone notifications
  await supabase.from("driver_private").upsert({ driver_id: me(), push_token: token }).then(() => {}, () => {});
}

// ---------------------------------------------------------------- offers
/** Calls cb(ride|null) with the ride currently offered to this driver. */
export function watchOffer(cb) {
  const id = me();
  if (!id) { cb(null); return () => {}; }
  let alive = true;
  const load = async () => {
    const { data } = await supabase.from("rides").select("*")
      .eq("selected_driver_id", id).eq("status", "driver_selected")
      .gt("offer_expires_at", new Date().toISOString())
      .order("offer_expires_at", { ascending: false }).limit(1);
    if (alive) cb(toRide(data?.[0]) || null);
  };
  load();
  const off = listen("rides", `selected_driver_id=eq.${id}`, load);
  // An offer that moves to someone else is no longer visible to us: re-check every few seconds.
  const timer = setInterval(load, 4000);
  return () => { alive = false; off(); clearInterval(timer); };
}

/** Calls cb(ride|null) with this driver's ride in progress (to resume after a restart). */
export function watchActiveRide(cb) {
  const id = me();
  if (!id) { cb(null); return () => {}; }
  let alive = true;
  const load = async () => {
    const { data } = await supabase.from("rides").select("*").eq("driver_id", id).in("status", ACTIVE_STATUSES)
      .order("accepted_at", { ascending: false }).limit(1);
    if (alive) cb(toRide(data?.[0]) || null);
  };
  load();
  const off = listen("rides", `driver_id=eq.${id}`, load);
  return () => { alive = false; off(); };
}

export async function acceptOffer(ride) {
  return toRide(check(await supabase.rpc("accept_ride", { p_ride_id: ride.id })));
}

export const declineOffer = async (rideId) => { check(await supabase.rpc("decline_ride", { p_ride_id: rideId })); };

// ---------------------------------------------------------------- ride
export function watchRide(rideId, cb) {
  let alive = true;
  const load = async () => {
    const { data } = await supabase.from("rides").select("*").eq("id", rideId).maybeSingle();
    if (alive) cb(toRide(data));
  };
  load();
  const off = listen("rides", `id=eq.${rideId}`, load);
  return () => { alive = false; off(); };
}

/** Customer contact card: name, phone and photo of the person to pick up (the passenger if booked for someone else). */
export async function getContact(rideId) {
  const { data } = await supabase.from("ride_contacts").select("*").eq("ride_id", rideId).maybeSingle();
  if (!data) return null;
  return { firstName: data.first_name, number: data.phone, phoneNumber: data.phone, photo: data.photo_url, bookedBy: data.booked_by };
}

export const markArrived = async (rideId) => toRide(check(await supabase.rpc("driver_arrived", { p_ride_id: rideId })));

/** → { ok: true } or { ok: false, attemptsLeft }. Throws after 5 tries (code 54000). */
export const verifyPickupPin = async (rideId, pin) => check(await supabase.rpc("verify_pickup_pin", { p_ride_id: rideId, p_pin: pin }));

/** Photo of the package at pickup → package-photos/{rideId}/pickup.jpg. Returns the stored path. */
export async function uploadPickupPhoto(rideId, uri) {
  const path = `${rideId}/pickup.jpg`;
  check(await supabase.storage.from("package-photos").upload(path, await fileBody(uri), { contentType: "image/jpeg", upsert: true }));
  pendingPhoto[rideId] = path;
  return path;
}
const pendingPhoto = {};

export const markPickedUp = async (rideId) =>
  toRide(check(await supabase.rpc("start_ride", { p_ride_id: rideId, p_pickup_photo_url: pendingPhoto[rideId] || null })));

/** Rides and hourly hire. Deliveries use confirmDelivery. */
export const completeRide = async (rideId) => toRide(check(await supabase.rpc("complete_ride", { p_ride_id: rideId })));

/** → { delivered: true } or { delivered: false, attemptsLeft }. The server completes the delivery. */
export const confirmDelivery = async (rideId, code) => check(await supabase.rpc("confirm_delivery", { p_ride_id: rideId, p_code: code }));

/** reason: "no_show" charges the customer a late fee if the driver waited long enough at pickup. */
export const cancelByDriver = async (rideId, reason) =>
  toRide(check(await supabase.rpc("driver_cancel_ride", { p_ride_id: rideId, p_reason: reason || "other" })));

// ---------------------------------------------------------------- earnings
/** Djibouti date as YYYY-MM-DD (same as the server). */
export function djiboutiDay(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const dj = new Date(utc + 3 * 3600000);
  return `${dj.getFullYear()}-${String(dj.getMonth() + 1).padStart(2, "0")}-${String(dj.getDate()).padStart(2, "0")}`;
}

/** Today's earnings: { total, trips: [{ rideId, amount, cash, kind }] }, live. */
export function watchToday(cb) {
  const id = me();
  if (!id) { cb({ total: 0, trips: [] }); return () => {}; }
  let alive = true;
  const load = async () => {
    const { data } = await supabase.from("earnings").select("ride_id, amount, cash_collected, kind, created_at")
      .eq("driver_id", id).eq("day", djiboutiDay()).order("created_at");
    const rows = data || [];
    if (alive) cb({
      total: rows.reduce((s, r) => s + r.amount, 0),
      trips: rows.filter((r) => r.kind === "ride").map((r) => ({ rideId: r.ride_id, amount: r.amount, cash: r.cash_collected })),
      fees: rows.filter((r) => r.kind === "cancellation_fee").length,
    });
  };
  load();
  const off = listen("earnings", `driver_id=eq.${id}`, load);
  return () => { alive = false; off(); };
}

/** Last 60 days → { "YYYY-MM-DD": { total, trips, cash, commission } } */
export async function getDailyBreakdown() {
  const since = djiboutiDay(new Date(Date.now() - 60 * 86400000));
  const rows = check(await supabase.from("driver_daily_earnings").select("*").eq("driver_id", me()).gte("day", since));
  return Object.fromEntries(rows.map((r) => [r.day, { total: r.total, trips: r.trips, cash: r.cash, commission: r.commission }]));
}

/** What Caval owes the driver (> 0) or the driver owes Caval (< 0), all time. */
export async function getBalance() {
  const { data } = await supabase.from("driver_balances").select("*").eq("driver_id", me()).maybeSingle();
  return { balance: data?.balance || 0, earned: data?.earned || 0, commission: data?.commission || 0 };
}

export async function getRides(ids) {
  if (!ids.length) return [];
  const rows = check(await supabase.from("rides").select("*").in("id", ids.slice(0, 50)));
  return rows.map(toRide);
}

/** Feature switches + pricing settings (same as the customer app). */
export async function getFeatureFlags() {
  const { data } = await supabase.from("app_config").select("value").eq("key", "customer").maybeSingle();
  return data?.value || {};
}

export async function getPricing() {
  const { data } = await supabase.from("app_config").select("value").eq("key", "pricing").maybeSingle();
  return data?.value || {};
}

// ---------------------------------------------------------------- account
export async function deleteDriverAccount() {
  check(await supabase.rpc("delete_driver_account"));
  await supabase.auth.signOut();
}
