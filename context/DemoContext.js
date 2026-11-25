// Demo mode: test the customer and driver apps together without touching
// real rides.
//
// - Only accounts listed in Firestore appConfig/demo.testers (user IDs) can
//   turn it on. The rules check the same list.
// - A demo driver gets only demo rides, and demo rides only go to demo
//   drivers (functions: sameWorld). Real customers never see a demo driver.
// - The phone pretends to be in Djibouti (DEMO_CENTER), so you can test
//   from anywhere.
//
// Hidden entry: Profil → tap the version number 5 times → Mode démo.
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../config/firebase";

const KEY = "demoMode";

// Plateau du Serpent, Djibouti-ville
export const DEMO_CENTER = { latitude: 11.5946, longitude: 43.1475 };

// For code outside React (location reporting)
let demoOn = false;
export const isDemo = () => demoOn;

/** A point near DEMO_CENTER, moved by `meters` in a random direction. */
export function demoPosition(meters = 0) {
  if (!meters) return { ...DEMO_CENTER };
  const a = Math.random() * 2 * Math.PI;
  const d = meters / 111320;
  return { latitude: DEMO_CENTER.latitude + d * Math.sin(a), longitude: DEMO_CENTER.longitude + d * Math.cos(a) };
}

const DemoContext = createContext({ demo: false, allowed: false, uid: null, setDemo: async () => false, refresh: () => {} });

export function DemoProvider({ children }) {
  const [uid, setUid] = useState(auth.currentUser?.uid || null);
  const [allowed, setAllowed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid || null)), []);
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setSaved(v === "1")).catch(() => {}); }, []);
  useEffect(() => {
    if (!uid) { setAllowed(false); return; }
    getDoc(doc(db, "appConfig", "demo"))
      .then((s) => setAllowed((s.exists() ? s.data().testers || [] : []).includes(uid)))
      .catch(() => setAllowed(false));
  }, [uid, tick]);

  const demo = saved && allowed;
  demoOn = demo;

  // Keep the driver profile in the same world as the app
  useEffect(() => {
    if (!uid || !allowed) return;
    updateDoc(doc(db, "Drivers", uid), { demo }).catch(() => {});
  }, [uid, allowed, demo]);

  const value = useMemo(() => ({
    demo,
    allowed,
    uid,
    refresh: () => setTick((n) => n + 1),
    /** Returns false if this account isn't a tester. */
    setDemo: async (on) => {
      if (on && !allowed) return false;
      setSaved(on);
      await AsyncStorage.setItem(KEY, on ? "1" : "0").catch(() => {});
      return true;
    },
  }), [demo, allowed, uid]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);
