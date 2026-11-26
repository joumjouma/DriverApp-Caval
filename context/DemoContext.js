// Demo mode = signed in with the shared demo driver account.
//
// - "Essayer la démo" on the login screen signs in as demo-chauffeur@caval.tech
//   (startDemo). Signing out leaves demo mode. Nothing to set up.
// - The demo driver only gets demo rides, and demo rides only go to demo
//   drivers (dispatch_ride: d.demo = r.demo). Real customers never see one.
// - Alone? Go online, then "Course test" / "Colis test" on the home screen:
//   a robot customer books a ride near you (demo_request_ride).
// - With a second phone in the customer demo, its rides come to you first.
// - The phone pretends to be in Djibouti (DEMO_CENTER), so you can test
//   from anywhere.
// The database decides who is a demo account (is_demo_tester, migration 0016).
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../config/supabase";

// Public on purpose: demo accounts only ever see demo rides.
export const DEMO_LOGIN = { email: "demo-chauffeur@caval.tech", password: "CavalDemo2026" };

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

/** Sign in with the shared demo driver account. Throws on failure. */
export async function startDemo() {
  const { error } = await supabase.auth.signInWithPassword(DEMO_LOGIN);
  if (error) throw error;
  demoOn = true;
}

const DemoContext = createContext({ demo: false, leaveDemo: async () => {} });

export function DemoProvider({ children }) {
  const [uid, setUid] = useState(null);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUid(data.session?.user?.id || null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id || null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!uid) { setDemo(false); return; }
    supabase.rpc("is_demo_tester").then(({ data }) => setDemo(data === true), () => setDemo(false));
  }, [uid]);

  demoOn = demo;

  const value = useMemo(() => ({
    demo,
    leaveDemo: () => supabase.auth.signOut(),
  }), [demo]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);
