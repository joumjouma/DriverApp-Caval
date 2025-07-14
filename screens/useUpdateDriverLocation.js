import { useEffect, useCallback, useRef } from "react";
import * as Location from "expo-location";
import { doc, updateDoc, getDoc } from "firebase/firestore";
import { auth } from '../config/firebase';
import { db } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useNavigation, useRoute } from "@react-navigation/native";
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK_NAME = 'background-location-task';

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

        // Initial location update
        const currentLocation = await Location.getCurrentPositionAsync({});
        await updateDoc(driverRef, {
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          lastLocationUpdate: new Date().toISOString(),
          isOnline: isDriverOnline
        });

        // Set up location subscription
        const locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          async (location) => {
            try {
              const { latitude, longitude } = location.coords;
              const driverRef = doc(db, "Drivers", user.uid);
              const driverDoc = await getDoc(driverRef);
              
              if (driverDoc.exists()) {
                const driverData = driverDoc.data();
                await updateDoc(driverRef, {
                  latitude,
                  longitude,
                  lastLocationUpdate: new Date().toISOString(),
                  isOnline: driverData.isOnline
                });
              }
            } catch (error) {
              console.error('Error updating location:', error);
            }
          }
        );

        // Store the location subscription
        subscriptions.current.location = locationSubscription;

        // Set up periodic online status check
        const onlineStatusInterval = setInterval(async () => {
          try {
            const driverRef = doc(db, "Drivers", user.uid);
            const driverDoc = await getDoc(driverRef);
            
            if (driverDoc.exists()) {
              const driverData = driverDoc.data();
              const lastUpdate = driverData.lastLocationUpdate;
              const now = new Date();
              const lastUpdateTime = new Date(lastUpdate);
              const timeDiff = (now - lastUpdateTime) / 1000;

              if (timeDiff > 30 && driverData.isOnline) {
                await updateDoc(driverRef, {
                  isOnline: false,
                  isAvailable: false, // Set to false when going offline due to inactivity
                  lastOnlineUpdate: new Date().toISOString()
                });
              }
            }
          } catch (error) {
            console.error('Error in online status check:', error);
          }
        }, 10000);

        // Store the online status interval
        subscriptions.current.onlineStatus = onlineStatusInterval;

        // Start background location updates if driver is online
        if (driverData.isOnline) {
          const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
          if (!hasStarted) {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
              accuracy: Location.Accuracy.High,
              timeInterval: 10000, // 10 seconds
              distanceInterval: 10, // 10 meters
              showsBackgroundLocationIndicator: true,
              foregroundService: {
                notificationTitle: 'Caval Driver',
                notificationBody: 'Votre position est suivie en arrière-plan.',
              },
            });
            console.log('Started background location updates');
          }
        } else {
          // Stop background location updates if offline
          const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
          if (hasStarted) {
            await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            console.log('Stopped background location updates');
          }
        }

      } catch (error) {
        console.error('Error in location updates:', error);
        cleanup(); // Clean up on error
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
      }
    });

    // Store the auth unsubscribe function
    subscriptions.current.auth = authUnsubscribe;

    // Return cleanup function
    return cleanup;
  }, [auth, cleanup]);

  return { cleanup };
};

export default useUpdateDriverLocation;