// Every Firestore / Cloud Functions call the driver makes during a ride.
// The server (functions/index.js) picks the driver, sets the price, records
// earnings and checks delivery codes; the app only moves the ride forward.
//
// Ride statuses the driver app writes, in order:
//   driver_selected (offer) → assigned → driver_arrived → picked_up → completed
// A delivery is completed by confirmDelivery (code check), never by the app.
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  doc, getDoc, getDocs, updateDoc, onSnapshot, collection, query, where, limit, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { auth, db, storage } from "../config/firebase";

const call = (name, data) => httpsCallable(getFunctions(getApp()), name)(data).then((r) => r.data);
const me = () => auth.currentUser?.uid;

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

// ---------------------------------------------------------------- profile
export const watchDriver = (cb) => onSnapshot(doc(db, "Drivers", me()), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(null));

export async function setOnline(online, position) {
  const update = {
    isOnline: online,
    isAvailable: online,
    lastOnlineUpdate: new Date().toISOString(),
  };
  if (online) {
    update.rideInProgress = false;
    update.currentRideId = null;
    update.onlineStartTime = new Date();
  }
  if (position) Object.assign(update, { latitude: position.latitude, longitude: position.longitude, lastLocationUpdate: new Date().toISOString() });
  await updateDoc(doc(db, "Drivers", me()), update);
}

export async function reportPosition(position) {
  if (!me() || !position) return;
  await updateDoc(doc(db, "Drivers", me()), {
    latitude: position.latitude, longitude: position.longitude, lastLocationUpdate: new Date().toISOString(),
  }).catch(() => {});
}

// ---------------------------------------------------------------- offers
/** Calls cb(ride|null) with the ride currently offered to this driver. */
export function watchOffer(cb) {
  const q = query(collection(db, "rideRequests"), where("selectedDriverId", "==", me()), where("status", "==", "driver_selected"));
  return onSnapshot(q, (snap) => {
    const rides = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(rides[0] || null);
  }, () => cb(null));
}

/** Calls cb(ride|null) with this driver's ride in progress (to resume after a restart). */
export function watchActiveRide(cb) {
  const q = query(collection(db, "rideRequests"), where("driverId", "==", me()), where("status", "in", ACTIVE_STATUSES));
  return onSnapshot(q, (snap) => cb(snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null), () => cb(null));
}

export async function acceptOffer(ride, driver) {
  await updateDoc(doc(db, "rideRequests", ride.id), {
    status: "assigned",
    driverId: me(),
    driverName: [driver?.firstName, driver?.lastName].filter(Boolean).join(" ") || "Chauffeur",
    driverPhoto: driver?.photo || "",
    driverPhone: driver?.phoneNumber || null,
    acceptedAt: serverTimestamp(),
  });
  updateDoc(doc(db, "SelectedDriver", ride.id), { status: "assigned", driverAcceptedAt: new Date() }).catch(() => {});
  await updateDoc(doc(db, "Drivers", me()), { isAvailable: false, rideInProgress: true, currentRideId: ride.id }).catch(() => {});
}

export const declineOffer = (rideId) => call("declineRide", { rideId });

// ---------------------------------------------------------------- ride
export const watchRide = (rideId, cb) => onSnapshot(doc(db, "rideRequests", rideId), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null));

/** Customer contact card: name and phone of the person to pick up (the passenger if booked for someone else). */
export async function getContact(rideId) {
  const snap = await getDocs(query(collection(db, "rideRequestsDriver"), where("rideRequestId", "==", rideId), limit(1)));
  return snap.docs[0]?.data() || null;
}

export const markArrived = (rideId) => updateDoc(doc(db, "rideRequests", rideId), { status: "driver_arrived", arrivedAt: serverTimestamp() });

/** → { ok: true } or { ok: false, attemptsLeft }. Throws resource-exhausted after 5 tries. */
export const verifyPickupPin = (rideId, pin) => call("verifyPickupPin", { rideId, pin });

/** Photo of the package at pickup → deliveries/{rideId}/pickup.jpg, URL on the ride. */
export async function uploadPickupPhoto(rideId, uri) {
  const blob = await (await fetch(uri)).blob();
  const fileRef = ref(storage, `deliveries/${rideId}/pickup.jpg`);
  await uploadBytes(fileRef, blob, { contentType: "image/jpeg" });
  const url = await getDownloadURL(fileRef);
  await updateDoc(doc(db, "rideRequests", rideId), { pickupPhotoUrl: url });
  return url;
}

export const markPickedUp = (rideId) => updateDoc(doc(db, "rideRequests", rideId), { status: "picked_up", pickedUpAt: serverTimestamp() });

async function freeDriver() {
  await updateDoc(doc(db, "Drivers", me()), { isAvailable: true, rideInProgress: false, currentRideId: null, lastRideTime: new Date().toISOString() }).catch(() => {});
}

/** Rides and hourly hire. Deliveries use confirmDelivery. */
export async function completeRide(rideId) {
  await updateDoc(doc(db, "rideRequests", rideId), { status: "completed", completedAt: serverTimestamp() });
  await freeDriver();
}

/** → { delivered: true } or { delivered: false, attemptsLeft }. The server completes the delivery. */
export async function confirmDelivery(rideId, code) {
  const res = await call("confirmDelivery", { rideId, code });
  if (res?.delivered) await freeDriver();
  return res;
}

export async function cancelByDriver(rideId, reason) {
  await updateDoc(doc(db, "rideRequests", rideId), {
    status: "cancelled_by_driver", cancelledBy: "driver", cancellationReason: reason || "other", cancelledAt: serverTimestamp(),
  });
  await freeDriver();
}

// ---------------------------------------------------------------- earnings
/** Djibouti date as YYYY-MM-DD (same as the server). */
export function djiboutiDay(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const dj = new Date(utc + 3 * 3600000);
  return `${dj.getFullYear()}-${String(dj.getMonth() + 1).padStart(2, "0")}-${String(dj.getDate()).padStart(2, "0")}`;
}

/** Today's total and trips (moneyByRider, written by the server). */
export function watchToday(cb) {
  const id = `${me()}_${djiboutiDay().replace(/-/g, "")}`;
  return onSnapshot(doc(db, "moneyByRider", id), (s) => {
    const d = s.exists() ? s.data() : {};
    cb({ total: Number(d.total) || 0, trips: Array.isArray(d.trips) ? d.trips : [] });
  }, () => cb({ total: 0, trips: [] }));
}

/** Earnings/{uid}.dailyBreakdown → { "YYYY-MM-DD": { total, trips } } */
export async function getDailyBreakdown() {
  const s = await getDoc(doc(db, "Earnings", me()));
  return (s.exists() && s.data().dailyBreakdown) || {};
}

export async function getRides(ids) {
  const out = await Promise.all(ids.slice(0, 20).map((id) => getDoc(doc(db, "rideRequests", id)).then((s) => (s.exists() ? { id, ...s.data() } : null)).catch(() => null)));
  return out.filter(Boolean);
}

/** Feature switches (same doc as the customer app). */
export async function getFeatureFlags() {
  const s = await getDoc(doc(db, "appConfig", "customer")).catch(() => null);
  return s?.exists() ? s.data() : {};
}
