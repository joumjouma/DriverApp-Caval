import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('🔐 AuthContext: Setting up auth listener...');
    
    // Check if user is stored in AsyncStorage
    const checkStoredUser = async () => {
      try {
        const storedUser = await AsyncStorage.getItem('auth');
        console.log('🔐 AuthContext: Stored user found:', !!storedUser);
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      } catch (error) {
        console.error('Error reading stored auth:', error);
      }
    };

    checkStoredUser();

    // Listen for auth state changes
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log('🔐 AuthContext: Auth state changed:', !!currentUser);
      if (currentUser) {
        setUser(currentUser);
        await AsyncStorage.setItem('auth', JSON.stringify(currentUser));
      } else {
        setUser(null);
        await AsyncStorage.removeItem('auth');
      }
      setLoading(false);
      console.log('🔐 AuthContext: Loading set to false');
    });

    return unsubscribe;
  }, []);

  const login = async (credentials) => {
    setLoading(true);
    try {
      console.log('🔐 Login attempt with credentials:', credentials);
      // For now, just set loading to false to prevent hanging
      // You can implement actual login logic here later
      setLoading(false);
    } catch (error) {
      console.error('Login error:', error);
      setLoading(false);
      throw error;
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await auth.signOut();
      setUser(null);
      await AsyncStorage.removeItem('auth');
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext); 