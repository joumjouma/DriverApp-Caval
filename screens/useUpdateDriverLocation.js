import { useEffect, useCallback, useRef } from "react";
import * as Location from "expo-location";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { auth } from '../config/firebase';
import { db } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useNavigation, useRoute } from "@react-navigation/native";
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK_NAME = 'background-location-task';

// Define the background task with better error handling
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('Background location task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      const location = locations[0];
      const user = auth.currentUser;
      if (user) {
        const driverRef = doc(db, 'Drivers', user.uid);
        try {
          await updateDoc(driverRef, {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            lastLocationUpdate: new Date().toISOString(),
            isOnline: true // Only update if online
          });
        } catch (e) {
          console.error('Error updating Firestore from background location:', e);
        }
      }
    }
  }
});

const useUpdateDriverLocation = () => {
  const navigation = useNavigation();
  const route = useRoute();
  
  // Use refs to store subscriptions
  const subscriptions = useRef({
    location: null,
    onlineStatus: null,
    auth: null
  });

  const cleanup = useCallback(() => {
    const { location, onlineStatus, auth } = subscriptions.current;
    
    if (location) {
      location.remove();
      subscriptions.current.location = null;
    }
    
    if (onlineStatus) {
      clearInterval(onlineStatus);
      subscriptions.current.onlineStatus = null;
    }
    
    if (auth) {
      auth();
      subscriptions.current.auth = null;
    }
  }, []);

  // Function to safely start background location updates
  const startBackgroundLocationUpdates = async (driverData) => {
    if (!driverData.isOnline) {
      return false;
    }

    try {
      // Check if background location is available
      const isAvailable = await Location.isBackgroundLocationAvailableAsync();
      if (!isAvailable) {
        console.log('Background location not available on this device');
        return false;
      }

      // Check if the task is already running
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (hasStarted) {
        console.log('Background location updates already running');
        return true;
      }

      // Request background permissions
      const { status } = await Location.requestBackgroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Background location permission not granted');
        return false;
      }

      // Start background location updates
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.Balanced, // Use balanced accuracy for better battery life
        timeInterval: 15000, // 15 seconds
        distanceInterval: 20, // 20 meters
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Caval Driver',
          notificationBody: 'Votre position est suivie en arrière-plan.',
        },
      });
      
      console.log('Started background location updates successfully');
      return true;
    } catch (error) {
      console.log('Could not start background location updates:', error.message);
      // Don't throw error, just return false to indicate failure
      return false;
    }
  };

  // Function to safely stop background location updates
  const stopBackgroundLocationUpdates = async () => {
    try {
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        console.log('Stopped background location updates');
      }
    } catch (error) {
      console.log('Error stopping background location updates:', error.message);
    }
  };

  useEffect(() => {
    const startLocationUpdates = async (user) => {
      if (!user) {
        console.log('No authenticated user, skipping location updates');
        return;
      }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.error('Location permission not granted');
          return;
        }

        const driverRef = doc(db, "Drivers", user.uid);
        
        // Get current driver status
        const driverDoc = await getDoc(driverRef);
        if (!driverDoc.exists()) {
          console.error('Driver document not found');
          return;
        }

        const driverData = driverDoc.data();
        const isDriverOnline = driverData.isOnline;

        // Initial location update - ONLY update location, preserve online status
        const currentLocation = await Location.getCurrentPositionAsync({});
        await updateDoc(driverRef, {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          lastLocationUpdate: new Date().toISOString()
          // REMOVED: isOnline: isDriverOnline - this was causing conflicts
        });

        // Set up location subscription with better error handling
        const locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced, // Use balanced accuracy for better battery life
            timeInterval: 10000, // 10 seconds
            distanceInterval: 15, // 15 meters
          },
          async (location) => {
            try {
              const { latitude, longitude } = location.coords;
              const driverRef = doc(db, "Drivers", user.uid);
              
              // IMPORTANT: Only update location, NEVER change isOnline status
              // This prevents the flickering and preserves the driver's choice
              await updateDoc(driverRef, {
                latitude,
                longitude,
                lastLocationUpdate: new Date().toISOString()
                // REMOVED: isOnline: driverData.isOnline - this was causing conflicts
              });
            } catch (error) {
              console.error('Error updating location:', error);
            }
          }
        );

        // Store the location subscription
        subscriptions.current.location = locationSubscription;

        // Set up periodic online status check - REMOVED automatic offline mechanism
        // Drivers should only go offline when they explicitly choose to do so
        const onlineStatusInterval = setInterval(async () => {
          try {
            const driverRef = doc(db, "Drivers", user.uid);
            const driverDoc = await getDoc(driverRef);
            
            if (driverDoc.exists()) {
              const driverData = driverDoc.data();
              // Only log the status, don't change it automatically
              console.log('Driver online status check:', {
                isOnline: driverData.isOnline,
                lastLocationUpdate: driverData.lastLocationUpdate,
                timestamp: new Date().toISOString()
              });
              
              // DO NOT automatically set driver offline - preserve their choice
              // The driver's online status should only change when they explicitly toggle it
              
              // IMPORTANT: Never update isOnline here - only preserve the existing value
              // This prevents the flickering between online/offline
            }
          } catch (error) {
            console.error('Error in online status check:', error);
          }
        }, 30000); // Check every 30 seconds but don't change status

        // Store the online status interval
        subscriptions.current.onlineStatus = onlineStatusInterval;

        // Try to start background location updates if driver is online
        if (driverData.isOnline) {
          const backgroundStarted = await startBackgroundLocationUpdates(driverData);
          if (!backgroundStarted) {
            console.log('Using foreground location updates only');
          }
        }

      } catch (error) {
        console.error('Error in location updates:', error);
        // Don't call cleanup here as it might interfere with other functionality
      }
    };

    // Get current user and start updates if authenticated
    const currentUser = auth.currentUser;
    if (currentUser) {
      startLocationUpdates(currentUser);
    }

    // Subscribe to auth state changes
    const authUnsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        startLocationUpdates(user);
      } else {
        cleanup();
        // Also stop background location updates when user logs out
        stopBackgroundLocationUpdates();
      }
    });

    // Store the auth unsubscribe function
    subscriptions.current.auth = authUnsubscribe;

    // Return cleanup function
    return () => {
      cleanup();
      stopBackgroundLocationUpdates();
    };
  }, [auth, cleanup]);

  return { cleanup };
};

export default useUpdateDriverLocation;