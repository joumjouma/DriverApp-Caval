import React, { useState, useEffect, useRef } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Animated,
  StatusBar,
  Image,
  Dimensions,
  Easing,
  Linking,
  RefreshControl,
  ScrollView,
  Alert,
} from "react-native";
import MapView, { Marker } from "react-native-maps";
import { Ionicons, MaterialIcons, FontAwesome5, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  setDoc,
  increment,
  arrayUnion,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import useUpdateDriverLocation from "./useUpdateDriverLocation"; // Custom hook for updating location
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { distributeRideRequest, updateDriverStats, Driver } from '../utils/rideDistribution';
import CavalLogo from "../assets/Caval_courrier_logo-removebg-preview.png";
import { useTheme } from "../context/ThemeContext";
import { auth } from "../config/firebase";
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const { width, height } = Dimensions.get("window");

const GOOGLE_MAPS_APIKEY = "AIzaSyBnVN-ACYzcA0Sy8BcPLpXG50Y9T8jhJGE";

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Function to register for push notifications
const registerForPushNotificationsAsync = async () => {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      alert('Failed to get push token for push notification!');
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: '97f35a2b-2bbf-4893-9f43-cd2df775196a', // Your Expo project ID
    })).data;
    console.log('Expo push token:', token);
  } else {
    alert('Must use physical device for Push Notifications');
  }

  return token;
};

// Function to save push token to Firestore
const savePushTokenToFirestore = async (token) => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return;
    }

    const driverRef = doc(db, "Drivers", currentUser.uid);
    await updateDoc(driverRef, {
      expoPushToken: token,
      lastTokenUpdate: serverTimestamp()
    });
    console.log('Push token saved to Firestore');
  } catch (error) {
    console.error('Error saving push token:', error);
  }
};

// Function to update driver's notification preferences
const updateDriverNotificationStatus = async (isOnline) => {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('No authenticated user found');
      return;
    }

    const driverRef = doc(db, "Drivers", currentUser.uid);
    await updateDoc(driverRef, {
      isOnline: isOnline,
      isAvailable: isOnline,
      lastOnlineUpdate: serverTimestamp(),
      // Clear current ride if going offline
      ...(isOnline ? {} : {
        currentRideId: null,
        rideInProgress: false
      })
    });
    console.log(`Driver ${isOnline ? 'online' : 'offline'} status updated`);
  } catch (error) {
    console.error('Error updating driver status:', error);
  }
};

// Add this function near the other helper functions
const fetchRideAndShowOffer = async (rideId) => {
  try {
    const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
    if (rideDoc.exists()) {
      const rideData = rideDoc.data();
      setCurrentRideRequest({ id: rideId, ...rideData });
      setIsModalVisible(true);
      // Optionally, fetch and set pickup/destination addresses here
    }
  } catch (error) {
    console.error("Error fetching ride for notification:", error);
  }
};

