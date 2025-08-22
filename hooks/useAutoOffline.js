import { useEffect, useRef, useCallback } from 'react';
import { Alert } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { auth } from '../config/firebase';

/**
 * Hook to automatically set drivers offline after 20 minutes
 * This runs entirely on the client side
 */
export const useAutoOffline = (isOnline, onStatusChange) => {
  const timerRef = useRef(null);
  const onlineStartTimeRef = useRef(null);

  // Clear any existing timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Set driver offline
  const setDriverOffline = useCallback(async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.log('No authenticated user found');
        return;
      }

      console.log('🔄 Auto-offline: Setting driver offline after 20 minutes');
      
      // Update Firestore
      const driverRef = doc(db, "Drivers", currentUser.uid);
      await updateDoc(driverRef, {
        isOnline: false,
        isAvailable: false,
        lastOfflineUpdate: new Date(),
        lastAvailabilityUpdate: new Date(),
        autoOfflineReason: "20_minute_timeout",
        autoOfflineAt: new Date()
      });

      // Update local state
      if (onStatusChange) {
        onStatusChange(false);
      }

      console.log('✅ Driver auto-offlined successfully');
      
      // Show notification to user
      Alert.alert(
        "🔄 Auto-Offlined",
        "You've been automatically set offline after being online for 20 minutes.",
        [{ text: "OK" }]
      );

    } catch (error) {
      console.error('❌ Error setting driver offline:', error);
      
      // Still try to update local state even if Firestore fails
      if (onStatusChange) {
        onStatusChange(false);
      }
    }
  }, [onStatusChange]);

  // Start the 20-minute timer
  const startTimer = useCallback(() => {
    clearTimer(); // Clear any existing timer
    
    const TWENTY_MINUTES = 20 * 60 * 1000; // 20 minutes in milliseconds
    
    console.log('⏰ Auto-offline: Starting 20-minute timer');
    
    timerRef.current = setTimeout(() => {
      console.log('⏰ Auto-offline: 20 minutes elapsed, setting driver offline');
      setDriverOffline();
    }, TWENTY_MINUTES);

    // Store the start time for reference
    onlineStartTimeRef.current = new Date();
    
    console.log(`⏰ Auto-offline: Timer started at ${onlineStartTimeRef.current.toLocaleTimeString()}`);
  }, [clearTimer, setDriverOffline]);

  // Reset the timer (useful when driver extends their time)
  const resetTimer = useCallback(() => {
    console.log('⏰ Auto-offline: Resetting 20-minute timer');
    startTimer();
  }, [startTimer]);

  // Get remaining time (for UI display)
  const getRemainingTime = useCallback(() => {
    if (!onlineStartTimeRef.current || !isOnline) {
      return 0;
    }
    
    const elapsed = Date.now() - onlineStartTimeRef.current.getTime();
    const remaining = (20 * 60 * 1000) - elapsed; // 20 minutes minus elapsed
    
    return Math.max(0, Math.ceil(remaining / 1000 / 60)); // Return minutes remaining
  }, [isOnline]);

  // Effect to handle online/offline status changes
  useEffect(() => {
    if (isOnline) {
      // Driver just went online - start the timer
      console.log('🚗 Driver went online, starting auto-offline timer');
      startTimer();
    } else {
      // Driver went offline - clear the timer
      console.log('🚫 Driver went offline, clearing auto-offline timer');
      clearTimer();
      onlineStartTimeRef.current = null;
    }

    // Cleanup function
    return () => {
      clearTimer();
    };
  }, [isOnline, startTimer, clearTimer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return {
    resetTimer,
    getRemainingTime,
    clearTimer
  };
}; 