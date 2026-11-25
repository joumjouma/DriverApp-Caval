// Signed-in driver (Firebase Auth). Firebase keeps the session on the phone
// (config/firebase.js, AsyncStorage persistence), so there is nothing else to store.
import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../config/firebase";

const AuthContext = createContext({ user: null, loading: true, logout: async () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(auth.currentUser);
  const [loading, setLoading] = useState(!auth.currentUser);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); }), []);

  const logout = () => signOut(auth);

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
