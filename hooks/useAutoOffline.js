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
  const countdownIntervalRef = useRef(null);
  const isInitializedRef = useRef(false);

  // Clear any existing timer
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      console.log('⏰ Auto-offline: Timer cleared');
    }
    
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
      console.log('⏰ Auto-offline: Countdown interval cleared');
    }
  }, []);

  // Set driver offline
  const setDriverOffline = useCallback(async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.log('❌ Auto-offline: No authenticated user found');
        return;
      }

      console.log('🔄 Auto-offline: EXECUTING - Setting driver offline after 20 minutes');
      
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

      console.log('✅ Auto-offline: Driver auto-offlined successfully');
      
      // Show notification to user
      Alert.alert(
        "🔄 Auto-Offlined",
        "You've been automatically set offline after being online for 20 minutes.",
        [{ text: "OK" }]
      );

    } catch (error) {
      console.error('❌ Auto-offline: Error setting driver offline:', error);
      
      // Still try to update local state even if Firestore fails
      if (onStatusChange) {
        onStatusChange(false);
      }
    }
  }, [onStatusChange]);

  // Start countdown logging
  const startCountdownLogging = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }
    
    // Log countdown every 10 seconds for 2-minute timer
    countdownIntervalRef.current = setInterval(() => {
      if (onlineStartTimeRef.current && isOnline) {
        const elapsed = Date.now() - onlineStartTimeRef.current.getTime();
        const remaining = (2 * 60 * 1000) - elapsed;
        const secondsRemaining = Math.ceil(remaining / 1000);
        
        if (secondsRemaining > 0) {
          if (secondsRemaining <= 30) {
            // Log every 5 seconds in the last 30 seconds
            if (secondsRemaining % 5 === 0) {
              console.log(`⏰ Auto-offline: ${secondsRemaining} seconds remaining before auto-offline`);
            }
          } else {
            // Log every 10 seconds
            if (secondsRemaining % 10 === 0) {
              console.log(`⏰ Auto-offline: ${secondsRemaining} seconds remaining before auto-offline`);
            }
          }
        }
      }
    }, 5000); // Log every 5 seconds for more frequent updates
    
    console.log('⏰ Auto-offline: Countdown logging started (updates every 5 seconds)');
  }, [isOnline]);

  // Start the 20-minute timer (1200 seconds)
  const startTimer = useCallback(() => {
    // Prevent multiple timer starts
    if (timerRef.current) {
      console.log('⏰ Auto-offline: Timer already running, not starting duplicate');
      return;
    }
    
    clearTimer(); // Clear any existing timer
    
    const TWENTY_MINUTES = 20 * 60 * 1000; // 20 minutes (1200 seconds) in milliseconds
    
    console.log('⏰ Auto-offline: Starting 20-minute timer');
    console.log(`⏰ Auto-offline: Timer will execute at ${new Date(Date.now() + TWENTY_MINUTES).toLocaleTimeString()}`);
    
    // Store the start time for reference
    onlineStartTimeRef.current = new Date();
    console.log(`⏰ Auto-offline: Timer started at ${onlineStartTimeRef.current.toLocaleTimeString()}`);
    
    // Start countdown logging
    startCountdownLogging();
    
    // Set the main timeout
    timerRef.current = setTimeout(() => {
      console.log('⏰ Auto-offline: 20 minutes elapsed, executing auto-offline');
      setDriverOffline();
    }, TWENTY_MINUTES);

    // Log initial countdown
    console.log('⏰ Auto-offline: 20 minutes countdown started');
  }, [clearTimer, setDriverOffline, startCountdownLogging]);

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
    
    const minutesRemaining = Math.max(0, Math.ceil(remaining / 1000 / 60));
    
    // Log remaining time when requested (for debugging)
    if (minutesRemaining > 0 && minutesRemaining <= 20) {
      console.log(`⏰ Auto-offline: UI requested remaining time: ${minutesRemaining} minutes`);
    }
    
    return minutesRemaining;
  }, [isOnline]);

  // Effect to handle online/offline status changes
  useEffect(() => {
    // Only log initialization once
    if (!isInitializedRef.current) {
      console.log('🚀 Auto-offline: Hook initialized and ready');
      isInitializedRef.current = true;
    }
    
    if (isOnline) {
      // Driver just went online - start the timer
      console.log('🚗 Auto-offline: Driver went online, starting auto-offline timer');
      startTimer();
    } else {
      // Driver went offline - clear the timer
      console.log('🚫 Auto-offline: Driver went offline, clearing auto-offline timer');
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