const HomeScreenWithMap = () => {
  // -----------------------------------------------------------------
  // 1. All hooks must be called in the same order every render
  // -----------------------------------------------------------------
  // Navigation hooks
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  // Location updates hook - called at top level
  const locationUpdates = useUpdateDriverLocation();

  // Location and map state
  const [region, setRegion] = useState(null);
  const [fromLocation, setFromLocation] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  // Driver info state
  const [userName, setUserName] = useState("Driver");
  const [driverType, setDriverType] = useState("");
  const [driverPhoto, setDriverPhoto] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [driverRating, setDriverRating] = useState(4.0); // Start at 4 stars

  // Ride state
  const [earnings, setEarnings] = useState(0.0);
  const [rideCount, setRideCount] = useState(0);
  const [currentRideRequest, setCurrentRideRequest] = useState(null);
  const [pickupAddress, setPickupAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);
  const [rideDistance, setRideDistance] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState(null);

  // Time tracking state
  const [lastResetWeek, setLastResetWeek] = useState(null);
  const [activeTime, setActiveTime] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [lastEarningsDate, setLastEarningsDate] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Animation refs
  const countdownAnim = useRef(new Animated.Value(1)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const pulseAnimation = useRef(new Animated.Value(1)).current;
  const successScaleAnimation = useRef(new Animated.Value(1)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;
  const tierBadgeScale = useRef(new Animated.Value(1)).current;
  const screenGlowAnim = useRef(new Animated.Value(0)).current;
  const expandingRing1 = useRef(new Animated.Value(0)).current;
  const expandingRing2 = useRef(new Animated.Value(0)).current;
  const expandingRing3 = useRef(new Animated.Value(0)).current;
  const statusPopupAnim = useRef(new Animated.Value(0)).current;
  const statusTextAnim = useRef(new Animated.Value(0)).current;
  const ringAnim1 = useRef(new Animated.Value(0)).current;
  const ringAnim2 = useRef(new Animated.Value(0)).current;
  const ringAnim3 = useRef(new Animated.Value(0)).current;
  const iconAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Refs for cleanup
  const timerRef = useRef(null);
  const onSnapshotUnsubscribe = useRef(null);
  const currentRideRequestRef = useRef(null);
  const rideInProgressRef = useRef(false);
  const rideCooldownRef = useRef(false);
  const hasNavigatedToRideRef = useRef(false); // Flag to prevent multiple navigations
  const intervalRef = useRef(null); // Add missing intervalRef
  const mapRef = useRef(null); // Add missing mapRef
  const navigationCooldownRef = useRef(false); // Cooldown for navigation attempts

  // Flags
  const [rideInProgress, setRideInProgress] = useState(false);
  const [rideCooldown, setRideCooldown] = useState(false);
  const [showStatusPopup, setShowStatusPopup] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // -----------------------------------------------------------------
  // 2. Effects
  // -----------------------------------------------------------------
  // Effect to handle location updates based on auth and route
  useEffect(() => {
    if (!auth.currentUser || route.name !== 'Home') {
      // Clean up location updates if not authenticated or not on home screen
      if (locationUpdates?.cleanup) {
        locationUpdates.cleanup();
      }
    }
  }, [auth.currentUser, route.name, locationUpdates]);

  // Keep currentRideRequest ref updated
  useEffect(() => {
    currentRideRequestRef.current = currentRideRequest;
  }, [currentRideRequest]);

  // -----------------------------------------------------------------
  // 3. React Navigation
  // -----------------------------------------------------------------
  // Add authentication check
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        setIsOnline(false); // User starts offline
        // Set driver offline in Firestore
        const driverRef = doc(db, "Drivers", user.uid);
        updateDoc(driverRef, {
          isOnline: false,
          isAvailable: false,
          rideInProgress: false,
          currentRideId: null
        });
        // Load persisted data and fetch driver info when authenticated
        loadPersistedData();
        fetchDriverDataFromFirestore();
        // Register for push notifications
        registerForPushNotificationsAsync().then(token => {
          if (token) {
            savePushTokenToFirestore(token);
          }
        });
      } else {
        setIsOnline(false);
        // Reset navigation flag when user logs out
        hasNavigatedToRideRef.current = false;
        // Navigate to login if not authenticated
        navigation.replace('LoginScreen');
      }
    });

    return () => unsubscribe();
  }, []);

  // -----------------------------------------------------------------
  // 3.5. Push Notification Setup and Handling
  // -----------------------------------------------------------------
  useEffect(() => {
    // Set up notification response handler
    const notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response received:', response);
      
      // Handle notification tap - navigate to ride offer if available
      const data = response.notification.request.content.data;
      if (data && data.rideId) {
        console.log('Navigating to ride offer from notification:', data.rideId);
        
        // If the app was in background and user tapped notification, refresh to get latest rides
        if (data.type === 'new_ride_offer' || data.type === 'ride_assigned') {
          // Small delay to ensure the app is fully active
          setTimeout(() => {
            onRefresh();
          }, 500);
        }
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, []);

  // Function to handle incoming notifications when app is in foreground
  const handleForegroundNotification = (notification) => {
    console.log('Foreground notification received:', notification);
    const data = notification.request.content.data;
    
    if (data && data.type === 'new_ride_offer') {
      // Show a local alert or update the UI
      Alert.alert(
        '🚗 Nouvelle course disponible!',
        'Une nouvelle demande de course correspond à votre profil. Vérifiez l\'écran principal.',
        [
          { text: 'Voir maintenant', onPress: () => onRefresh() },
          { text: 'Plus tard', style: 'cancel' }
        ]
      );
    } else if (data && data.type === 'ride_assigned') {
      Alert.alert(
        '🎯 Course assignée!',
        'Vous avez été sélectionné pour une nouvelle course. Vérifiez l\'écran principal.',
        [
          { text: 'Voir maintenant', onPress: () => onRefresh() },
          { text: 'Plus tard', style: 'cancel' }
        ]
      );
    }
  };

  // Set up foreground notification handler
  useEffect(() => {
    const notificationListener = Notifications.addNotificationReceivedListener(handleForegroundNotification);
    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data && data.type === 'ride_assigned' && data.rideId) {
        fetchRideAndShowOffer(data.rideId);
      }
    });
    return () => {
      Notifications.removeNotificationSubscription(notificationListener);
      Notifications.removeNotificationSubscription(responseListener);
    };
  }, []);

  // Cleanup function to reset navigation flag when component unmounts
  useEffect(() => {
    return () => {
      hasNavigatedToRideRef.current = false;
      navigationCooldownRef.current = false;
      // Clean up intervalRef to prevent memory leaks
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Clean up mapRef
      if (mapRef.current) {
        mapRef.current = null;
      }
    };
  }, []);

  // -----------------------------------------------------------------
  // 4. Reset rideInProgress if we come back from RideInProgressScreen
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!auth.currentUser) return;

    if (route.params?.rideCompleted) {
      console.log('Resetting driver state after ride completion');
      
      // Reset all state variables
      setRideInProgress(false);
      setRideCooldown(false);
      setCurrentRideRequest(null);
      setIsModalVisible(false);
      setTimeLeft(15); // Reset timer for next ride offer
      
      // Reset any timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      // Update driver's status in Firestore and force component refresh
      const updateDriverStatus = async () => {
        try {
          const currentUser = auth.currentUser;
          if (!currentUser) {
            console.error("No authenticated user found");
            return;
          }

          console.log('Updating driver status in Firestore...');
          const driverRef = doc(db, "Drivers", currentUser.uid);
          await updateDoc(driverRef, {
            isAvailable: false, // Set to false when offline to prevent ride assignment
            isOnline: false, // Stay offline after ride completion
            rideInProgress: false,
            currentRideId: null,
            lastRideCompletedAt: serverTimestamp()
          });
          
          // Clear any existing subscription
          if (onSnapshotUnsubscribe.current) {
            onSnapshotUnsubscribe.current();
            onSnapshotUnsubscribe.current = null;
          }
          
          // Force location refresh and re-establish subscription
          try {
            const currentPosition = await Location.getCurrentPositionAsync({});
            if (currentPosition?.coords) {
              const { latitude, longitude } = currentPosition.coords;
              setFromLocation({ latitude, longitude });
              setRegion({
                latitude,
                longitude,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              });
              
              // Update driver's location in Firestore
              await updateDoc(driverRef, {
                latitude,
                longitude,
                lastLocationUpdate: serverTimestamp()
              });
            }
          } catch (err) {
            console.error("Error getting location:", err);
          }

          // Do NOT set isOnline true here
          setIsOnline(false);
          
          // Double-check that rideInProgress is false
          setTimeout(() => {
            console.log('Double checking ride state:', {
              rideInProgress: false,
              isOnline: false,
              rideCooldown: false
            });
            setRideInProgress(false);
          }, 500);
          
          console.log('Driver is now offline and unavailable for new rides until manually going online');
        } catch (error) {
          console.error("Error updating driver status:", error);
        }
      };
      
      updateDriverStatus();
      
      // Reset navigation flag to allow future navigations ONLY after ride completion
      hasNavigatedToRideRef.current = false;
      
      // Clear the rideCompleted param to prevent multiple resets
      navigation.setParams({ rideCompleted: undefined });
    }
  }, [route.params?.rideCompleted, auth.currentUser]);

  // -----------------------------------------------------------------
  // 5. Load persisted earnings, ride count, active time, and last reset week
  // -----------------------------------------------------------------
  const loadPersistedData = async () => {
    if (!auth.currentUser) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error("No authenticated user found");
      return;
    }

    // Prevent multiple navigations to ride screen
    if (hasNavigatedToRideRef.current) {
      console.log('🚫 Already navigated to ride screen, skipping navigation');
      return;
    }

    // Check if we're in navigation cooldown
    if (navigationCooldownRef.current) {
      console.log('🚫 Navigation cooldown active, skipping navigation');
      return;
    }

    // Check if we're already on a ride screen
    // Use a safer approach to check current route since getCurrentRoute() may not be available
    const currentRouteName = navigation.getState()?.routes?.[navigation.getState()?.index]?.name;
    if (currentRouteName && currentRouteName.includes('RideInProgress')) {
      console.log('🚫 Already on ride screen, skipping navigation');
      return;
    }

    // Add a small delay to prevent rapid navigation attempts
    await new Promise(resolve => setTimeout(resolve, 200));

    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const earningsKey = `earnings_${currentUser.uid}_${todayString}`;
    const rideCountKey = `rideCount_${currentUser.uid}`;
    const activeTimeKey = `activeTime_${currentUser.uid}`;
    const lastResetWeekKey = `lastResetWeek_${currentUser.uid}`;
    const lastEarningsDateKey = `lastEarningsDate_${currentUser.uid}`;
    
    try {
      const storedEarnings = await AsyncStorage.getItem(earningsKey);
      const storedRideCount = await AsyncStorage.getItem(rideCountKey);
      const storedActiveTime = await AsyncStorage.getItem(activeTimeKey);
      const storedLastResetWeek = await AsyncStorage.getItem(lastResetWeekKey);
      const storedLastEarningsDate = await AsyncStorage.getItem(lastEarningsDateKey);
      const storedRide = await AsyncStorage.getItem('currentRide');

      // Check for existing ride
      if (storedRide) {
        const rideState = JSON.parse(storedRide);
        console.log('🔍 Found stored ride state:', rideState);
        
        // Check if ride is completed - if so, clean up and don't navigate
        if (rideState.hasDroppedOffCustomer) {
          console.log('✅ Ride already completed, cleaning up stored data');
          await AsyncStorage.removeItem('currentRide');
          return;
        }
        
        // If rideId exists but customerId doesn't, try to fetch it from Firestore
        if (rideState.rideId && !rideState.customerId) {
          try {
            console.log('Fetching customerId for stored ride:', rideState.rideId);
            const rideRequestRef = doc(db, "rideRequests", rideState.rideId);
            const rideRequestDoc = await getDoc(rideRequestRef);
            
            if (rideRequestDoc.exists()) {
              const rideData = rideRequestDoc.data();
              rideState.customerId = rideData.userId || rideData.customerId;
              console.log('Found customerId for stored ride:', rideState.customerId);
              
              // Update the stored ride state with the customerId
              await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
            }
          } catch (error) {
            console.error('Error fetching customerId for stored ride:', error);
          }
        }
        
        // Double-check navigation flag before proceeding
        if (hasNavigatedToRideRef.current) {
          console.log('🚫 Navigation flag set, skipping navigation');
          return;
        }
        
        // Set flag to prevent multiple navigations
        hasNavigatedToRideRef.current = true;
        
        // Set navigation cooldown
        navigationCooldownRef.current = true;
        setTimeout(() => {
          navigationCooldownRef.current = false;
        }, 3000); // 3 second cooldown
        
        // Navigate to the appropriate screen based on currentStep
        console.log('🚀 Navigating to RideInProgressScreen with step:', rideState.currentStep);
        navigation.navigate("RideInProgressScreen", rideState);
        return;
      }

      // Reset earnings if it's a new day
      if (storedLastEarningsDate && storedLastEarningsDate !== todayString) {
        setEarnings(0);
      } else if (storedEarnings !== null) {
        setEarnings(parseFloat(storedEarnings));
      }
      
      if (storedRideCount !== null) {
        setRideCount(parseInt(storedRideCount, 10));
      }
      if (storedActiveTime !== null) {
        setActiveTime(parseInt(storedActiveTime, 10));
      }
      if (storedLastResetWeek !== null) {
        setLastResetWeek(parseInt(storedLastResetWeek, 10));
      }
      if (storedLastEarningsDate !== null) {
        setLastEarningsDate(storedLastEarningsDate);
      }
    } catch (error) {
      console.error("Error loading persisted data:", error);
    }
  };

  // -----------------------------------------------------------------
  // 6. Fetch Driver's Info (Name, Type, Photo) from Firestore
  // -----------------------------------------------------------------
  const fetchDriverDataFromFirestore = async () => {
    if (!auth.currentUser) return;

    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error("No authenticated user found");
      return;
    }

    try {
      console.log("Fetching driver data from Firestore...");
      // First try to get from AsyncStorage
      const cachedData = await AsyncStorage.getItem('driverInfo');
      if (cachedData) {
        console.log("Found cached data in AsyncStorage");
        const parsedData = JSON.parse(cachedData);
        console.log("Cached data:", parsedData);
        console.log("Cached photo URL:", parsedData.photo);
        setUserName(parsedData.firstName || "Driver");
        setDriverType(parsedData.driverType || "");
        setDriverRating(parsedData.rating || 4.0); // Get rating from Firebase, default to 4.0
        if (parsedData.photo || parsedData.facePhoto) {
          const photoUrl = parsedData.photo || parsedData.facePhoto;
          console.log("Setting photo from cache:", photoUrl);
          setDriverPhoto(photoUrl);
        } else {
          console.log("No photo URL found in cached data");
        }
      } else {
        console.log("No cached data found in AsyncStorage");
      }

      // Then fetch from Firestore to ensure we have the latest data
      const docRef = doc(db, "Drivers", currentUser.uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        console.log("Firestore data:", docSnap.data());
        const userData = docSnap.data();
        setUserName(userData.firstName || "Driver");
        setDriverType(userData.driverType || "");
        setDriverRating(userData.rating || 4.0); // Get rating from Firebase, default to 4.0
        if (userData.photo || userData.facePhoto) {
          const photoUrl = userData.photo || userData.facePhoto;
          console.log("Setting photo from Firestore:", photoUrl);
          setDriverPhoto(photoUrl);
        } else {
          console.log("No photo URL found in Firestore data");
        }
        
        // Update AsyncStorage with latest data
        await AsyncStorage.setItem('driverInfo', JSON.stringify(userData));
        console.log("Updated AsyncStorage with latest data");
      } else {
        console.log("No such document in Firestore!");
      }
    } catch (error) {
      console.error("Error fetching driver data:", error);
    }
  };

  // -----------------------------------------------------------------
  // 6.5. Real-time Driver Data Listener (including rating)
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!auth.currentUser) return;

    const currentUser = auth.currentUser;
    console.log("Setting up real-time driver data listener for:", currentUser.uid);

    const driverRef = doc(db, "Drivers", currentUser.uid);
    const unsubscribe = onSnapshot(driverRef, (doc) => {
      if (doc.exists()) {
        const userData = doc.data();
        console.log("Real-time driver data update:", userData);
        
        // Update all driver data in real-time
        setUserName(userData.firstName || "Driver");
        setDriverType(userData.driverType || "");
        setDriverRating(userData.rating || 4.0); // Real-time rating updates
        
        if (userData.photo || userData.facePhoto) {
          const photoUrl = userData.photo || userData.facePhoto;
          setDriverPhoto(photoUrl);
        }
        
        // Update AsyncStorage with latest data
        AsyncStorage.setItem('driverInfo', JSON.stringify(userData));
        console.log("Real-time driver data updated, including rating:", userData.rating);
      }
    }, (error) => {
      console.error("Error in real-time driver data listener:", error);
    });

    return () => {
      console.log("Cleaning up real-time driver data listener");
      unsubscribe();
    };
  }, [auth.currentUser]);

  // -----------------------------------------------------------------
  // 7. Get Current Location
  // -----------------------------------------------------------------
  useEffect(() => {
    const setupLocation = async () => {
      try {
        console.log('Setting up location...');
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log('Location permission status:', status);
        
        if (status !== 'granted') {
          console.error('Location permission not granted');
          Alert.alert(
            'Location Permission Required',
            'Please enable location services to use the map.',
            [{ text: 'OK' }]
          );
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          maximumAge: 10000
        });
        console.log('Current location:', location);
        
        if (!location || !location.coords) {
          console.error('Invalid location data received');
          Alert.alert(
            'Location Error',
            'Unable to get your current location. Please check your location settings.',
            [{ text: 'OK' }]
          );
          return;
        }

        const newRegion = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        };
        
        console.log('Setting new region:', newRegion);
        setRegion(newRegion);
        setFromLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch (error) {
        console.error('Error in setupLocation:', error);
        Alert.alert(
          'Error',
          'There was an error setting up the map. Please try again.',
          [{ text: 'OK' }]
        );
      }
    };

    setupLocation();
  }, []);

  // Add this new effect to monitor map state
  useEffect(() => {
    // Only log when region actually changes significantly
    if (region && fromLocation) {
      const distance = Math.sqrt(
        Math.pow(region.latitude - fromLocation.latitude, 2) +
        Math.pow(region.longitude - fromLocation.longitude, 2)
      );
      if (distance > 0.001) { // Only log if region changed significantly
        console.log('Map region updated:', {
          latitude: region.latitude,
          longitude: region.longitude,
          currentUser: auth.currentUser?.uid
        });
      }
    }
  }, [region?.latitude, region?.longitude, fromLocation, auth.currentUser]);

  // -----------------------------------------------------------------
  // 8. Subscribe to SelectedDriver collection for ride offers
  // -----------------------------------------------------------------
  useEffect(() => {
    console.log('[SELECTED DRIVER SUBSCRIPTION] Triggered with:', {
      isOnline,
      rideInProgress,
      rideCooldown,
      driverType,
      fromLocation,
      currentUser: auth.currentUser?.uid
    });

    // Clean up existing subscription
    if (onSnapshotUnsubscribe.current) {
      onSnapshotUnsubscribe.current();
      onSnapshotUnsubscribe.current = null;
    }

    if (!isOnline || rideInProgress || rideCooldown || !driverType || !auth.currentUser) {
      console.log('Not subscribing to SelectedDriver because:', {
        isOnline,
        rideInProgress,
        rideCooldown,
        driverType,
        hasUser: !!auth.currentUser
      });
      setCurrentRideRequest(null);
      return;
    }

    console.log('Setting up SelectedDriver subscription...');

    const currentUserId = auth.currentUser.uid;
    
    // Query SelectedDriver collection for this driver
    const q = query(
      collection(db, "SelectedDriver"),
      where("driverId", "==", currentUserId),
      where("status", "==", "selected"),
      where("notificationSent", "==", true)
    );

    console.log('Setting up SelectedDriver subscription with query:', {
      driverId: currentUserId,
      status: "selected",
      notificationSent: true
    });

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      console.log('Received SelectedDriver snapshot:', {
        empty: snapshot.empty,
        size: snapshot.size,
        docs: snapshot.docs.map(doc => ({ 
          id: doc.id, 
          status: doc.data().status,
          rideId: doc.data().rideId 
        }))
      });

      // If the snapshot is empty, hide the modal and clear the current ride request
      if (snapshot.empty) {
        console.log('No selected driver documents found for this driver');
        setIsModalVisible(false);
        setCurrentRideRequest(null);
        return;
      }

      // Get the most recent selected driver document
      const docItem = snapshot.docs[0];
      const selectedDriverData = { id: docItem.id, ...docItem.data() };
      
      console.log('[RIDE OFFER] Processing selected driver document:', {
        selectedDriverId: selectedDriverData.id,
        rideId: selectedDriverData.rideId,
        status: selectedDriverData.status,
        notificationSent: selectedDriverData.notificationSent,
        currentUser: auth.currentUser?.uid
      });

      // Check if the ride is still valid (not expired)
      const now = new Date();
      const expiresAt = selectedDriverData.expiresAt?.toDate();
      
      if (expiresAt && now > expiresAt) {
        console.log('Selected driver document has expired');
        setIsModalVisible(false);
        setCurrentRideRequest(null);
        return;
      }

      // Check if we already have this ride request
      if (currentRideRequestRef.current && currentRideRequestRef.current.id === selectedDriverData.rideId) {
        console.log('Already processing this ride request');
        return;
      }

      // Process the ride offer
      try {
        const rideWithCustomerInfo = {
          id: selectedDriverData.rideId,
          ...selectedDriverData.rideInfo,
          firstName: selectedDriverData.driverInfo?.firstName || "Customer",
          lastName: selectedDriverData.driverInfo?.lastName || '',
          number: selectedDriverData.driverInfo?.phoneNumber || "",
          photo: selectedDriverData.driverInfo?.photo || "",
          customerId: selectedDriverData.rideInfo?.customerId || selectedDriverData.rideInfo?.userId,
          distanceToPickup: selectedDriverData.selectionCriteria?.distanceToPickup,
          driverRating: selectedDriverData.selectionCriteria?.driverRating,
          totalEligibleDrivers: selectedDriverData.selectionCriteria?.totalEligibleDrivers
        };
        
        console.log('Ride with customer info:', rideWithCustomerInfo);
        
        setCurrentRideRequest(rideWithCustomerInfo);
        setIsLoadingAddress(true);
        
        try {
          const pickupLocation = { latitude: selectedDriverData.rideInfo.pickupLat, longitude: selectedDriverData.rideInfo.pickupLng };
          const destinationLocation = {
            latitude: selectedDriverData.rideInfo.destinationLat,
            longitude: selectedDriverData.rideInfo.destinationLng,
          };
          const distance = calculateDistance(pickupLocation, destinationLocation);
          console.log('Calculated distance:', distance);
          setRideDistance(distance);
          const estimatedMinutes = Math.round((distance / 30) * 60);
          setEstimatedTime(estimatedMinutes);
          const pickupLoc = await Location.reverseGeocodeAsync(pickupLocation);
          const pickupAddr =
            pickupLoc.length > 0
              ? `${pickupLoc[0].name || ""} ${pickupLoc[0].street || ""}`
              : "Pickup Address Not Found";
          setPickupAddress(pickupAddr);
          const destLoc = await Location.reverseGeocodeAsync(destinationLocation);
          const destAddr =
            destLoc.length > 0
              ? `${destLoc[0].name || ""} ${destLoc[0].street || ""}`
              : "Destination Address Not Found";
          setDestinationAddress(destAddr);
        } catch (error) {
          console.error("Error in reverse geocoding:", error);
          setPickupAddress("Pickup Address Not Available");
          setDestinationAddress("Destination Address Not Available");
        } finally {
          setIsLoadingAddress(false);
          setIsModalVisible(true);
          setTimeLeft(15);
          startTimer();
          Animated.timing(countdownAnim, {
            toValue: 0,
            duration: 15000,
            useNativeDriver: false,
          }).start();
        }
      } catch (error) {
        console.error("Error processing selected driver document:", error);
      }
    }, (error) => {
      console.error("Error in SelectedDriver subscription:", error);
      // Handle Firestore connection errors gracefully
      if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
        console.log('Firestore connection error, will retry automatically');
        // The subscription will automatically retry when the connection is restored
      } else {
        console.error('Unexpected Firestore error:', error);
      }
    });

    // Store the subscription for cleanup
    onSnapshotUnsubscribe.current = unsubscribe;
    
    // Return cleanup function
    return () => {
      if (onSnapshotUnsubscribe.current) {
        onSnapshotUnsubscribe.current();
        onSnapshotUnsubscribe.current = null;
      }
    };
  }, [isOnline, rideInProgress, rideCooldown, driverType, fromLocation]);

  // -----------------------------------------------------------------
  // 9. Countdown Timer for Auto-Decline
  // -----------------------------------------------------------------
  useEffect(() => {
    if (isModalVisible && timeLeft === 0) {
      declineRide();
    }
  }, [timeLeft]);

  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    countdownAnim.setValue(1);
    timerRef.current = setInterval(() => {
      setTimeLeft((prevTime) => {
        if (prevTime <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isModalVisible && timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [isModalVisible]);

  // -----------------------------------------------------------------
  // 10. Toggle Online/Offline + Active Time Tracking
  // -----------------------------------------------------------------
  useEffect(() => {
    if (isOnline) {
      setStartTime(Date.now());
      intervalRef.current = setInterval(() => {
        setActiveTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isOnline]);

  const animateButton = () => {
    // Reset animations
    buttonScale.setValue(1);
    pulseAnimation.setValue(1);
    
    // Scale animation
    Animated.sequence([
      Animated.timing(buttonScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(buttonScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    // Ripple animation
    Animated.parallel([
      Animated.timing(pulseAnimation, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(buttonGlow, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const showStatusAnimation = (isGoingOnline) => {
    setShowStatusPopup(true);
    statusPopupAnim.setValue(0);
    statusTextAnim.setValue(0);
    ringAnim1.setValue(0);
    ringAnim2.setValue(0);
    ringAnim3.setValue(0);
    iconAnim.setValue(0);

    Animated.parallel([
      Animated.sequence([
        Animated.spring(statusPopupAnim, {
          toValue: 1,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(statusPopupAnim, {
          toValue: 0,
          duration: 400,
          delay: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(statusTextAnim, {
          toValue: 1,
          duration: 400,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(statusTextAnim, {
          toValue: 0,
          duration: 300,
          delay: 1000,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.spring(iconAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          delay: 100,
          useNativeDriver: true,
        }),
        Animated.timing(iconAnim, {
          toValue: 0,
          duration: 300,
          delay: 1000,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(ringAnim1, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringAnim1, {
          toValue: 0,
          duration: 400,
          delay: 800,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(ringAnim2, {
          toValue: 1,
          duration: 600,
          delay: 100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringAnim2, {
          toValue: 0,
          duration: 400,
          delay: 700,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(ringAnim3, {
          toValue: 1,
          duration: 600,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ringAnim3, {
          toValue: 0,
          duration: 400,
          delay: 600,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setShowStatusPopup(false);
    });
  };

  const toggleOnlineStatus = async () => {
    // Start loading state immediately
    setIsUpdatingStatus(true);
    
    // Start the animation sequence immediately
    Animated.sequence([
      // Initial scale down
      Animated.timing(buttonScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      // Scale up with glow effect and expanding rings
      Animated.parallel([
        Animated.spring(buttonScale, {
          toValue: 1.2,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(buttonGlow, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(screenGlowAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        // First expanding ring
        Animated.sequence([
          Animated.timing(expandingRing1, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(expandingRing1, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        // Second expanding ring
        Animated.sequence([
          Animated.timing(expandingRing2, {
            toValue: 1,
            duration: 800,
            delay: 100,
            useNativeDriver: true,
          }),
          Animated.timing(expandingRing2, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        // Third expanding ring
        Animated.sequence([
          Animated.timing(expandingRing3, {
            toValue: 1,
            duration: 800,
            delay: 200,
            useNativeDriver: true,
          }),
          Animated.timing(expandingRing3, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    const newStatus = !isOnline;
    
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error("No authenticated user found");
        return;
      }

      const driverRef = doc(db, "Drivers", currentUser.uid);
      
      // Get current location before updating status
      const currentLocation = await Location.getCurrentPositionAsync({});
      
      // Enhanced update data with all necessary fields
      const updateData = {
        isOnline: newStatus,
        isAvailable: newStatus, // Ensure availability matches online status
        rideInProgress: false, // Reset ride progress when going online
        currentRideId: null, // Clear any current ride
        lastOnlineUpdate: new Date().toISOString(),
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        lastLocationUpdate: new Date().toISOString()
      };

      // If going offline, also set isAvailable to false
      if (!newStatus) {
        updateData.isAvailable = false;
      }

      console.log('Updating driver status:', updateData);
      await updateDoc(driverRef, updateData);

      // Only update local state after successful Firestore update
      setIsOnline(newStatus);
      
      // Update notification status
      await updateDriverNotificationStatus(newStatus);
      
      // Scale back to normal with success check
      Animated.parallel([
        Animated.spring(buttonScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(buttonGlow, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(screenGlowAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(successScaleAnimation, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(successScaleAnimation, {
            toValue: 0,
            duration: 200,
            delay: 500,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      console.log(`Driver ${currentUser.uid} is now ${newStatus ? 'online' : 'offline'}`);
      console.log('[TOGGLE ONLINE] Driver status updated in Firestore:', updateData);
    } catch (error) {
      console.error("Error updating online status:", error);
      // Revert the animation if there's an error
      Animated.parallel([
        Animated.spring(buttonScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(buttonGlow, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(screenGlowAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // -----------------------------------------------------------------
  // 11. Weekly Reset of Active Time
  // -----------------------------------------------------------------
  useEffect(() => {
    const currentWeek = getWeekNumber(new Date());
    if (lastResetWeek && currentWeek !== lastResetWeek) {
      setActiveTime(0);
      setLastResetWeek(currentWeek);
      saveActiveTimeToStorage(0, currentWeek);
    }
  }, [lastResetWeek]);

  const getWeekNumber = (date) => {
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - startOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  };

  const saveActiveTimeToStorage = async (time, week) => {
    const currentUser = auth.currentUser;
    if (currentUser) {
      const activeTimeKey = `activeTime_${currentUser.uid}`;
      const lastResetWeekKey = `lastResetWeek_${currentUser.uid}`;
      try {
        await AsyncStorage.setItem(activeTimeKey, time.toString());
        await AsyncStorage.setItem(lastResetWeekKey, week.toString());
      } catch (error) {
        console.error("Error saving active time data:", error);
      }
    }
  };

  // -----------------------------------------------------------------
  // 12. Format Active Time (HH:mm:ss)
  // -----------------------------------------------------------------
  const formatActiveTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // -----------------------------------------------------------------
  // 13. Calculate Distance (Haversine formula)
  // -----------------------------------------------------------------
  const calculateDistance = (point1, point2) => {
    const R = 6371; // km
    const dLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
    const dLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((point1.latitude * Math.PI) / 180) *
        Math.cos((point2.latitude * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(1));
  };

  // -----------------------------------------------------------------
  // 13.5. Render Star Rating with Tier System
  // -----------------------------------------------------------------
  const getDriverTier = (rating) => {
    if (rating >= 5.0) return { tier: 'Platinum', color: '#E5E4E2', icon: 'diamond' };
    if (rating >= 4.5) return { tier: 'Diamond', color: '#B9F2FF', icon: 'diamond' };
    if (rating >= 4.0) return { tier: 'Gold', color: '#FFD700', icon: 'star' };
    if (rating >= 3.0) return { tier: 'Silver', color: '#C0C0C0', icon: 'star' };
    if (rating >= 2.0) return { tier: 'Bronze', color: '#CD7F32', icon: 'star' };
    return { tier: 'Rookie', color: '#8B8B8B', icon: 'star' };
  };

  // Animate tier badge with pulsing effect
  const animateTierBadge = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(tierBadgeScale, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(tierBadgeScale, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  // Start tier badge animation when component mounts
  useEffect(() => {
    animateTierBadge();
  }, []);

  const renderStarRating = (rating) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;
    const tier = getDriverTier(rating);
    
    // Add full stars
    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <Ionicons
          key={`star-${i}`}
          name="star"
          size={14}
          color="#FFD700"
          style={{ marginRight: 1 }}
        />
      );
    }
    
    // Add half star if needed
    if (hasHalfStar) {
      stars.push(
        <Ionicons
          key="star-half"
          name="star-half"
          size={14}
          color="#FFD700"
          style={{ marginRight: 1 }}
        />
      );
    }
    
    // Add empty stars to complete 5 stars
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    for (let i = 0; i < emptyStars; i++) {
      stars.push(
        <Ionicons
          key={`star-empty-${i}`}
          name="star-outline"
          size={14}
          color="#FFD700"
          style={{ marginRight: 1 }}
        />
      );
    }
    
    return (
      <View style={styles.ratingContainer}>
        {stars}
        <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
        <Animated.View 
          style={[
            styles.tierBadge, 
            { 
              backgroundColor: tier.color,
              transform: [{ scale: tierBadgeScale }]
            }
          ]}
        >
          <Ionicons name={tier.icon} size={10} color="#000" />
          <Text style={styles.tierText}>{tier.tier}</Text>
        </Animated.View>
      </View>
    );
  };

  // -----------------------------------------------------------------
  // 13.6. Update Driver Rating in Firebase
  // -----------------------------------------------------------------
  const updateDriverRating = async (newRating) => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error("No authenticated user found");
        return;
      }

      const driverRef = doc(db, "Drivers", currentUser.uid);
      await updateDoc(driverRef, {
        rating: newRating,
        lastRatingUpdate: serverTimestamp()
      });

      setDriverRating(newRating);
      console.log(`Driver rating updated to ${newRating} in Firebase`);
    } catch (error) {
      console.error("Error updating driver rating:", error);
    }
  };

  // -----------------------------------------------------------------
  // 14. Accept Ride (Update SelectedDriver status and ride request)
  // -----------------------------------------------------------------
  const acceptRide = async () => {
    if (!currentRideRequest) return;
    
    console.log('Accepting ride with customer info:', {
      name: currentRideRequest.firstName,
      phone: currentRideRequest.number,
      photo: currentRideRequest.photo,
      fare: currentRideRequest.fare
    });
    
    if (onSnapshotUnsubscribe.current) {
      onSnapshotUnsubscribe.current();
      onSnapshotUnsubscribe.current = null;
    }
    setRideInProgress(true);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !fromLocation) {
        console.log("Missing driver or location info.");
        return;
      }
      const driverId = currentUser.uid;
      
      const driverDoc = await getDoc(doc(db, "Drivers", driverId));
      const driverPhone = driverDoc.data()?.phoneNumber || null;
      
      const driverRef = doc(db, "Drivers", driverId);
      await updateDoc(driverRef, {
        rideCount: increment(1),
        lastRideTime: new Date().toISOString()
      });

      // Update the ride request status to assigned
      await updateDoc(doc(db, "rideRequests", currentRideRequest.id), {
        status: "assigned",
        driverId,
        driverName: userName,
        driverPhoto: driverPhoto,
        driverPhone: driverPhone,
        assignedAt: new Date()
      });

      // Update SelectedDriver document status to accepted
      const selectedDriverQuery = await getDocs(
        query(
          collection(db, "SelectedDriver"),
          where("rideId", "==", currentRideRequest.id),
          where("driverId", "==", driverId)
        )
      );

      if (!selectedDriverQuery.empty) {
        const selectedDriverDoc = selectedDriverQuery.docs[0];
        await updateDoc(selectedDriverDoc.ref, {
          status: "accepted",
          acceptedAt: new Date()
        });
        console.log('Updated SelectedDriver document status to accepted');
      }

      setIsModalVisible(false);
      if (currentRideRequest.fare) {
        const today = new Date();
        const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const newEarnings = earnings + currentRideRequest.fare;
        setEarnings(newEarnings);
        const earningsKey = `earnings_${driverId}_${todayString}`;
        await AsyncStorage.setItem(earningsKey, newEarnings.toString());
        await AsyncStorage.setItem(`lastEarningsDate_${driverId}`, todayString);
      }
      const today = new Date();
      const year = today.getFullYear();
      const month = (today.getMonth() + 1).toString().padStart(2, "0");
      const day = today.getDate().toString().padStart(2, "0");
      const docId = `${driverId}_${year}${month}${day}`;
      const moneyDocRef = doc(db, "moneyByRider", docId);
      await setDoc(
        moneyDocRef,
        {
          driverId,
          total: increment(currentRideRequest.fare),
          trips: arrayUnion({
            fare: currentRideRequest.fare,
            timestamp: today.toISOString(),
          }),
        },
        { merge: true }
      );
      const newRideCount = rideCount + 1;
      setRideCount(newRideCount);
      const rideCountKey = `rideCount_${driverId}`;
      await AsyncStorage.setItem(rideCountKey, newRideCount.toString());
      
      const navigationParams = {
        pickupLat: currentRideRequest.pickupLat,
        pickupLng: currentRideRequest.pickupLng,
        destinationLat: currentRideRequest.destinationLat,
        destinationLng: currentRideRequest.destinationLng,
        driverLat: fromLocation.latitude,
        driverLng: fromLocation.longitude,
        firstName: currentRideRequest.firstName,
        lastName: currentRideRequest.lastName || '',
        number: currentRideRequest.number,
        ridePrice: currentRideRequest.fare,
        photo: currentRideRequest.photo,
        rideId: currentRideRequest.id,
        customerId: currentRideRequest.customerId || currentRideRequest.userId,
      };
      
      console.log('Navigating to RideInProgressScreen with params:', navigationParams);
      navigation.navigate("RideInProgressScreen", navigationParams);
      setCurrentRideRequest(null);
    } catch (error) {
      console.error("Error accepting ride:", error);
      // Reset states if there's an error
      setRideInProgress(false);
      setCurrentRideRequest(null);
    }
  };

  // -----------------------------------------------------------------
  // 15. Decline Ride (Update SelectedDriver status)
  // -----------------------------------------------------------------
  const declineRide = async () => {
    if (!currentRideRequest) return;
    if (onSnapshotUnsubscribe.current) {
      onSnapshotUnsubscribe.current();
      onSnapshotUnsubscribe.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.log("No authenticated user found");
        return;
      }

      // Update SelectedDriver document status to declined
      const selectedDriverQuery = await getDocs(
        query(
          collection(db, "SelectedDriver"),
          where("rideId", "==", currentRideRequest.id),
          where("driverId", "==", currentUser.uid)
        )
      );

      if (!selectedDriverQuery.empty) {
        const selectedDriverDoc = selectedDriverQuery.docs[0];
        await updateDoc(selectedDriverDoc.ref, {
          status: "declined",
          declinedAt: new Date()
        });
        console.log('Updated SelectedDriver document status to declined');
      }

      // Also update the ride request to add this driver to declined list
      await updateDoc(doc(db, "rideRequests", currentRideRequest.id), {
        declinedDrivers: arrayUnion(currentUser.uid)
      });

      console.log("Ride declined:", currentRideRequest.id);
      setIsModalVisible(false);
      setCurrentRideRequest(null);
      setRideCooldown(true);
      setTimeout(() => setRideCooldown(false), 5000);
    } catch (error) {
      console.error("Error declining ride:", error);
    }
  };

  // -----------------------------------------------------------------
  // 16. Refresh Handler Function
  // -----------------------------------------------------------------
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // Reload driver data and persisted data
      await Promise.all([
        fetchDriverDataFromFirestore(),
        loadPersistedData()
      ]);
      
      // Reset ride request and modal state
      setCurrentRideRequest(null);
      setIsModalVisible(false);
      
      // Force a re-render of the map
      setMapReady(false);
      setTimeout(() => setMapReady(true), 100);
      
      // Update the region to ensure map is centered
      if (fromLocation) {
        setRegion({
          latitude: fromLocation.latitude,
          longitude: fromLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setRefreshing(false);
    }
  };

  // -----------------------------------------------------------------
  // 16.5. Manual Rating Refresh Function
  // -----------------------------------------------------------------
  const refreshDriverRating = async () => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error("No authenticated user found");
        return;
      }

      console.log("Manually refreshing driver rating...");
      const driverRef = doc(db, "Drivers", currentUser.uid);
      const driverDoc = await getDoc(driverRef);
      
      if (driverDoc.exists()) {
        const userData = driverDoc.data();
        const newRating = userData.rating || 4.0;
        setDriverRating(newRating);
        console.log("Driver rating manually refreshed to:", newRating);
      }
    } catch (error) {
      console.error("Error manually refreshing driver rating:", error);
    }
  };

  // -----------------------------------------------------------------
  // 16.6. Periodic Online Update Effect
  // -----------------------------------------------------------------
  useEffect(() => {
    let onlineUpdateInterval = null;
    if (isOnline && auth.currentUser) {
      const driverId = auth.currentUser.uid;
      onlineUpdateInterval = setInterval(async () => {
        try {
          const driverRef = doc(db, "Drivers", driverId);
          await updateDoc(driverRef, {
            lastOnlineUpdate: new Date().toISOString(),
          });
        } catch (err) {
          console.error('Error updating lastOnlineUpdate:', err);
        }
      }, 30000); // Changed from 60000 to 30000 (30 seconds)
    }
    return () => {
      if (onlineUpdateInterval) clearInterval(onlineUpdateInterval);
    };
  }, [isOnline, auth.currentUser]);

  // -----------------------------------------------------------------
  // 17. Render
  if (!region) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <LinearGradient
          colors={["#1A1A1A", "#000000"]}
          style={styles.loadingGradient}
        >
          <ActivityIndicator size="large" color="#FF8C00" />
          <Text style={styles.loadingText}>Obtention de votre position actuelle...</Text>
        </LinearGradient>
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.mapContainer}>
        {region ? (
          <MapView
            ref={mapRef}
            style={[styles.map, { backgroundColor: '#000000' }]}
            initialRegion={region}
            showsUserLocation
            showsMyLocationButton
            onMapReady={() => {
              setMapReady(true);
            }}
            onError={(error) => {
              console.error('Map error:', error);
              Alert.alert(
                'Map Error',
                'There was an error loading the map. Please check your internet connection and try again.',
                [{ text: 'OK' }]
              );
            }}
            loadingEnabled={true}
            loadingIndicatorColor="#FF8C00"
            loadingBackgroundColor="#000000"
          >
            {fromLocation && (
              <Marker
                coordinate={fromLocation}
                title="Your Location"
                description="You are here"
              />
            )}
          </MapView>
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF8C00" />
            <Text style={styles.loadingText}>Loading map...</Text>
          </View>
        )}
        {!mapReady && region && (
          <View style={styles.mapLoadingOverlay}>
            <ActivityIndicator size="large" color="#FF8C00" />
            <Text style={styles.mapLoadingText}>Initializing map...</Text>
          </View>
        )}
      </View>
      {/* Top panel with earnings and settings */}
      <BlurView intensity={80} tint="dark" style={[styles.topPanel, { paddingTop: insets.top }]}>
        <View style={styles.statusBar}>
          <View style={styles.driverStatusContainer}>
            <View style={[styles.statusDot, isOnline ? styles.statusDotOnline : styles.statusDotOffline]} />
            <Text style={styles.statusText}>{isOnline ? "En ligne" : "Hors ligne"}</Text>
          </View>
          <View style={styles.topButtonsContainer}>
            <TouchableOpacity
              style={styles.topButton}
              onPress={() => navigation.navigate("OnlineDriverScreen")}
            >
              <Ionicons name="people-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => navigation.navigate("SettingsScreen")}
            >
              <Ionicons name="settings-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>
        
        <TouchableOpacity
          style={styles.earningsCard}
          onPress={() => {
            const currentActiveTime = isOnline ? Math.floor((Date.now() - startTime) / 1000) : activeTime;
            navigation.navigate("EarningsScreen", { 
              isOnline,
              activeTime: currentActiveTime,
              startTime: isOnline ? startTime : null,
              rideCount: rideCount
            });
          }}
        >
          <LinearGradient
            colors={["#2C2C2C", "#1A1A1A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.earningsGradient}
          >
            <View style={styles.earningsRow}>
              <View>
                <Text style={styles.earningsLabel}>Gains du jour</Text>
                <Text style={styles.earningsText}>Fdj{earnings.toFixed(2)}</Text>
              </View>
              <View style={styles.dividerVertical} />
              <View>
                <Text style={styles.earningsLabel}>Courses</Text>
                <Text style={styles.rideCountText}>{rideCount}</Text>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.tapHintText}>Press here to view earnings</Text>

        {/* French message for no ride found - moved to top panel */}
        {isOnline && !currentRideRequest && (
          <View style={styles.noRideMessage}>
            <BlurView intensity={80} tint="dark" style={styles.noRideBlur}>
              <View style={styles.noRideContent}>
                <MaterialIcons name="info-outline" size={20} color="#FF8C00" style={styles.noRideIcon} />
                <Text style={styles.noRideText}>
                  Si vous ne trouvez pas de course, essayez de redémarrer l'application
                </Text>
              </View>
            </BlurView>
          </View>
        )}

        <View style={styles.refreshContainer}>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={onRefresh}
            activeOpacity={0.7}
          >
            <Ionicons name="refresh" size={20} color="#FF6F00" />
          </TouchableOpacity>
          <Text style={styles.refreshMessage}>
            Appuyer sur le bouton ci-dessus si vous remarquez des comportements inhabituels
          </Text>
        </View>

        {isOnline && !currentRideRequest && (
          <Animated.View 
            style={[
              styles.searchingContainer,
              { opacity: fadeAnim }
            ]}
          >
            <BlurView intensity={80} tint="dark" style={styles.searchingBlur}>
              <View style={styles.searchingContent}>
                <ActivityIndicator size="small" color="#FF8C00" />
                <Text style={styles.searchingText}>Recherche de courses en cours...</Text>
              </View>
            </BlurView>
          </Animated.View>
        )}
      </BlurView>

      {/* Screen-wide glow effect */}
      <Animated.View
        style={[
          styles.screenGlow,
          {
            opacity: screenGlowAnim,
            transform: [
              {
                scale: screenGlowAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.5],
                }),
              },
            ],
          },
        ]}
      />
      
      {/* Expanding rings */}
      <Animated.View
        style={[
          styles.expandingRing,
          {
            transform: [
              {
                scale: expandingRing1.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 3],
                }),
              },
            ],
            opacity: expandingRing1.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.5, 0],
            }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.expandingRing,
          {
            transform: [
              {
                scale: expandingRing2.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 3],
                }),
              },
            ],
            opacity: expandingRing2.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.5, 0],
            }),
          },
        ]}
      />
      <Animated.View
        style={[
          styles.expandingRing,
          {
            transform: [
              {
                scale: expandingRing3.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 3],
                }),
              },
            ],
            opacity: expandingRing3.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 0.5, 0],
            }),
          },
        ]}
      />
      
      {/* Go Online Button */}
      <View style={styles.onlineButtonContainer}>
        <Animated.View
          style={[
            styles.onlineButtonWrapper,
            {
              transform: [
                { scale: isOnline ? 1 : pulseAnimation },
                { scale: buttonScale }
              ],
            },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.onlineButton,
              isOnline ? styles.onlineButtonActive : {},
              isUpdatingStatus && styles.onlineButtonUpdating
            ]}
            onPress={toggleOnlineStatus}
            activeOpacity={1}
            disabled={isUpdatingStatus}
          >
            <LinearGradient
              colors={isOnline ? ["#1D7A1D", "#228B22"] : ["#E67E00", "#FF8C00"]}
              style={styles.buttonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              {isUpdatingStatus ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Animated.View
                    style={[
                      styles.glowEffect,
                      {
                        opacity: buttonGlow,
                        transform: [
                          {
                            scale: buttonGlow.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 1.5],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                  <Text style={styles.onlineButtonText}>
                    {isOnline ? "EN LIGNE" : "GO"}
                  </Text>
                  {!isOnline && (
                    <Animated.View
                      style={[
                        styles.ripple,
                        {
                          transform: [
                            {
                              scale: pulseAnimation.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0.5, 2],
                              }),
                            },
                          ],
                          opacity: pulseAnimation,
                        },
                      ]}
                    />
                  )}
                  <Animated.View
                    style={[
                      styles.successCheck,
                      {
                        opacity: successScaleAnimation,
                        transform: [
                          {
                            scale: successScaleAnimation.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.8, 1],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    <Ionicons name="checkmark" size={24} color="#FFFFFF" />
                  </Animated.View>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Driver Info Card */}
      {mapReady && (
        <View style={styles.driverCardContainer}>
          <BlurView intensity={80} tint="dark" style={styles.driverCard}>
            <View style={styles.driverInfo}>
              {driverPhoto ? (
                <Image 
                  source={{ uri: driverPhoto }} 
                  style={styles.driverPhoto}
                  onError={(error) => {
                    console.error("Error loading driver photo:", error.nativeEvent.error);
                    setDriverPhoto(""); // Reset photo on error
                  }}
                  onLoad={() => console.log("Driver photo loaded successfully")}
                />
              ) : (
                <View style={styles.driverPhotoPlaceholder}>
                  <Ionicons name="person" size={30} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>{userName}</Text>
                <Text style={styles.driverType}>{driverType || "Chauffeur"}</Text>
                {renderStarRating(driverRating)}
              </View>
            </View>
          </BlurView>
        </View>
      )}

      {/* Ride Request Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalVisible}
        onRequestClose={() => {}}
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
            <View style={styles.modalContent}>
              {isLoadingAddress ? (
                <View style={styles.loadingModalContent}>
                  <ActivityIndicator size="large" color="#FF8C00" />
                  <Text style={styles.loadingModalText}>Traitement de la demande de course...</Text>
                </View>
              ) : (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Nouvelle demande de course</Text>
                    <LinearGradient
                      colors={timeLeft <= 5 ? ["#FF3B30", "#FF5E3A"] : ["#FF8C00", "#FFA500"]}
                      style={styles.timerGradient}
                    >
                      <Animated.View
                        style={[
                          styles.timerFill,
                          {
                            transform: [{ scale: countdownAnim }],
                          },
                        ]}
                      />
                      <Text style={styles.timerText}>{timeLeft}</Text>
                    </LinearGradient>
                  </View>
                  
                  <LinearGradient
                    colors={["#2C2C2C", "#222222"]}
                    style={styles.rideCard}
                  >
                    <View style={styles.addressContainer}>
                      <View style={styles.addressRow}>
                        <View style={styles.addressIconContainer}>
                          <View style={[styles.dot, styles.pickupDot]} />
                        </View>
                        <View style={styles.addressTextContainer}>
                          <Text style={styles.addressLabel}>DÉPART</Text>
                          <Text style={styles.addressText}>{pickupAddress}</Text>
                        </View>
                      </View>
                      <View style={styles.routeLine} />
                      <View style={styles.addressRow}>
                        <View style={styles.addressIconContainer}>
                          <View style={[styles.dot, styles.destinationDot]} />
                        </View>
                        <View style={styles.addressTextContainer}>
                          <Text style={styles.addressLabel}>DESTINATION</Text>
                          <Text style={styles.addressText}>{destinationAddress}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Customer Information Section */}
                    <View style={styles.customerContainer}>
                      <View style={styles.customerInfo}>
                        <View style={styles.customerPhotoContainer}>
                          {currentRideRequest?.photo ? (
                            <Image
                              source={{ uri: currentRideRequest.photo }}
                              style={styles.customerPhoto}
                            />
                          ) : (
                            <MaterialCommunityIcons name="account" size={24} color="#FFFFFF" />
                          )}
                        </View>
                        <View style={styles.customerTextContainer}>
                          <Text style={styles.customerName}>
                            {currentRideRequest?.firstName || "Customer"}
                          </Text>
                          {currentRideRequest?.number && (
                            <Text style={styles.customerPhone}>{currentRideRequest.number}</Text>
                          )}
                        </View>
                      </View>
                      
                      {currentRideRequest?.number && (
                        <TouchableOpacity 
                          style={styles.phoneButton}
                          onPress={() => Linking.openURL(`tel:${currentRideRequest.number}`)}
                        >
                          <Ionicons name="call-outline" size={20} color="#FFFFFF" />
                        </TouchableOpacity>
                      )}
                    </View>
                    
                    <View style={styles.rideInfoContainer}>
                      <View style={styles.rideInfoItem}>
                        <MaterialIcons name="attach-money" size={20} color="#FF8C00" />
                        <Text style={styles.rideInfoText}>
                          Fdj{currentRideRequest?.fare?.toFixed(2) || "0.00"}
                        </Text>
                      </View>
                      
                      <View style={styles.dividerVerticalSmall} />
                      
                      <View style={styles.rideInfoItem}>
                        <MaterialIcons name="speed" size={20} color="#FF8C00" />
                        <Text style={styles.rideInfoText}>
                          {rideDistance !== null ? rideDistance.toFixed(1) : "0.0"}
                        </Text>
                      </View>
                      
                      <View style={styles.dividerVerticalSmall} />
                      
                      <View style={styles.rideInfoItem}>
                        <MaterialIcons name="schedule" size={20} color="#FF8C00" />
                        <Text style={styles.rideInfoText}>
                          ~{estimatedTime} min
                        </Text>
                      </View>
                    </View>
                  </LinearGradient>
                  
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={styles.declineButton}
                      onPress={declineRide}
                    >
                      <Text style={styles.declineButtonText}>Decline</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.acceptButton}
                      onPress={acceptRide}
                    >
                      <LinearGradient
                        colors={["#228B22", "#1D7A1D"]}
                        style={styles.acceptButtonGradient}
                      >
                        <Text style={styles.acceptButtonText}>Accept</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </BlurView>
        </View>
      </Modal>

      {showStatusPopup && (
        <Animated.View style={styles.statusPopup}>
          <Animated.View
            style={[
              styles.statusRing,
              {
                transform: [
                  {
                    scale: ringAnim1.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 2.5],
                    })
                  },
                ],
                opacity: ringAnim1.interpolate({
                  inputRange: [0, 0.4, 1],
                  outputRange: [0, 0.6, 0],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.statusRing,
              {
                transform: [
                  {
                    scale: ringAnim2.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 2.2],
                    })
                  },
                ],
                opacity: ringAnim2.interpolate({
                  inputRange: [0, 0.4, 1],
                  outputRange: [0, 0.5, 0],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.statusRing,
              {
                transform: [
                  {
                    scale: ringAnim3.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 1.9],
                    })
                  },
                ],
                opacity: ringAnim3.interpolate({
                  inputRange: [0, 0.4, 1],
                  outputRange: [0, 0.4, 0],
                }),
              },
            ]}
          />
          <Animated.View
            style={[
              styles.statusPopupMain,
              {
                transform: [
                  {
                    scale: statusPopupAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.3, 1],
                    }),
                  },
                ],
                opacity: statusPopupAnim,
              },
            ]}
          >
            <LinearGradient
              colors={isOnline ? 
                ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.7)'] : 
                ['rgba(40, 40, 40, 0.95)', 'rgba(30, 30, 30, 0.9)']}
              style={styles.statusPopupGradient}
            >
              <Animated.View
                style={[
                  styles.statusIcon,
                  {
                    transform: [
                      { scale: iconAnim },
                      { 
                        rotate: iconAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['-45deg', '0deg'],
                        })
                      },
                    ],
                    opacity: iconAnim,
                  },
                ]}
              >
                <Ionicons
                  name={isOnline ? "power" : "power-outline"}
                  size={50}
                  color={isOnline ? "#222" : "#fff"}
                />
              </Animated.View>
              <Animated.Text
                style={[
                  styles.statusPopupText,
                  {
                    color: isOnline ? "#222" : "#fff",
                    transform: [
                      {
                        translateY: statusTextAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0],
                        }),
                      },
                    ],
                    opacity: statusTextAnim,
                  },
                ]}
              >
                {isOnline ? "EN LIGNE" : "HORS LIGNE"}
              </Animated.Text>
            </LinearGradient>
          </Animated.View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000000",
  },
  loadingGradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "#FFFFFF",
    marginTop: 16,
    fontSize: 16,
    fontWeight: "500",
  },
  topPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 40, // Add padding at the top
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    zIndex: 2,
    elevation: 5,
  },
  statusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 0, // Remove negative margin
    marginBottom: 10, // Add some space between status bar and earnings card
  },
  driverStatusContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusDotOnline: {
    backgroundColor: "#4CD964",
    shadowColor: "#4CD964",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 5,
  },
  statusDotOffline: {
    backgroundColor: "#FF3B30",
  },
  statusText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
  },
  settingsButton: {
    padding: 8,
  },
  earningsCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 4,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  earningsGradient: {
    padding: 16,
    borderRadius: 16,
  },
  earningsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  earningsLabel: {
    color: "#BBBBBB",
    fontSize: 14,
    marginBottom: 6,
  },
  earningsText: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "700",
  },
  rideCountText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginVertical: 12,
  },
  dividerVertical: {
    width: 1,
    height: "90%",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: 16,
  },
  dividerVerticalSmall: {
    width: 1,
    height: 24,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    marginHorizontal: 10,
  },
  timeContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  timeText: {
    marginLeft: 8,
    color: "#BBBBBB",
    fontSize: 14,
  },
  timeValue: {
    color: "#FFFFFF",
    fontWeight: "500",
  },
  onlineButtonContainer: {
    position: "absolute",
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 3,
    elevation: 6,
  },
  onlineButtonWrapper: {
    shadowColor: "#FF8C00",
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
  onlineButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    position: 'relative',
  },
  onlineButtonActive: {
    shadowColor: "#228B22",
  },
  buttonGradient: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    position: 'relative',
  },
  onlineButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    width: "100%",
  },
  driverCardContainer: {
    position: "absolute",
    bottom: 200, // Position it above the online button which is at bottom: 100
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 2,
    elevation: 5,
  },
  driverCard: {
    width: "90%",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  driverInfo: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  driverPhoto: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 16,
    borderWidth: 2,
    borderColor: "#FF8C00",
  },
  driverPhotoPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  driverDetails: {
    flex: 1,
  },
  driverName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  driverType: {
    color: "#BBBBBB",
    fontSize: 14,
  },
  customMarker: {
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    padding: 8,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: "#FF8C00",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  blurContainer: {
    width: "90%",
    borderRadius: 24,
    overflow: "hidden",
  },
  modalContent: {
    padding: 20,
  },
  loadingModalContent: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 200,
  },
  loadingModalText: {
    color: "#FFFFFF",
    fontSize: 16,
    marginTop: 16,
    textAlign: "center",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "700",
  },
  timerGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  timerFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  timerText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    zIndex: 1,
  },
  rideCard: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 20,
  },
  addressContainer: {
    marginBottom: 16,
  },
  addressRow: {
    flexDirection: "row",
    marginVertical: 6,
  },
  addressIconContainer: {
    width: 24,
    alignItems: "center",
    marginRight: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pickupDot: {
    backgroundColor: "#4CD964",
  },
  destinationDot: {
    backgroundColor: "#FF3B30",
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: "#666666",
    marginLeft: 18,
  },
  addressTextContainer: {
    flex: 1,
  },
  addressLabel: {
    color: "#BBBBBB",
    fontSize: 12,
    marginBottom: 4,
  },
  addressText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
  rideInfoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderRadius: 12,
    padding: 12,
  },
  rideInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  rideInfoText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    marginLeft: 6,
  },
  customerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    marginBottom: 16,
    backgroundColor: "rgba(255, 140, 0, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 140, 0, 0.3)",
  },
  customerInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  customerPhotoContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#444444",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#FF8C00",
  },
  customerPhoto: {
    width: "100%",
    height: "100%",
    borderRadius: 25,
  },
  customerTextContainer: {
    flex: 1,
  },
  customerName: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  customerPhone: {
    color: "#FF8C00",
    fontSize: 14,
    fontWeight: "500",
  },
  phoneButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FF8C00",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 12,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  declineButton: {
    flex: 1,
    marginRight: 10,
    height: 50,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  declineButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  acceptButton: {
    flex: 1.5,
    height: 50,
    borderRadius: 12,
    overflow: "hidden",
  },
  acceptButtonGradient: {
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  acceptButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  ripple: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  statusPopup: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  statusRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  statusPopupMain: {
    width: 180,
    height: 180,
    borderRadius: 90,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.44,
    shadowRadius: 10.32,
    elevation: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  statusPopupGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backdropFilter: 'blur(10px)',
  },
  statusIcon: {
    marginBottom: 15,
  },
  statusPopupText: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 3,
  },
  tapHintText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '500',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  searchingContainer: {
    marginTop: 12,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  searchingBlur: {
    borderRadius: 12,
    overflow: 'hidden',
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  searchingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 12,
  },
  topButtonsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  topButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  refreshContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  refreshButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1E1E1E",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FF6F00",
    marginRight: 8,
  },
  refreshMessage: {
    color: "#b3b3b3",
    fontSize: 12,
    flex: 1,
    fontStyle: "italic",
  },
  noRideMessage: {
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  noRideBlur: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  noRideContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  noRideIcon: {
    marginRight: 10,
  },
  noRideText: {
    flex: 1,
    fontSize: 13,
    color: '#FFFFFF',
    textAlign: 'left',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    lineHeight: 18,
  },
  glowEffect: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 40,
    backgroundColor: '#FFD700',
    opacity: 0.5,
  },
  successCheck: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  screenGlow: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(255, 215, 0, 0.2)',
    zIndex: 1,
  },
  expandingRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFD700',
    top: '50%',
    left: '50%',
    marginLeft: -40,
    marginTop: -40,
    zIndex: 2,
  },
  onlineButtonUpdating: {
    opacity: 0.8,
  },
  mapLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapLoadingText: {
    color: '#FFFFFF',
    marginTop: 10,
    fontSize: 16,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  tierBadge: {
    backgroundColor: '#FFD700',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 5,
  },
  tierText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default HomeScreenWithMap;
