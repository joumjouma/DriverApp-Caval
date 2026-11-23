import React, { useState, useEffect, useRef, useCallback } from "react";
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
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
  AppState,
  BackHandler,
  Vibration,
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
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
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
import RideOfferModal from '../components/RideOfferModal';
import RideOfferService from '../services/RideOfferService';
import notificationService from '../services/NotificationService';
import whatsAppService from '../services/WhatsAppService';
import { useAutoOffline } from '../hooks/useAutoOffline';
import AutoOfflineTimer from '../components/AutoOfflineTimer';

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
    if (finalStatus !== 'granted') {
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

// Error Boundary Wrapper Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('🚨 ERROR BOUNDARY CAUGHT:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>🚨 Application Error</Text>
          <Text style={styles.errorText}>
            The app encountered an error. Please restart the application.
          </Text>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={() => {
              this.setState({ hasError: false, error: null });
              console.log('🔄 Error boundary recovery initiated');
            }}
          >
            <Text style={styles.errorButtonText}>Restart App</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const HomeScreenWithMap = () => {
  // AUTO-OFFLINE SYSTEM: Drivers automatically go offline after exactly 20 minutes (1200 seconds) of being online
  // This is implemented using the useAutoOffline hook and cannot be disabled, overridden, or bypassed
  // The system shows a countdown timer when less than 5 minutes remains, allowing drivers to:
  // - Extend their time for another 20 minutes
  // - Go offline immediately
  // If no action is taken, the driver is automatically set offline after 20 minutes
  // 
  // IMPORTANT: This system is MANDATORY and cannot be disabled. All drivers must go offline
  // after 20 minutes regardless of their preferences or the app state. This ensures:
  // - System reliability and prevents driver overload
  // - Fair distribution of ride opportunities
  // - Compliance with safety and operational requirements
  // - Consistent user experience across all drivers
  
  // -----------------------------------------------------------------
  // 1. All hooks must be called in the same order every render
  // -----------------------------------------------------------------
  // Navigation hooks - call unconditionally
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  
  // Location updates hook - called at top level
  const locationUpdates = useUpdateDriverLocation();

    // Location and map state
    const [region, setRegion] = useState({
      latitude: 11.5883,
      longitude: 43.1453,
      latitudeDelta: 0.0922,
      longitudeDelta: 0.0421,
    });
    
    // Test region to ensure map loads
    useEffect(() => {
      console.log('🗺️ Setting test region to ensure map loads');
      const testRegion = {
        latitude: 11.5883,
        longitude: 43.1453,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      };
      setRegion(testRegion);
      console.log('✅ Test region set:', testRegion);
    }, []);
    const [fromLocation, setFromLocation] = useState(null);
    const [mapReady, setMapReady] = useState(false);

    // Driver info state
    const [userName, setUserName] = useState("Driver");
    const [driverType, setDriverType] = useState("");
    const [driverPhoto, setDriverPhoto] = useState("");
    const [isOnline, setIsOnline] = useState(false);
  
  // PRIMARY AUTO-OFFLINE SYSTEM - This is the main system that ensures drivers go offline
  // exactly 20 minutes (1200 seconds) after going online, with no exceptions or overrides possible
  // The system automatically starts when a driver goes online and cannot be disabled
  // 
  // Key Features:
  // - 20-minute countdown starts immediately when driver goes online
  // - Countdown timer becomes visible when less than 5 minutes remains
  // - Drivers can extend time for another 20 minutes or go offline immediately
  // - If no action taken, automatic offline after exactly 20 minutes
  // - Works even if app goes to background (timer continues running)
  // - Updates Firestore with autoOfflineReason: "1200_second_timeout"
  const { resetTimer, getRemainingTime, clearTimer } = useAutoOffline(
    isOnline, 
    setIsOnline
  );
  
  // Log auto-offline system initialization (only once)
  useEffect(() => {
    console.log('🚀 Auto-offline system initialized in HomeScreenWithMap');
    console.log('⏰ Auto-offline: Timer functions available - resetTimer, getRemainingTime, clearTimer');
    
    // LOGGING INFORMATION:
    // The auto-offline system will now log detailed information to the console:
    // - Timer start/stop events
    // - Countdown progress every minute
    // - When timer component becomes visible (last 5 minutes)
    // - User interactions (extend/offline)
    // - Auto-offline execution
    // 
    // Look for logs starting with: ⏰ Auto-offline, 🚗 Auto-offline, 🚫 Auto-offline
  }, []); // Empty dependency array ensures this only runs once
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
    const [rideInProgress, setRideInProgress] = useState(false);
    const [rideCooldown, setRideCooldown] = useState(false);

    // Time tracking state
    const [lastResetWeek, setLastResetWeek] = useState(null);
    const [activeTime, setActiveTime] = useState(0);
    const [startTime, setStartTime] = useState(null);
    const [timeLeft, setTimeLeft] = useState(20);
    const [lastEarningsDate, setLastEarningsDate] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [appState, setAppState] = useState(AppState.currentState);

    // Animation refs
    const buttonScale = useRef(new Animated.Value(1)).current;
    const buttonGlow = useRef(new Animated.Value(0)).current;
    const screenGlowAnim = useRef(new Animated.Value(0)).current;
    const expandingRing1 = useRef(new Animated.Value(0)).current;
    const expandingRing2 = useRef(new Animated.Value(0)).current;
    const expandingRing3 = useRef(new Animated.Value(0)).current;
    const pulseAnimation = useRef(new Animated.Value(1)).current;
    const countdownAnim = useRef(new Animated.Value(1)).current;
    const successScaleAnimation = useRef(new Animated.Value(0)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const ringAnim1 = useRef(new Animated.Value(0)).current;
    const ringAnim2 = useRef(new Animated.Value(0)).current;
    const ringAnim3 = useRef(new Animated.Value(0)).current;
    const statusPopupAnim = useRef(new Animated.Value(0)).current;
    const iconAnim = useRef(new Animated.Value(0)).current;
    const statusTextAnim = useRef(new Animated.Value(0)).current;
    const tierBadgeScale = useRef(new Animated.Value(1)).current;
    
    // Enhanced GO button animations
    const goButtonPressAnim = useRef(new Animated.Value(1)).current;
    const goButtonGlowIntensity = useRef(new Animated.Value(0)).current;
    const goButtonRipple = useRef(new Animated.Value(0)).current;
    const goButtonSuccess = useRef(new Animated.Value(0)).current;
    const searchingAnimation = useRef(new Animated.Value(0)).current;
    const searchingTextOpacity = useRef(new Animated.Value(0)).current;
    
    // Full-screen circle animation
    const fullScreenCircle = useRef(new Animated.Value(0)).current;
    const fullScreenCircleOpacity = useRef(new Animated.Value(0)).current;
    const fullScreenCircleScale = useRef(new Animated.Value(0)).current;
    const fullScreenText = useRef(new Animated.Value(0)).current;
    const fullScreenIcon = useRef(new Animated.Value(0)).current;

    // Refs for timers and state management
    const intervalRef = useRef(null);
    const timerRef = useRef(null);
    const currentRideRequestRef = useRef(null);
    const hasNavigatedToRideRef = useRef(false);
    const navigationCooldownRef = useRef(false);
    const mapRef = useRef(null);
    const countdownStartTimeRef = useRef(null);
    const onSnapshotUnsubscribe = useRef(null);
    const isManualToggleRef = useRef(false); // Add this flag to prevent auth interference
    const searchingTextIntervalRef = useRef(null); // For searching text animation
    const searchingDotAnimationRef = useRef(null); // For dot animation cleanup
    const circlePulseAnimationRef = useRef(null); // For circle pulse animation cleanup

    // Flags
    const [showStatusPopup, setShowStatusPopup] = useState(false);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLocationLoading, setIsLocationLoading] = useState(true);
    
    // Enhanced GO button states
    const [isGoingOnline, setIsGoingOnline] = useState(false);
    const [showSearchingAnimation, setShowSearchingAnimation] = useState(false);
    const [searchingText, setSearchingText] = useState("Nous cherchons des courses, restez sur place et attendez...");
    
    // Full-screen animation states
    const [showFullScreenAnimation, setShowFullScreenAnimation] = useState(false);
    const [fullScreenMessage, setFullScreenMessage] = useState("");

    // Ride offer state
    const [currentRideOffer, setCurrentRideOffer] = useState(null);
    const [showRideOfferModal, setShowRideOfferModal] = useState(false);

    // Ride offer service - with safe instantiation
    const rideOfferServiceRef = useRef(null);
    
    // Safe initialization of ride offer service
    useEffect(() => {
      try {
        // Use the singleton instance from the service file
        if (RideOfferService && typeof RideOfferService === 'object') {
          rideOfferServiceRef.current = RideOfferService;
          console.log('✅ RideOfferService singleton instance loaded successfully');
        } else {
          console.log('⚠️ RideOfferService not available, ride offers will be disabled');
        }
      } catch (error) {
        console.error('❌ Error loading RideOfferService:', error);
        console.log('⚠️ Ride offers will be disabled due to loading error');
      }
    }, []);
    
    // Get the service instance safely
    const rideOfferService = rideOfferServiceRef.current;

    // Safe initialization check
    useEffect(() => {
      console.log('HomeScreenWithMap initialized');
      console.log('Background functionality removed to prevent crashes');
      console.log('Initial region:', region);
      console.log('Initial fromLocation:', fromLocation);
    }, []);

    // -----------------------------------------------------------------
    // 0. Global Error Boundary and Crash Prevention
    // -----------------------------------------------------------------
    const [hasError, setHasError] = useState(false);
    const [errorInfo, setErrorInfo] = useState(null);

    // Global error handler
    const handleGlobalError = (error, errorInfo) => {
      console.error('🚨 GLOBAL ERROR CAUGHT:', error, errorInfo);
      setHasError(true);
      setErrorInfo(errorInfo);
      
      // Try to recover gracefully
      try {
        // Reset critical states BUT preserve online status
        // setIsOnline(false); // REMOVED - preserve driver's choice
        setIsUpdatingStatus(false);
        setIsModalVisible(false);
        setCurrentRideRequest(null);
        
        // Reset all animations
        buttonScale.setValue(1);
        buttonGlow.setValue(0);
        screenGlowAnim.setValue(0);
        expandingRing1.setValue(0);
        expandingRing2.setValue(0);
        expandingRing3.setValue(0);
        
        console.log('🔄 Global error recovery completed - online status preserved');
      } catch (recoveryError) {
        console.error('❌ Error during recovery:', recoveryError);
      }
    };

    // Set up global error handler
    useEffect(() => {
      const errorHandler = (error, isFatal) => {
        console.error('🚨 FATAL ERROR:', error, 'Fatal:', isFatal);
        handleGlobalError(error, { isFatal });
      };

      // Add error handler
      if (global.ErrorUtils) {
        global.ErrorUtils.setGlobalHandler(errorHandler);
      }

      return () => {
        if (global.ErrorUtils) {
          global.ErrorUtils.setGlobalHandler(null);
        }
      };
    }, []);

    // Error boundary UI
    if (hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>🚨 Une erreur s'est produite</Text>
          <Text style={styles.errorText}>
            L'application a rencontré un problème. Essayez de redémarrer l'application.
          </Text>
          <TouchableOpacity
            style={styles.errorButton}
            onPress={() => {
              setHasError(false);
              setErrorInfo(null);
              console.log('🔄 Error recovery initiated by user');
            }}
          >
            <Text style={styles.errorButtonText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      );
    }

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
      // Do NOT change isOnline status here - preserve driver's choice
      // Location updates should not affect online/offline status
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
      const unsubscribe = auth.onAuthStateChanged(async (user) => {
        if (user) {
          // Only set offline if not in the middle of a manual toggle AND not already online
          if (!isManualToggleRef.current && !isOnline) {
            setIsOnline(false); // User starts offline only if not already online
          }
          
          // Set driver offline in Firestore with error handling - make this non-blocking
          // BUT only if they're not already online
          const setDriverOffline = async () => {
            try {
              const driverRef = doc(db, "Drivers", user.uid);
              const driverDoc = await getDoc(driverRef);
              if (driverDoc.exists()) {
                const driverData = driverDoc.data();
                // Only set offline if they're not already online
                if (!driverData.isOnline) {
              await updateDoc(driverRef, {
                isOnline: false,
                isAvailable: false,
                rideInProgress: false,
                currentRideId: null
              });
                  console.log('Driver status set to offline on authentication (was not online)');
                } else {
                  console.log('Driver was already online, preserving online status');
                  // Sync local state with Firestore if driver was already online
                  setIsOnline(true);
                  
                  // IMPORTANT: Do NOT update Firestore if driver is already online
                  // This prevents the flickering and preserves their choice
                  console.log('Driver was online, no Firestore update needed');
                }
                
                // Check if the app was recently closed and the driver was online
                if (driverData.appClosedAt || driverData.appBackgroundedAt) {
                  console.log('🚨 App was previously closed while driver was online - ensuring offline status');
                  
                  // Force the driver offline for safety when reopening the app
                  await updateDoc(driverRef, {
                    isOnline: false,
                    isAvailable: false,
                    lastOnlineUpdate: new Date().toISOString(),
                    appReopenedAt: new Date().toISOString()
                  });
                  
                  // Update local state to match
                  setIsOnline(false);
                  console.log('✅ Driver forced offline due to previous app closure');
                }
              }
            } catch (firestoreError) {
              console.error('Error setting driver offline status:', firestoreError);
              // Don't block app initialization if Firestore fails
            }
          };
          
          // Run this in background without blocking
          setDriverOffline();
          
          // Load persisted data and fetch driver info when authenticated
          try {
            loadPersistedData();
            fetchDriverDataFromFirestore();
          } catch (dataError) {
            console.error('Error loading persisted data:', dataError);
          }
          
          // Register for push notifications
          try {
            const token = await registerForPushNotificationsAsync();
            if (token) {
              savePushTokenToFirestore(token);
            }
          } catch (notificationError) {
            console.error('Error registering for push notifications:', notificationError);
          }
          
          // Check for any rides that came in while app was closed
          setTimeout(() => {
            try {
              checkBackgroundRides();
            } catch (backgroundError) {
              console.error('Error checking background rides:', backgroundError);
            }
          }, 2000); // Small delay to ensure everything is loaded
        } else {
          // Only navigate to login if user is actually logged out, not just going offline
          console.log('User logged out, navigating to login');
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
    // App State Change Handler (Works with Auto-Offline System)
    // -----------------------------------------------------------------
    // Note: The auto-offline system (useAutoOffline hook) takes precedence and will
    // automatically set drivers offline after exactly 20 minutes of being online.
    // This background timeout is a backup system that only triggers if the app
    // goes to background for 20+ minutes while the driver is online.
    useEffect(() => {
      let backgroundStartTime = null;
      let backgroundTimeout = null;
      const BACKGROUND_TIMEOUT = 20 * 60 * 1000; // 20 minutes in milliseconds
      
      const handleAppStateChange = (nextAppState) => {
        console.log('App state changed from', appState, 'to', nextAppState);
        setAppState(nextAppState);
        
        if (nextAppState === 'active') {
          // App is becoming active again
          console.log('App becoming active, driver online status:', isOnline);
          
          // Clear any background timeout
          if (backgroundTimeout) {
            clearTimeout(backgroundTimeout);
            backgroundTimeout = null;
          }
          backgroundStartTime = null;
          
        } else if (nextAppState === 'background' || nextAppState === 'inactive') {
          // App is going to background or becoming inactive
          console.log('App going to background/inactive, preserving driver online status:', isOnline);
          
          // Start tracking background time
          backgroundStartTime = Date.now();
          
          // Set a timeout - if the app stays in background for 20+ minutes, set driver offline
          // This works in harmony with the auto-offline system - if auto-offline has already triggered,
          // this won't interfere since the driver will already be offline
          // 
          // IMPORTANT: This background timeout is a BACKUP system that only triggers if:
          // 1. The app goes to background for 20+ minutes
          // 2. The driver is still online (auto-offline hasn't triggered yet)
          // 3. The primary auto-offline system hasn't executed
          // 
          // The primary auto-offline system (useAutoOffline hook) takes precedence and will
          // automatically set drivers offline after exactly 20 minutes of being online, regardless
          // of app state or background conditions.
          backgroundTimeout = setTimeout(async () => {
            console.log('🚨 App has been in background for 20+ minutes - checking if auto-offline should trigger');
            
            try {
              const currentUser = auth.currentUser;
              if (currentUser && isOnline) {
                // Check if the auto-offline system has already triggered
                // If not, this background timeout will ensure the driver goes offline
                console.log('🚨 Setting driver offline due to extended background time (20+ minutes)');
                
                const driverRef = doc(db, "Drivers", currentUser.uid);
                await updateDoc(driverRef, {
                  isOnline: false,
                  isAvailable: false,
                  lastOnlineUpdate: new Date().toISOString(),
                  appBackgroundedAt: new Date().toISOString(),
                  backgroundDuration: Date.now() - backgroundStartTime,
                  offlineReason: "app_backgrounded_too_long"
                });
                
                // Update local state to match
                setIsOnline(false);
                
                console.log('✅ Driver set offline due to extended background time (20+ minutes)');
              }
            } catch (error) {
              console.error('❌ Error setting driver offline due to background timeout:', error);
            }
          }, BACKGROUND_TIMEOUT);
          
        }
        
        // Do NOT automatically change driver online status based on app state changes
        // The driver's online status should only change when they explicitly toggle it
        // UNLESS the app is being completely closed or backgrounded for too long
      };

      const subscription = AppState.addEventListener('change', handleAppStateChange);
      
      return () => {
        // Clean up timeout on unmount
        if (backgroundTimeout) {
          clearTimeout(backgroundTimeout);
        }
        subscription?.remove();
      };
    }, [appState, isOnline, auth.currentUser]);

    // -----------------------------------------------------------------
    // App Termination Handler - Set Driver Offline When App is Completely Closed
    // -----------------------------------------------------------------
    useEffect(() => {
      const handleAppTermination = () => {
        // This function runs when the app is about to be completely closed
        console.log('🚨 App termination detected - setting driver offline for safety');
        
        try {
          const currentUser = auth.currentUser;
          if (currentUser && isOnline) {
            // Set driver offline in Firestore when app is completely closed
            const driverRef = doc(db, "Drivers", currentUser.uid);
            updateDoc(driverRef, {
              isOnline: false,
              isAvailable: false,
              lastOnlineUpdate: new Date().toISOString(),
              appClosedAt: new Date().toISOString(),
              offlineReason: "app_terminated"
            }).then(() => {
              console.log('✅ Driver set offline due to app closure');
            }).catch((error) => {
              console.error('❌ Error setting driver offline on app closure:', error);
            });
          }
        } catch (error) {
          console.error('❌ Error in app termination handler:', error);
        }
      };

      // For React Native, we need to use a different approach
      // Add the handler to the global error boundary and cleanup
      if (global.addEventListener) {
        global.addEventListener('beforeunload', handleAppTermination);
      }

      // Also handle when the component unmounts (which happens on app closure)
      return () => {
        try {
          console.log('🔄 Component unmounting - checking if app is being closed');
          
          // If the driver was online when unmounting, set them offline
          if (auth.currentUser && isOnline) {
            console.log('🚨 Driver was online during unmount - setting offline for safety');
            
            const driverRef = doc(db, "Drivers", auth.currentUser.uid);
            updateDoc(driverRef, {
              isOnline: false,
              isAvailable: false,
              lastOnlineUpdate: new Date().toISOString(),
              appClosedAt: new Date().toISOString()
            }).then(() => {
              console.log('✅ Driver set offline due to component unmount');
            }).catch((error) => {
              console.error('❌ Error setting driver offline on unmount:', error);
            });
          }
          
          // Remove event listener
          if (global.removeEventListener) {
            global.removeEventListener('beforeunload', handleAppTermination);
          }
        } catch (error) {
          console.error('❌ Error during cleanup:', error);
        }
      };
    }, [isOnline, auth.currentUser]);

    // -----------------------------------------------------------------
    // Network State Handler - Set Driver Offline When Network is Lost
    // -----------------------------------------------------------------
    useEffect(() => {
      const handleNetworkChange = (isConnected) => {
        if (!isConnected && isOnline) {
          console.log('🚨 Network connection lost - setting driver offline for safety');
          
          try {
            const currentUser = auth.currentUser;
            if (currentUser) {
              const driverRef = doc(db, "Drivers", currentUser.uid);
              updateDoc(driverRef, {
                isOnline: false,
                isAvailable: false,
                lastOnlineUpdate: new Date().toISOString(),
                networkLostAt: new Date().toISOString(),
                offlineReason: "network_connection_lost"
              }).then(() => {
                console.log('✅ Driver set offline due to network loss');
              }).catch((error) => {
                console.error('❌ Error setting driver offline due to network loss:', error);
              });
            }
          } catch (error) {
            console.error('❌ Error in network change handler:', error);
          }
        }
      };

      // For React Native, we'll use a simpler approach
      // Just log network status changes without trying to detect them
      console.log('📱 Network monitoring initialized for React Native');
      
      // In a real React Native app, you could use NetInfo library here
      // For now, we'll rely on the app state changes and component unmounting
      
      return () => {
        console.log('📱 Network monitoring cleanup');
      };
    }, [isOnline, auth.currentUser]);

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
        setTimeLeft(20); // Reset timer for next ride offer
        
        // Reset any timers
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        
        // Update driver's status in Firestore and force component refresh
        // BUT preserve their online status - don't force them offline
        const updateDriverStatus = async () => {
          try {
            const currentUser = auth.currentUser;
            if (!currentUser) {
              console.error("No authenticated user found");
              return;
            }

            console.log('Updating driver status in Firestore...');
            const driverRef = doc(db, "Drivers", currentUser.uid);
            
            // Get current driver data to preserve online status
            const driverDoc = await getDoc(driverRef);
            if (driverDoc.exists()) {
              const driverData = driverDoc.data();
              const wasOnline = driverData.isOnline;
              
            await updateDoc(driverRef, {
                isAvailable: wasOnline, // Keep available if they were online, unavailable if offline
              rideInProgress: false,
              currentRideId: null,
              lastRideCompletedAt: serverTimestamp()
                // Note: NOT updating isOnline - preserve their choice
            });
              
              console.log(`Driver status updated after ride completion. Online: ${wasOnline}, Available: ${wasOnline}`);
            }
            
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

            // Do NOT change isOnline status - preserve driver's choice
            // The driver stays online if they were online, offline if they were offline
            
            // Double-check that rideInProgress is false
            setTimeout(() => {
              console.log('Double checking ride state:', {
                rideInProgress: false,
                isOnline: isOnline, // Keep current online status
                rideCooldown: false
              });
              setRideInProgress(false);
            }, 500);
            
            console.log('Driver ride state reset but online status preserved');
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

      try {
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
        try {
          const currentRouteName = navigation.getState()?.routes?.[navigation.getState()?.index]?.name;
          if (currentRouteName && currentRouteName.includes('RideInProgress')) {
            console.log('🚫 Already on ride screen, skipping navigation');
            return;
          }
        } catch (routeError) {
          console.error('Error checking current route:', routeError);
          // Continue if we can't check the route
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
            try {
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
                } catch (firestoreError) {
                  console.error('Error fetching customerId for stored ride:', firestoreError);
                  // Continue without customerId if Firestore fails
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
            } catch (rideStateError) {
              console.error('Error parsing stored ride state:', rideStateError);
              // Clean up corrupted ride data
              await AsyncStorage.removeItem('currentRide');
            }
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
        } catch (asyncStorageError) {
          console.error('Error reading from AsyncStorage:', asyncStorageError);
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
        try {
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
        } catch (cacheError) {
          console.error('Error reading cached data:', cacheError);
        }

        // Then fetch from Firestore to ensure we have the latest data
        try {
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
            try {
              await AsyncStorage.setItem('driverInfo', JSON.stringify(userData));
              console.log("Updated AsyncStorage with latest data");
            } catch (storageError) {
              console.error('Error updating AsyncStorage:', storageError);
            }
          } else {
            console.log("No such document in Firestore!");
          }
        } catch (firestoreError) {
          console.error('Error fetching from Firestore:', firestoreError);
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

      try {
        const driverRef = doc(db, "Drivers", currentUser.uid);
        const unsubscribe = onSnapshot(driverRef, async (doc) => {
          try {
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
              
              // IMPORTANT: Do NOT update isOnline here - only read it
              // The driver's online status should only change when they explicitly toggle it
              
              // Update AsyncStorage with latest data
              try {
                await AsyncStorage.setItem('driverInfo', JSON.stringify(userData));
                console.log("Real-time driver data updated, including rating:", userData.rating);
              } catch (storageError) {
                console.error('Error updating AsyncStorage in real-time listener:', storageError);
              }
              
              // Start background ride monitoring if driver is online and we have driver type
              if (userData.isOnline && userData.driverType) {
                try {
                  console.log('Starting background ride monitoring from real-time update');
                  // Background monitoring removed to prevent crashes
                } catch (backgroundError) {
                  console.error('Error starting background monitoring from real-time update:', backgroundError);
                }
              }
            }
          } catch (dataError) {
            console.error('Error processing real-time driver data:', dataError);
          }
        }, (error) => {
          console.error("Error in real-time driver data listener:", error);
        });

        return () => {
          console.log("Cleaning up real-time driver data listener");
          try {
            unsubscribe();
          } catch (cleanupError) {
            console.error('Error cleaning up real-time listener:', cleanupError);
          }
        };
      } catch (setupError) {
        console.error('Error setting up real-time driver data listener:', setupError);
      }
    }, [auth.currentUser]);

            // -----------------------------------------------------------------
    // 7. Get Current Location
    // -----------------------------------------------------------------
    useEffect(() => {
      let locationTimeout;
      
      const setupLocation = async () => {
        try {
          console.log('🚀 Starting location setup...');
          console.log('Current region state:', region);
          console.log('Current fromLocation state:', fromLocation);
          setIsLocationLoading(true);
          
          // Set a timeout to prevent infinite loading
          locationTimeout = setTimeout(() => {
            console.log('Location setup timeout, using fallback region');
            const fallbackRegion = {
              latitude: 11.5883,
              longitude: 43.1453,
              latitudeDelta: 0.0922,
              longitudeDelta: 0.0421,
            };
            setRegion(fallbackRegion);
            setFromLocation({
              latitude: fallbackRegion.latitude,
              longitude: fallbackRegion.longitude,
            });
            setIsLocationLoading(false);
          }, 30000); // 30 second timeout
          
          // Check if location services are enabled
          const isLocationEnabled = await Location.hasServicesEnabledAsync();
          if (!isLocationEnabled) {
            console.error('Location services are disabled');
            clearTimeout(locationTimeout);
            setIsLocationLoading(false);
            Alert.alert(
              'Location Services Disabled',
              'Please enable location services in your device settings to use the map.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() }
              ]
            );
            return;
          }
        
        // Request permissions with better Android handling
        const { status } = await Location.requestForegroundPermissionsAsync();
        console.log('Location permission status:', status);
        
        if (status !== 'granted') {
          console.error('Location permission not granted');
          clearTimeout(locationTimeout);
          setIsLocationLoading(false);
          Alert.alert(
            'Location Permission Required',
            'Please enable location permissions to use the map.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() }
            ]
          );
          return;
        }

        // Try to get current location with multiple fallback options
        let location;
        try {
          // First try with high accuracy
          location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
            maximumAge: 10000,
            timeout: 15000
          });
        } catch (highAccuracyError) {
          console.log('High accuracy location failed, trying balanced accuracy...');
          try {
            // Fallback to balanced accuracy
            location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              maximumAge: 30000,
              timeout: 20000
            });
          } catch (balancedError) {
            console.log('Balanced accuracy failed, trying low accuracy...');
            // Final fallback to low accuracy
            location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Low,
              maximumAge: 60000,
              timeout: 25000
            });
          }
        }
        
        console.log('Current location:', location);
        
        if (!location || !location.coords) {
          console.error('Invalid location data received');
          
          // Set a fallback region (Djibouti city center) so map doesn't show white
          const fallbackRegion = {
            latitude: 11.5883,
            longitude: 43.1453,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          };
          
          console.log('Setting fallback region:', fallbackRegion);
          setRegion(fallbackRegion);
          setFromLocation({
            latitude: fallbackRegion.latitude,
            longitude: fallbackRegion.longitude,
          });
          
          clearTimeout(locationTimeout);
          setIsLocationLoading(false);
          Alert.alert(
            'Location Error',
            'Unable to get your current location. Please check your location settings and try again.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Retry', onPress: () => setupLocation() }
            ]
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
        
        // Clear timeout since we succeeded
        clearTimeout(locationTimeout);
        setIsLocationLoading(false);
        console.log('✅ Location setup completed successfully');
      } catch (error) {
        console.error('Error in setupLocation:', error);
        
        // Clear timeout and set loading to false
        clearTimeout(locationTimeout);
        setIsLocationLoading(false);
        
        // More specific error handling for Android
        let errorMessage = 'There was an error setting up the map. Please try again.';
        let actions = [{ text: 'Cancel', style: 'cancel' }];
        
        if (error.message.includes('location is unavailable')) {
          errorMessage = 'Location service is unavailable. Please check:\n\n1. Location is enabled in device settings\n2. GPS is turned on\n3. App has location permissions';
          actions = [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Retry', onPress: () => setupLocation() }
          ];
        } else if (error.message.includes('permission')) {
          errorMessage = 'Location permission denied. Please enable location permissions in app settings.';
          actions = [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Retry', onPress: () => setupLocation() }
          ];
        } else {
          actions.push({ text: 'Retry', onPress: () => setupLocation() });
        }
        
        Alert.alert('Location Setup Error', errorMessage, actions);
      }
    };

    setupLocation();
    
    // Cleanup function to clear timeout
    return () => {
      if (locationTimeout) {
        clearTimeout(locationTimeout);
      }
    };
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
    // 8. Subscribe to Ride Requests if driver is online, not in progress, etc.
    // -----------------------------------------------------------------
    
    // NEW: Handle background notifications when app is opened
    useEffect(() => {
      if (route.params?.fromNotification && route.params?.notificationRideId) {
        console.log('🚨 App opened from background notification for ride:', route.params.notificationRideId);
        
        // Fetch the ride details and show the offer
        const fetchRideFromNotification = async () => {
          try {
            const rideDoc = await getDoc(doc(db, "rideRequests", route.params.notificationRideId));
            if (rideDoc.exists()) {
              const rideData = rideDoc.data();
              
              // Check if this driver is still the selected driver
              if (rideData.selectedDriverId === auth.currentUser?.uid && rideData.status === 'driver_selected') {
                console.log('✅ Driver is still selected for this ride, showing offer...');
                
                // Process the ride offer
                await processRideOffer(rideData, { id: auth.currentUser.uid });
                
                // Clear the notification params
                navigation.setParams({ fromNotification: undefined, notificationRideId: undefined });
              } else {
                console.log('❌ Driver is no longer selected for this ride or status changed');
                // Clear the notification params
                navigation.setParams({ fromNotification: undefined, notificationRideId: undefined });
              }
            } else {
              console.log('❌ Ride no longer exists');
              // Clear the notification params
              navigation.setParams({ fromNotification: undefined, notificationRideId: undefined });
            }
          } catch (error) {
            console.error('❌ Error fetching ride from notification:', error);
            // Clear the notification params
            navigation.setParams({ fromNotification: undefined, notificationRideId: undefined });
          }
        };
        
        fetchRideFromNotification();
      }
    }, [route.params?.fromNotification, route.params?.notificationRideId, auth.currentUser?.uid]);
    
    useEffect(() => {
      console.log('[SUBSCRIPTION EFFECT] Triggered with:', {
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

      if (!isOnline || rideInProgress || rideCooldown || !driverType) {
        console.log('Not subscribing to ride requests because:', {
          isOnline,
          rideInProgress,
          rideCooldown,
          driverType
        });
        setCurrentRideRequest(null);
        return;
      }

      console.log('Setting up new ride request subscription...');

      // NEW: Listen for rides where a driver has been selected by the backend
      const q = query(
        collection(db, "rideRequests"),
        where("status", "==", "driver_selected"),
        where("rideType", "==", driverType)
      );

      // NEW: Listen for new ride requests to automatically assign to best driver
      const newRideRequestsQuery = query(
        collection(db, "rideRequests"),
        where("status", "==", "waiting"),
        where("rideType", "==", driverType)
      );

      // Set up subscription for new ride requests (automatic assignment)
      const newRideRequestsUnsubscribe = onSnapshot(newRideRequestsQuery, async (snapshot) => {
        console.log('🆕 New ride requests snapshot:', {
          empty: snapshot.empty,
          size: snapshot.size,
          docs: snapshot.docs.map(doc => ({ id: doc.id, status: doc.data().status }))
        });

        if (!snapshot.empty) {
          // Process each new ride request
          for (const doc of snapshot.docs) {
            const rideData = doc.data();
            console.log('🆕 Processing new ride request:', doc.id, rideData.status);
            
            // Only process if it's still waiting and hasn't been assigned yet
            if (rideData.status === 'waiting' && !rideData.selectedDriverId) {
              console.log('🚀 Auto-assigning new ride request:', doc.id);
              
              try {
                // Use the new smart assignment function
                const assignmentSuccess = await assignRideToBestDriver(doc.id);
                
                if (assignmentSuccess) {
                  console.log('✅ Ride automatically assigned to best driver');
                } else {
                  console.log('❌ Failed to auto-assign ride');
                }
              } catch (assignmentError) {
                console.error('❌ Error auto-assigning ride:', assignmentError);
              }
            }
          }
        }
      });

      // Helper function to process ride offer
      const processRideOffer = async (ride, selectedDriver) => {
        // Check if driver is still available (double-check)
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            const driverDoc = await getDoc(doc(db, "Drivers", currentUser.uid));
            if (driverDoc.exists()) {
              const driverData = driverDoc.data();
              if (!driverData.isOnline || driverData.rideInProgress || driverData.currentRideId) {
                console.log('Driver is no longer available:', {
                  isOnline: driverData.isOnline,
                  rideInProgress: driverData.rideInProgress,
                  currentRideId: driverData.currentRideId
                });
                return;
              }
            }
          } catch (error) {
            console.error('Error checking driver availability:', error);
          }
        }
        
        // Fetch customer information from rideRequestsDriver collection
        try {
          // First get the ride request driver document by querying with rideRequestId
          const rideRequestDriverQuery = query(
            collection(db, "rideRequestsDriver"),
            where("rideRequestId", "==", ride.id)
          );
          const rideRequestDriverSnapshot = await getDocs(rideRequestDriverQuery);
          
          let customerInfo = null;
          if (!rideRequestDriverSnapshot.empty) {
            customerInfo = rideRequestDriverSnapshot.docs[0].data();
          }
          
          const rideWithCustomerInfo = {
            ...ride,
            firstName: customerInfo?.firstName || "Customer",
            lastName: customerInfo?.lastName || '',
            number: customerInfo?.number || "",
            photo: customerInfo?.photo || "",
          };
          
          console.log('Customer info fetched:', customerInfo);
          console.log('Ride with customer info:', rideWithCustomerInfo);
          
          setCurrentRideRequest(rideWithCustomerInfo);
          setIsLoadingAddress(true);
          try {
            const pickupLocation = { latitude: ride.pickupLat, longitude: ride.pickupLng };
            const destinationLocation = {
              latitude: ride.destinationLat,
              longitude: ride.destinationLng,
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
            setTimeLeft(20);
            startTimer();
            Animated.timing(countdownAnim, {
              toValue: 0,
              duration: 15000,
              useNativeDriver: false,
            }).start();
          }
        } catch (error) {
          console.error("Error fetching customer information:", error);
        }
      };

      console.log('Setting up ride request subscription with query:', {
        status: "driver_selected",
        rideType: driverType
      });
      
      console.log('[SUBSCRIPTION DEBUG] Current state:', {
        isOnline,
        driverType,
        rideInProgress,
        rideCooldown,
        currentUser: auth.currentUser?.uid
      });

      const unsubscribe = onSnapshot(q, async (snapshot) => {
        console.log('Received ride request snapshot:', {
          empty: snapshot.empty,
          size: snapshot.size,
          docs: snapshot.docs.map(doc => ({ id: doc.id, status: doc.data().status }))
        });

        // If the snapshot is empty, hide the modal and clear the current ride request
        if (snapshot.empty) {
          console.log('No driver-selected rides found');
          setIsModalVisible(false);
          setCurrentRideRequest(null);
          return;
        }

        // If the current ride offer is not in the snapshot, hide the modal and clear the current ride request
        if (currentRideRequestRef.current && !snapshot.docs.some(doc => doc.id === currentRideRequestRef.current.id)) {
          console.log('Current ride request no longer in driver_selected status');
          setIsModalVisible(false);
          setCurrentRideRequest(null);
          return;
        }
        
        const docItem = snapshot.docs[0];
        const ride = { id: docItem.id, ...docItem.data() };
        
        // Check if this ride has been reassigned multiple times and should cycle back
        const reassignmentAttempts = ride.reassignmentAttempts || 0;
        const maxAttempts = 3;
        
        if (reassignmentAttempts >= maxAttempts) {
          console.log('Ride has reached maximum reassignment attempts, cycling back to original driver');
          
          // Reset reassignment attempts and show to current driver
          await updateDoc(doc(db, "rideRequests", ride.id), {
            reassignmentAttempts: 0,
            lastReassignmentTime: serverTimestamp()
          });
        }
        
        console.log('[RIDE OFFER] Processing ride request:', {
          rideId: ride.id,
          status: ride.status,
          rideType: ride.rideType,
          selectedDriverId: ride.selectedDriverId,
          currentUser: auth.currentUser?.uid
        });
        
        // Check if this driver is the selected driver
        if (ride.selectedDriverId === auth.currentUser?.uid) {
          console.log('🎯 You have been selected for this ride by the backend!');
          
          // Send notification to the selected driver
          const sendRideSelectionNotification = async () => {
            try {
              console.log('Sending ride selection notification...');
              
              // Check if notifications are properly initialized
              const hasPermission = await notificationService.requestPermissions();
              if (!hasPermission) {
                console.log('Notification permissions not granted, skipping notification');
                return;
              }
              
              // Send notification with ride details
              const notificationData = {
                type: 'ride_request',
                rideId: ride.id,
                driverId: auth.currentUser?.uid,
                fare: ride.fare?.toString() || '0',
                pickupAddress: ride.pickupAddress || 'Adresse de départ',
                destinationAddress: ride.destinationAddress || 'Adresse de destination',
                rideType: ride.rideType || 'car'
              };
              
              await notificationService.sendLocalNotification(
                '🎯 Course assignée!',
                `Nouvelle course disponible! Départ: ${ride.pickupAddress || 'Adresse de départ'}`,
                notificationData,
                'ride-requests'
              );
              
              console.log('Ride selection notification sent successfully');
            } catch (error) {
              console.error('Error sending ride selection notification:', error);
              // Don't fail the ride selection process if notification fails
            }
          };
          
          // Send notification
          sendRideSelectionNotification();
          
          // Send WhatsApp notification to the selected driver
          try {
            console.log('📱 Sending WhatsApp notification for ride selection...');
            
            // Get current driver info
            const currentUser = auth.currentUser;
            if (currentUser) {
              const driverDoc = await getDoc(doc(db, "Drivers", currentUser.uid));
              if (driverDoc.exists()) {
                const driverData = driverDoc.data();
                
                // Prepare ride info for WhatsApp notification
                const rideInfo = {
                  id: ride.id,
                  pickupAddress: ride.pickupAddress || 'Adresse de départ',
                  destinationAddress: ride.destinationAddress || 'Adresse de destination',
                  fare: ride.fare || 0,
                  estimatedTime: 15 // Default estimated time
                };
                
                // Send WhatsApp notification
                await whatsAppService.sendRideAssignmentNotification({ ...driverData, id: currentUser.uid }, rideInfo);
                console.log('✅ WhatsApp notification sent successfully for ride selection');
              }
            }
          } catch (whatsappError) {
            console.error('❌ Error sending WhatsApp notification for ride selection:', whatsappError);
            // Don't fail the ride selection process if WhatsApp fails
            console.log('⚠️ Ride selection continues despite WhatsApp notification failure');
          }
          
          // Get the selected driver details from SelectedDriver collection
          try {
            const selectedDriverDoc = await getDoc(doc(db, "SelectedDriver", ride.id));
            if (selectedDriverDoc.exists()) {
              const selectionData = selectedDriverDoc.data();
              console.log('Selection details:', selectionData);
              
              // Show the ride offer to this driver
              await processRideOffer(ride, {
                id: auth.currentUser.uid,
                ...selectionData.driverInfo
              });
              
              // Sync frontend timer with backend countdown if available
              if (selectionData.countdownExpiryTime) {
                const countdownExpiry = new Date(selectionData.countdownExpiryTime);
                const now = new Date();
                const remainingTime = Math.max(0, Math.floor((countdownExpiry - now) / 1000));
                
                if (remainingTime > 0) {
                  console.log(`Syncing frontend timer with backend countdown: ${remainingTime}s remaining`);
                  setTimeLeft(remainingTime);
                  
                  // Restart timer with remaining time
                  if (timerRef.current) {
                    clearInterval(timerRef.current);
                  }
                  startTimer();
                  
                  // Restart animation
                  Animated.timing(countdownAnim, {
                    toValue: 0,
                    duration: remainingTime * 1000,
                    useNativeDriver: false,
                  }).start();
                }
              }
          }
        } catch (error) {
            console.error('Error getting selection details:', error);
          }
        } else {
          console.log('This ride was assigned to another driver:', ride.selectedDriverId);
        }
      }, (error) => {
        console.error("Error in ride request subscription:", error);
        // Handle Firestore connection errors gracefully
        if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
          console.log('Firestore connection error, will retry automatically');
          // The subscription will automatically retry when the connection is restored
        } else {
          console.error('Unexpected Firestore error:', error);
        }
      });

      // Store the unsubscribe function
      onSnapshotUnsubscribe.current = unsubscribe;

      // Add listener for assigned rides to auto-navigate
      const assignedRidesQuery = query(
        collection(db, "rideRequests"),
        where("status", "==", "assigned"),
        where("driverId", "==", auth.currentUser?.uid)
      );

      const assignedRidesUnsubscribe = onSnapshot(assignedRidesQuery, async (snapshot) => {
        if (!snapshot.empty) {
          const assignedRide = snapshot.docs[0].data();
          const rideId = snapshot.docs[0].id;
          
          console.log('🚗 Ride assigned to driver, auto-navigating to RideInProgressScreen:', rideId);
          
          // Close modal if open
          setIsModalVisible(false);
          setCurrentRideRequest(null);
          
          // Prepare navigation parameters
          const navigationParams = {
            pickupLat: assignedRide.pickupLat,
            pickupLng: assignedRide.pickupLng,
            destinationLat: assignedRide.destinationLat,
            destinationLng: assignedRide.destinationLng,
            driverLat: fromLocation?.latitude || 0,
            driverLng: fromLocation?.longitude || 0,
            firstName: assignedRide.firstName || assignedRide.driverName || "Customer",
            lastName: assignedRide.lastName || '',
            number: assignedRide.number || assignedRide.driverPhone || '',
            ridePrice: assignedRide.fare || 0,
            photo: assignedRide.photo || assignedRide.driverPhoto || '',
            rideId: rideId,
            customerId: assignedRide.customerId || assignedRide.userId || '',
          };
          
          console.log('🎯 Auto-navigating with params:', navigationParams);
          
          // Navigate to ride in progress screen
          try {
            if (navigation && typeof navigation.navigate === 'function') {
              navigation.navigate("RideInProgressScreen", navigationParams);
            } else {
              console.error('Navigation not available for auto-navigation');
            }
          } catch (navigationError) {
            console.error('Auto-navigation error:', navigationError);
          }
        }
      });

      return () => {
        if (onSnapshotUnsubscribe.current) {
          onSnapshotUnsubscribe.current();
        }
        // Clean up the new ride requests subscription
        if (newRideRequestsUnsubscribe) {
          newRideRequestsUnsubscribe();
        }
        // Clean up the assigned rides subscription
        if (assignedRidesUnsubscribe) {
          assignedRidesUnsubscribe();
        }
      };
    }, [isOnline, rideInProgress, rideCooldown, driverType, fromLocation, navigation]);

    // -----------------------------------------------------------------
    // 9. Countdown Timer for Driver Selection
    // -----------------------------------------------------------------
    useEffect(() => {
      if (isModalVisible && timeLeft === 0) {
        handleTimerExpired();
      }
    }, [timeLeft]);

    const handleTimerExpired = async () => {
      if (!currentRideRequest) return;
      
      console.log('Frontend timer expired for ride:', currentRideRequest.id);
      
      try {
        // Check if the backend has already handled this (status changed)
        const rideDoc = await getDoc(doc(db, "rideRequests", currentRideRequest.id));
        if (!rideDoc.exists()) {
          console.log('Ride request no longer exists');
          return;
        }
        
        const rideData = rideDoc.data();
        
        // If the ride status has already changed, the backend handled it
        if (rideData.status !== 'driver_selected') {
          console.log(`Ride status already changed to ${rideData.status}, backend handled the countdown`);
          return;
        }
        
        // If status is still 'driver_selected', the backend countdown should handle reassignment
        console.log('Ride still in driver_selected status, backend countdown should handle reassignment');
        
        // Close the modal and wait for backend to reassign
        setIsModalVisible(false);
        setCurrentRideRequest(null);
        
        // Show a message that the ride is being reassigned
        Alert.alert(
          "Temps écoulé",
          "Le temps de réponse a expiré. La course sera réassignée à un autre chauffeur.",
          [{ text: "OK" }]
        );
        
      } catch (error) {
        console.error('Error handling timer expired:', error);
        // Close modal on error
        setIsModalVisible(false);
        setCurrentRideRequest(null);
      }
    };

    const findNextAvailableDriver = async () => {
      // Reassignment after a timeout is handled by the server countdown.
      return;
      // eslint-disable-next-line no-unreachable
      if (!currentRideRequest) return;
      
      try {
        console.log('🔍 Looking for next available driver for ride:', currentRideRequest.id);
        
        // Get the current ride request to check if it's still available
        const rideDoc = await getDoc(doc(db, "rideRequests", currentRideRequest.id));
        if (!rideDoc.exists()) {
          console.log('❌ Ride request no longer exists');
          return;
        }
        
        const rideData = rideDoc.data();
        if (rideData.status !== 'waiting') {
          console.log('❌ Ride status is no longer waiting:', rideData.status);
          return;
        }
        
        // Get pickup coordinates from the correct fields
        const pickupLocation = {
          latitude: rideData.pickupLat,
          longitude: rideData.pickupLng
        };
        
        if (!pickupLocation.latitude || !pickupLocation.longitude) {
          console.error('❌ Invalid pickup coordinates:', pickupLocation);
          return;
        }
        
        console.log('📍 Pickup location:', pickupLocation);
        
        // More flexible query - only check essential fields first
        const driversQuery = query(
          collection(db, "Drivers"),
          where("isOnline", "==", true),
          where("driverType", "==", rideData.rideType || "standard")
        );
        
        const driversSnapshot = await getDocs(driversQuery);
        const availableDrivers = [];
        
        console.log(`🔍 Found ${driversSnapshot.size} drivers with basic criteria`);
        
        driversSnapshot.forEach((doc) => {
          const driverData = doc.data();
          console.log(`🔍 Checking driver ${doc.id}:`, {
            isOnline: driverData.isOnline,
            driverType: driverData.driverType,
            rideInProgress: driverData.rideInProgress,
            currentRideId: driverData.currentRideId,
            latitude: driverData.latitude,
            longitude: driverData.longitude,
            firstName: driverData.firstName
          });
          
          // Exclude the current driver and previously declined drivers
          if (doc.id !== auth.currentUser?.uid && 
              !rideData.declinedDrivers?.includes(doc.id)) {
            
            // Check availability more flexibly
            const isAvailable = (
              driverData.isAvailable !== false && // Available unless explicitly false
              driverData.rideInProgress !== true && // Not in progress unless explicitly true
              !driverData.currentRideId // No current ride
            );
            
            // Only include drivers with valid coordinates and are available
            if (driverData.latitude && driverData.longitude && isAvailable) {
              const distance = calculateDistance(
                { latitude: driverData.latitude, longitude: driverData.longitude },
                pickupLocation
              );
              
              availableDrivers.push({
                id: doc.id,
                ...driverData,
                distanceToPickup: distance
              });
              
              console.log(`✅ Driver ${doc.id} added - distance: ${distance.toFixed(2)}km`);
            } else {
              console.log(`❌ Driver ${doc.id} excluded:`, {
                hasCoordinates: !!(driverData.latitude && driverData.longitude),
                isAvailable,
                reason: !driverData.latitude || !driverData.longitude ? 'No coordinates' : 'Not available'
              });
            }
          } else {
            console.log(`❌ Driver ${doc.id} excluded:`, {
              isCurrentDriver: doc.id === auth.currentUser?.uid,
              wasDeclined: rideData.declinedDrivers?.includes(doc.id)
            });
          }
        });
        
        console.log(`🔍 Final available drivers: ${availableDrivers.length}`);
        availableDrivers.forEach(driver => {
          console.log(`📍 Available driver ${driver.id}: ${driver.distanceToPickup.toFixed(2)}km`);
        });
        
        if (availableDrivers.length === 0) {
          console.log('❌ No other available drivers found, incrementing reassignment attempts');
          
          // Get current reassignment attempts
          const currentAttempts = rideData.reassignmentAttempts || 0;
          
          // Increment reassignment attempts
          await updateDoc(doc(db, "rideRequests", currentRideRequest.id), {
            reassignmentAttempts: increment(1),
            lastReassignmentTime: serverTimestamp()
          });
          
          // Add a delay before the next attempt to allow other drivers to come online
          const delay = Math.min(5000 + (currentAttempts * 2000), 15000); // 5s, 7s, 9s, 11s, 13s, 15s
          console.log(`⏰ No drivers available, waiting ${delay}ms before next attempt`);
          
          // Set a timeout to retry after the delay
          setTimeout(async () => {
            try {
              // Check if the ride is still waiting and we haven't navigated away
              const currentRideDoc = await getDoc(doc(db, "rideRequests", currentRideRequest.id));
              if (currentRideDoc.exists() && currentRideDoc.data().status === 'waiting') {
                console.log('🔄 Retrying driver search after delay');
                await findNextAvailableDriver();
              }
            } catch (retryError) {
              console.error('❌ Error during retry:', retryError);
            }
          }, delay);
          
          return;
        }
        
        // Sort drivers by distance to pickup location (closest first)
        const sortedDrivers = availableDrivers.sort((a, b) => {
          return a.distanceToPickup - b.distanceToPickup;
        });
        
        // Select the closest available driver
        const nextDriver = sortedDrivers[0];
        
        console.log(`✅ Selected closest driver: ${nextDriver.id} at ${nextDriver.distanceToPickup.toFixed(2)}km`);
        console.log(`📍 Driver coordinates: ${nextDriver.latitude}, ${nextDriver.longitude}`);
        console.log(`📍 Pickup coordinates: ${pickupLocation.latitude}, ${pickupLocation.longitude}`);
        
        // Update the ride request to assign it to the next driver
        await updateDoc(doc(db, "rideRequests", currentRideRequest.id), {
          driverId: nextDriver.id,
          driverName: nextDriver.firstName || nextDriver.userName || nextDriver.name || "Driver",
          driverPhoto: nextDriver.photo || nextDriver.profilePhoto || "",
          driverPhone: nextDriver.phoneNumber || null,
          lastDriverAssignment: serverTimestamp(),
          reassignmentAttempts: increment(1),
          lastReassignmentTime: serverTimestamp()
        });
        
        // Also update the SelectedDriver collection for reassignment
        try {
          await updateDoc(doc(db, "SelectedDriver", currentRideRequest.id), {
            status: "reassigned",
            reassignedAt: new Date(),
            reassignedToDriver: nextDriver.id,
            reassignedFromDriver: auth.currentUser?.uid,
            reassignmentAttempt: increment(1)
          });
          console.log('✅ SelectedDriver collection updated to reassigned status');
        } catch (selectedDriverError) {
          console.error('❌ Error updating SelectedDriver collection for reassignment:', selectedDriverError);
          // Continue with reassignment even if SelectedDriver update fails
        }
        
        console.log('✅ Ride successfully reassigned to closest available driver');
        
      } catch (error) {
        console.error('❌ Error finding next available driver:', error);
        throw error;
      }
    };

    const startTimer = () => {
      try {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        
        // Store the start time for background calculations
        countdownStartTimeRef.current = Date.now();
        
        setTimeLeft(20);
        countdownAnim.setValue(1);
        
        // Start the animation
        Animated.timing(countdownAnim, {
          toValue: 0,
          duration: 15000,
          useNativeDriver: false,
        }).start();
        
        timerRef.current = setInterval(() => {
          setTimeLeft((prevTime) => {
            if (prevTime <= 1) {
              clearInterval(timerRef.current);
              return 0;
            }
            return prevTime - 1;
          });
        }, 1000);
      } catch (error) {
        console.error('Error starting timer:', error);
        // Fallback: just set the time without animation
        setTimeLeft(20);
      }
    };

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
        // Background functionality removed to prevent crashes
      };
    }, []);

    useEffect(() => {
      if (!isModalVisible && timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        
          // Clean up stored countdown data
        try {
          AsyncStorage.removeItem(`countdown_${currentRideRequest.id}`).catch(console.error);
        } catch (error) {
          console.error('Error cleaning up countdown:', error);
        }
      }
    }, [isModalVisible, currentRideRequest]);

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

    // Enhanced GO button animation with vibration and loading states
    const animateGoButtonPress = async (isGoingOnline) => {
      try {
        console.log('🎬 Starting GO button animation for:', isGoingOnline ? 'ONLINE' : 'OFFLINE');
        
        // Trigger vibration feedback
        if (Platform.OS === 'android') {
          Vibration.vibrate([0, 100, 50, 100]); // Short vibration pattern
        } else if (Platform.OS === 'ios') {
          Vibration.vibrate(); // iOS vibration
        }
        
        // Reset all animations
        goButtonPressAnim.setValue(1);
        goButtonGlowIntensity.setValue(0);
        goButtonRipple.setValue(0);
        goButtonSuccess.setValue(0);
        searchingAnimation.setValue(0);
        searchingTextOpacity.setValue(0);
        fullScreenCircle.setValue(0);
        fullScreenCircleOpacity.setValue(0);
        fullScreenCircleScale.setValue(0);
        fullScreenText.setValue(0);
        fullScreenIcon.setValue(0);
        
        if (isGoingOnline) {
          // Going ONLINE - Epic celebration with full-screen animation!
          console.log('🎉 Starting EPIC GO button celebration with full-screen animation!');
          
          // Set states
          setIsGoingOnline(true);
          setShowSearchingAnimation(true);
          setShowFullScreenAnimation(true);
          setFullScreenMessage("GOING ONLINE!");
          
          console.log('✅ States set, starting animation sequence...');
          console.log('✅ showFullScreenAnimation set to:', true);
          console.log('✅ fullScreenMessage set to:', "GOING ONLINE!");
          
          // Return a promise that resolves when animation completes
          return new Promise((resolve) => {
            console.log('�� Creating animation promise...');
            
            // Epic animation sequence
            Animated.sequence([
              // Phase 1: Button press feedback + initial glow
              Animated.parallel([
                Animated.timing(goButtonPressAnim, {
                  toValue: 0.8,
                  duration: 100,
                  useNativeDriver: true,
                }),
                Animated.timing(goButtonGlowIntensity, {
                  toValue: 1,
                  duration: 200,
                  useNativeDriver: true,
                }),
              ]),
              
              // Phase 2: Full-screen circle starts expanding from button
              Animated.parallel([
                Animated.timing(fullScreenCircleOpacity, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
                Animated.timing(fullScreenCircleScale, {
                  toValue: 1,
                  duration: 800,
                  easing: Easing.out(Easing.cubic),
                  useNativeDriver: true,
                }),
              ]),
              
              // Phase 3: Full-screen text and icon appear
              Animated.parallel([
                Animated.timing(fullScreenText, {
                  toValue: 1,
                  duration: 400,
                  useNativeDriver: true,
                }),
                Animated.timing(fullScreenIcon, {
                  toValue: 1,
                  duration: 400,
                  useNativeDriver: true,
                }),
              ]),
              
              // Phase 4: Button expands and ripple effect
              Animated.parallel([
                Animated.spring(goButtonPressAnim, {
                  toValue: 1.2,
                  tension: 100,
                  friction: 8,
                  useNativeDriver: true,
                }),
                Animated.timing(goButtonRipple, {
                  toValue: 1,
                  duration: 600,
                  useNativeDriver: true,
                }),
              ]),
              
              // Phase 5: Success animation and searching text
              Animated.parallel([
                Animated.timing(goButtonSuccess, {
                  toValue: 1,
                  duration: 400,
                  useNativeDriver: true,
                }),
                Animated.timing(searchingTextOpacity, {
                  toValue: 1,
                  duration: 300,
                  useNativeDriver: true,
                }),
              ]),
              
              // Phase 6: Return to normal size and fade out full-screen
              Animated.parallel([
                Animated.spring(goButtonPressAnim, {
                  toValue: 1,
                  tension: 50,
                  friction: 8,
                  useNativeDriver: true,
                }),
                Animated.timing(fullScreenCircleOpacity, {
                  toValue: 0,
                  duration: 500,
                  delay: 1000,
                  useNativeDriver: true,
                }),
              ]),
            ]).start(() => {
              console.log('✅ Animation sequence completed!');
              resolve();
            });
            
            console.log('🎬 Animation sequence started!');
          });
          
        } else {
          // Going OFFLINE - Simple feedback
          console.log('🔄 GO button offline animation');
          
          setIsGoingOnline(false);
          setShowSearchingAnimation(false);
          setShowFullScreenAnimation(false);
          
          return new Promise((resolve) => {
            Animated.sequence([
              Animated.timing(goButtonPressAnim, {
                toValue: 0.9,
                duration: 100,
                useNativeDriver: true,
              }),
              Animated.timing(goButtonPressAnim, {
                toValue: 1,
                duration: 100,
                useNativeDriver: true,
              }),
            ]).start(() => {
              console.log('✅ Offline animation completed!');
              resolve();
            });
          });
        }
        
      } catch (error) {
        console.error('❌ Error in GO button animation:', error);
        // Fallback to simple animation
        animateButton();
        return Promise.resolve();
      }
    };

    // Start searching animation loop
    const startSearchingAnimation = () => {
      const searchTexts = [
        "Nous cherchons des courses, restez sur place et attendez...",
        "Scan de passagers en cours, ne bougez pas...",
        "Recherche à proximité, restez disponible...",
        "Prêt à servir, attendez les courses...",
        "Actif et en recherche, restez sur place..."
      ];
      
      let textIndex = 0;
      
      // Start continuous dot animation
      const dotAnimation = Animated.loop(
        Animated.timing(searchingAnimation, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        })
      );
      dotAnimation.start();
      
      // Start continuous full-screen circle pulse
      const circlePulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(fullScreenCircle, {
            toValue: 1,
            duration: 2000,
            useNativeDriver: true,
          }),
          Animated.timing(fullScreenCircle, {
            toValue: 0.5,
            duration: 2000,
            useNativeDriver: true,
          }),
        ])
      );
      circlePulseAnimation.start();
      
      // Store animation reference for cleanup
      searchingDotAnimationRef.current = dotAnimation;
      circlePulseAnimationRef.current = circlePulseAnimation;
      
      const searchInterval = setInterval(() => {
        if (!isOnline || !showSearchingAnimation) {
          clearInterval(searchInterval);
          dotAnimation.stop();
          circlePulseAnimation.stop();
          return;
        }
        
        // Animate text change
        Animated.sequence([
          Animated.timing(searchingTextOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(searchingTextOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]).start();
        
        // Update text
        textIndex = (textIndex + 1) % searchTexts.length;
        setSearchingText(searchTexts[textIndex]);
        
      }, 3000); // Change text every 3 seconds
      
      // Store interval reference for cleanup
      searchingTextIntervalRef.current = searchInterval;
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

    // Ultra-bulletproof toggle function - completely synchronous and error-free
    // THIS IS THE ONLY FUNCTION THAT SHOULD CHANGE DRIVER ONLINE STATUS
    // All other functions must preserve the driver's online status choice
    // NEVER call setIsOnline(false) anywhere else in the code
    // NEVER update isOnline in Firestore except through this function
    // 
    // IMPORTANT: When user explicitly presses GO button, this OVERRIDES any automatic
    // offline status that was set due to app closure or backgrounding
    const ultraSafeToggleOnlineStatus = async () => {
      try {
        console.log('🔄 Starting ultra-safe toggle...');
        
        // Set manual toggle flag to prevent auth interference
        isManualToggleRef.current = true;
        
        // Start loading state immediately
        setIsUpdatingStatus(true);
        
        // Start the enhanced animation sequence
        const newStatus = !isOnline;
        console.log('🎬 About to call animateGoButtonPress with status:', newStatus);
        
        try {
          await animateGoButtonPress(newStatus);
          console.log('✅ Animation completed successfully');
        } catch (animationError) {
          console.error('❌ Animation failed:', animationError);
          // Continue without animation
        }
        
        // Wait for animation to complete before proceeding
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Now proceed with the actual status change
        try {
          if (newStatus) {
            // Going ONLINE
            console.log('🚀 Going ONLINE with enhanced animation...');
            
            // Start searching animation loop
            startSearchingAnimation();
            
            // Hide full-screen animation after delay
            setTimeout(() => {
              setShowFullScreenAnimation(false);
            }, 2000);
            
            // Update local state first
            // NOTE: This will automatically trigger the 20-minute auto-offline timer
            // The driver cannot disable this system - they will go offline after exactly 20 minutes
            setIsOnline(true);
            
            // Update backend
            const driverRef = doc(db, "Drivers", auth.currentUser?.uid);
            await updateDoc(driverRef, {
              isOnline: true,
              lastOnlineUpdate: serverTimestamp(),
              status: "online",
            });
            
            console.log('✅ Successfully went ONLINE');
            
          } else {
            // Going OFFLINE
            console.log('🛑 Going OFFLINE...');
            
            // Clear searching animation
            if (searchingTextIntervalRef.current) {
              clearInterval(searchingTextIntervalRef.current);
              searchingTextIntervalRef.current = null;
            }
            if (searchingDotAnimationRef.current) {
              searchingDotAnimationRef.current.stop();
              searchingDotAnimationRef.current = null;
            }
            if (circlePulseAnimationRef.current) {
              circlePulseAnimationRef.current.stop();
              circlePulseAnimationRef.current = null;
            }
            
            // Update local state
            // NOTE: This will automatically clear the 20-minute auto-offline timer
            // The timer will restart when the driver goes online again
            setIsOnline(false);
            
            // Update backend
            const driverRef = doc(db, "Drivers", auth.currentUser?.uid);
            await updateDoc(driverRef, {
              isOnline: false,
              lastOnlineUpdate: serverTimestamp(),
              status: "offline",
            });
            
            console.log('✅ Successfully went OFFLINE');
          }
          
          // Reset states
          setIsUpdatingStatus(false);
          isManualToggleRef.current = false;
          
        } catch (backendError) {
          console.error('❌ Backend update failed:', backendError);
          // Revert local state if backend fails
          setIsOnline(!newStatus);
          setIsUpdatingStatus(false);
          isManualToggleRef.current = false;
          throw backendError;
        }
        
      } catch (error) {
        console.error('❌ Ultra-safe toggle failed:', error);
        // Reset states on error
        setIsUpdatingStatus(false);
        isManualToggleRef.current = false;
        throw error;
      }
    };

    // Simple fallback toggle function in case the main one crashes
    const simpleToggleOnlineStatus = () => {
      try {
        console.log('🔄 Using simple toggle fallback...');
        const newStatus = !isOnline;
        setIsOnline(newStatus);
        setIsUpdatingStatus(false);
        console.log(`✅ Simple toggle completed: ${newStatus ? 'ONLINE' : 'OFFLINE'}`);
      } catch (error) {
        console.error('❌ Simple toggle also failed:', error);
        // Last resort - just reset the state
        setIsUpdatingStatus(false);
      }
    };

    const toggleOnlineStatus = async () => {
      // Comprehensive error boundary - wrap everything in try-catch
      try {
        console.log('🔄 Starting toggle online status...');
        
        // Set manual toggle flag to prevent auth interference
        isManualToggleRef.current = true;
        
        // Start loading state immediately
        setIsUpdatingStatus(true);
        
        // Start the animation sequence immediately
        try {
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
        } catch (animationError) {
          console.error('Animation error:', animationError);
          // Continue without animation if it fails
        }

        const newStatus = !isOnline;
        console.log(`🔄 Toggling to: ${newStatus ? 'ONLINE' : 'OFFLINE'}`);
        
        // Update local state FIRST for immediate UI response
        setIsOnline(newStatus);
        console.log('✅ Local state updated immediately');
        
        // Then handle all the complex operations in background
        const handleBackgroundOperations = async () => {
          try {
            console.log('🔄 Starting background operations...');
            
            const currentUser = auth.currentUser;
            if (!currentUser) {
              console.error("❌ No authenticated user found");
              return;
            }

            const driverRef = doc(db, "Drivers", currentUser.uid);
            
            // Get current location before updating status (with better error handling)
            let currentLocation = null;
            try {
              currentLocation = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
                timeout: 10000, // 10 second timeout
                maximumAge: 60000 // Accept location up to 1 minute old
              });
              console.log('📍 Location obtained successfully');
            } catch (locationError) {
              console.error('⚠️ Error getting current location:', locationError);
              // Continue without location if it fails - this is not critical
            }
            
            // Enhanced update data with all necessary fields
            const updateData = {
              isOnline: newStatus,
              isAvailable: newStatus, // Ensure availability matches online status
              rideInProgress: false, // Reset ride progress when going online
              currentRideId: null, // Clear any current ride
              lastOnlineUpdate: new Date().toISOString(),
              ...(currentLocation ? {
                latitude: currentLocation.coords.latitude,
                longitude: currentLocation.coords.longitude,
                lastLocationUpdate: new Date().toISOString()
              } : {})
            };

            // If going offline, also set isAvailable to false
            if (!newStatus) {
              updateData.isAvailable = false;
            }

            console.log('📝 Updating driver status in Firestore:', updateData);
            
            
            // Update Firestore with timeout - make this non-blocking for offline toggle
            try {
              const updatePromise = updateDoc(driverRef, updateData);
              const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Firestore update timeout')), 10000)
              );
              
              await Promise.race([updatePromise, timeoutPromise]);
              console.log(`✅ Driver ${currentUser.uid} is now ${newStatus ? 'online' : 'offline'} in Firestore`);
            } catch (firestoreError) {
              console.error('❌ Error updating Firestore:', firestoreError);
              // Don't block the UI update if Firestore fails
              // The user can still go offline locally even if Firestore update fails
            }
            
            // Start/stop background ride monitoring based on online status (with better error handling)
            try {
              if (newStatus) {
                // Going online - start background ride monitoring
                console.log('🔄 Starting background ride monitoring...');
                // Background monitoring removed to prevent crashes
                  console.log('✅ Background ride monitoring started');
              } else {
                // Going offline - stop background ride monitoring
                console.log('🔄 Stopping background ride monitoring...');
                // Background monitoring removed to prevent crashes
                  console.log('✅ Background ride monitoring stopped');
              }
            } catch (backgroundError) {
              console.error('❌ Error with background monitoring:', backgroundError);
              // Don't let background errors crash the main toggle function
            }
            
            console.log('✅ All background operations completed');
          } catch (error) {
            console.error('❌ Error in background operations:', error);
            // Don't let background errors affect the UI
          }
        };
        
        // Run background operations without blocking
        handleBackgroundOperations();
        
        // Scale back to normal with success check
        try {
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
          console.log('✅ Success animation completed');
        } catch (animationError) {
          console.error('❌ Success animation error:', animationError);
          // Reset button scale manually if animation fails
          buttonScale.setValue(1);
        }

        console.log(`🎉 Toggle completed successfully: ${newStatus ? 'ONLINE' : 'OFFLINE'}`);

      } catch (error) {
        console.error("❌ CRITICAL ERROR in toggleOnlineStatus:", error);
        
        // Emergency recovery - reset all animations and states
        try {
          buttonScale.setValue(1);
          buttonGlow.setValue(0);
          screenGlowAnim.setValue(0);
          expandingRing1.setValue(0);
          expandingRing2.setValue(0);
          expandingRing3.setValue(0);
          console.log('🔄 Emergency animation reset completed');
        } catch (resetError) {
          console.error('❌ Error resetting animations:', resetError);
        }
        
        // Don't show error alert - just log the error
        console.log('🔄 Toggle failed but app should remain stable');
      } finally {
        // Always clean up
        setIsUpdatingStatus(false);
        
        // Reset manual toggle flag after a short delay
        setTimeout(() => {
          isManualToggleRef.current = false;
          console.log('🔄 Manual toggle flag reset');
        }, 1000);
        
        console.log('🔄 Toggle function cleanup completed');
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
    // 14. Accept Ride (Immediate unsubscribe + set rideInProgress)
    // -----------------------------------------------------------------
    const acceptRide = async () => {
      // Safety check - ensure we have all required data
      if (!currentRideRequest || !currentRideRequest.id) {
        console.log('No valid current ride request to accept');
        return;
      }
      
      // Safety check - ensure we have required dependencies
      if (!navigation || !auth || !db) {
        console.error('Required dependencies not available for accepting ride');
        Alert.alert(
          "Erreur",
          "Impossible d'accepter la course. Redémarrez l'application.",
          [{ text: "OK" }]
        );
        return;
      }
      
      console.log('Accepting ride with customer info:', {
        name: currentRideRequest.firstName,
        phone: currentRideRequest.number,
        photo: currentRideRequest.photo,
        fare: currentRideRequest.fare
      });
      
      // Set loading state to prevent multiple calls
      setRideInProgress(true);
      
      try {
        // Clean up subscriptions and timers first
        if (onSnapshotUnsubscribe.current) {
          try {
            onSnapshotUnsubscribe.current();
            onSnapshotUnsubscribe.current = null;
          } catch (unsubError) {
            console.error('Error unsubscribing from snapshot:', unsubError);
          }
        }
        
        if (timerRef.current) {
          try {
            clearInterval(timerRef.current);
            timerRef.current = null;
          } catch (timerError) {
            console.error('Error clearing timer:', timerError);
          }
        }
        
        // Clean up background countdown task
        try {
          // Background functionality removed to prevent crashes
          // Clean up stored countdown data
          AsyncStorage.removeItem(`countdown_${currentRideRequest.id}`).catch(console.error);
        } catch (error) {
          console.error('Error cleaning up background countdown:', error);
        }
        
        // Validate required data
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
        }
        
        if (!fromLocation || !fromLocation.latitude || !fromLocation.longitude) {
          throw new Error("Driver location not available");
        }
        
        if (!currentRideRequest.id) {
          throw new Error("Invalid ride request ID");
        }
        
        const driverId = currentUser.uid;
        
        // Get driver document with error handling
        let driverDoc;
        try {
          driverDoc = await getDoc(doc(db, "Drivers", driverId));
          if (!driverDoc.exists()) {
            throw new Error("Driver document not found");
          }
        } catch (docError) {
          console.error('Error fetching driver document:', docError);
          throw new Error("Failed to fetch driver information");
        }
        
        const driverPhone = driverDoc.data()?.phoneNumber || null;
        
        // Update driver stats
        try {
          const driverRef = doc(db, "Drivers", driverId);
          await updateDoc(driverRef, {
            rideCount: increment(1),
            lastRideTime: new Date().toISOString()
          });
        } catch (updateError) {
          console.error('Error updating driver stats:', updateError);
          // Continue with ride acceptance even if stats update fails
        }

        // Update ride request status
        try {
          await updateDoc(doc(db, "rideRequests", currentRideRequest.id), {
            status: "assigned",
            driverId,
            driverName: userName || "Driver",
            driverPhoto: driverPhoto || "",
            driverPhone: driverPhone,
          });
          
          // Also update the SelectedDriver collection status
          try {
            await updateDoc(doc(db, "SelectedDriver", currentRideRequest.id), {
              status: "assigned",
              assignedAt: new Date(),
              driverAcceptedAt: new Date()
            });
            console.log('SelectedDriver collection updated to assigned status');
          } catch (selectedDriverError) {
            console.error('Error updating SelectedDriver collection:', selectedDriverError);
            // Continue with ride acceptance even if SelectedDriver update fails
          }
          
        } catch (rideUpdateError) {
          console.error('Error updating ride request:', rideUpdateError);
          throw new Error("Failed to assign ride to driver");
        }
        
        // Close modal and reset state
        setIsModalVisible(false);
        
        // Update earnings if available
        if (currentRideRequest.fare && typeof currentRideRequest.fare === 'number') {
          try {
            const today = new Date();
            const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const newEarnings = earnings + currentRideRequest.fare;
            setEarnings(newEarnings);
            const earningsKey = `earnings_${driverId}_${todayString}`;
            await AsyncStorage.setItem(earningsKey, newEarnings.toString());
            await AsyncStorage.setItem(`lastEarningsDate_${driverId}`, todayString);
          } catch (earningsError) {
            console.error('Error updating earnings:', earningsError);
            // Continue with ride acceptance even if earnings update fails
          }
        }
        
        // Earnings (moneyByRider / Earnings) are recorded by Cloud Functions when the ride is completed.
        
        // Update ride count
        try {
          const newRideCount = rideCount + 1;
          setRideCount(newRideCount);
          const rideCountKey = `rideCount_${driverId}`;
          await AsyncStorage.setItem(rideCountKey, newRideCount.toString());
        } catch (rideCountError) {
          console.error('Error updating ride count:', rideCountError);
          // Continue with ride acceptance even if ride count update fails
        }
        
        // Prepare navigation parameters
        const navigationParams = {
          pickupLat: currentRideRequest.pickupLat,
          pickupLng: currentRideRequest.pickupLng,
          destinationLat: currentRideRequest.destinationLat,
          destinationLng: currentRideRequest.destinationLng,
          driverLat: fromLocation.latitude,
          driverLng: fromLocation.longitude,
          firstName: currentRideRequest.firstName || "Customer",
          lastName: currentRideRequest.lastName || '',
          number: currentRideRequest.number || '',
          ridePrice: currentRideRequest.fare || 0,
          photo: currentRideRequest.photo || '',
          rideId: currentRideRequest.id,
          customerId: currentRideRequest.customerId || currentRideRequest.userId || '',
        };
        
        console.log('🎯 Customer information for navigation:', {
          firstName: navigationParams.firstName,
          lastName: navigationParams.lastName,
          number: navigationParams.number,
          photo: navigationParams.photo,
          customerId: navigationParams.customerId
        });
        
        console.log('Navigating to RideInProgressScreen with params:', navigationParams);
        
        // Navigate to ride in progress screen
        try {
          if (navigation && typeof navigation.navigate === 'function') {
            navigation.navigate("RideInProgressScreen", navigationParams);
          } else {
            throw new Error("Navigation not available");
          }
        } catch (navigationError) {
          console.error('Navigation error:', navigationError);
          throw new Error("Failed to navigate to ride screen");
        }
        
        // Clear current ride request
        setCurrentRideRequest(null);
        
      } catch (error) {
        console.error("Error accepting ride:", error);
        
        // Show user-friendly error message
        Alert.alert(
          "Erreur",
          "Impossible d'accepter la course. Veuillez réessayer.",
          [{ text: "OK" }]
        );
        
        // Reset states on error
        setRideInProgress(false);
        setIsModalVisible(false);
      }
    };

    // -----------------------------------------------------------------
    // 15. Decline Ride (Also unsubscribe to avoid second request)
    // -----------------------------------------------------------------
    const declineRide = async () => {
      if (!currentRideRequest) {
        console.log('No current ride request to decline');
        return;
      }
      
      console.log('Declining ride:', currentRideRequest.id);
      
      try {
        // Clean up subscriptions and timers first
        if (onSnapshotUnsubscribe.current) {
          try {
            onSnapshotUnsubscribe.current();
            onSnapshotUnsubscribe.current = null;
          } catch (unsubError) {
            console.error('Error unsubscribing from snapshot:', unsubError);
          }
        }
        
        if (timerRef.current) {
          try {
            clearInterval(timerRef.current);
            timerRef.current = null;
          } catch (timerError) {
            console.error('Error clearing timer:', timerError);
          }
        }
        
        // Clean up background countdown task
        try {
          // Background functionality removed to prevent crashes
          // Clean up stored countdown data
          AsyncStorage.removeItem(`countdown_${currentRideRequest.id}`).catch(console.error);
        } catch (error) {
          console.error('Error cleaning up background countdown:', error);
        }
        
        // Validate required data
        if (!currentRideRequest.id) {
          throw new Error("Invalid ride request ID");
        }
        
        // The server picks the next driver (drivers can't assign rides from the app).
        await httpsCallable(getFunctions(getApp()), 'declineRide')({ rideId: currentRideRequest.id });
        console.log("Ride declined:", currentRideRequest.id);
        
        // Close modal and reset state
        setIsModalVisible(false);
        setCurrentRideRequest(null);
        
        // Set cooldown to prevent immediate new requests
        setRideCooldown(true);
        setTimeout(() => setRideCooldown(false), 5000);
        
      } catch (error) {
        console.error("Error declining ride:", error);
        
        // Show user-friendly error message
        Alert.alert(
          "Erreur",
          "Impossible de refuser la course. Veuillez réessayer.",
          [{ text: "OK" }]
        );
        
        // Reset states on error
        setIsModalVisible(false);
        setCurrentRideRequest(null);
      }
    };

    // -----------------------------------------------------------------
    // 16. Refresh Handler Function
    // -----------------------------------------------------------------
    const onRefresh = async () => {
      console.log('🔄 Starting refresh operation...');
      setRefreshing(true);
      
      try {
        // Validate required data before refresh
        const currentUser = auth.currentUser;
        if (!currentUser) {
          throw new Error("No authenticated user found");
        }
        
        // Reload driver data and persisted data with error handling
        const refreshPromises = [];
        
        try {
          refreshPromises.push(fetchDriverDataFromFirestore());
        } catch (fetchError) {
          console.error('Error fetching driver data:', fetchError);
          // Continue with other refresh operations
        }
        
        try {
          refreshPromises.push(loadPersistedData());
        } catch (persistError) {
          console.error('Error loading persisted data:', persistError);
          // Continue with other refresh operations
        }
        
        // Wait for all successful operations
        if (refreshPromises.length > 0) {
          await Promise.allSettled(refreshPromises);
        }
        
        // Reset ride request and modal state safely
        try {
          setCurrentRideRequest(null);
          setIsModalVisible(false);
        } catch (stateError) {
          console.error('Error resetting state:', stateError);
        }
        
        // Force a re-render of the map safely
        try {
          setMapReady(false);
          setTimeout(() => {
            try {
              setMapReady(true);
            } catch (timeoutError) {
              console.error('Error setting map ready in timeout:', timeoutError);
            }
          }, 100);
        } catch (mapError) {
          console.error('Error updating map state:', mapError);
        }
        
        // Update the region to ensure map is centered
        try {
          if (fromLocation && fromLocation.latitude && fromLocation.longitude) {
            setRegion({
              latitude: fromLocation.latitude,
              longitude: fromLocation.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            });
          }
        } catch (regionError) {
          console.error('Error updating map region:', regionError);
        }
        
        // Verify and fix online status consistency
        try {
          await verifyAndFixOnlineStatus();
        } catch (verifyError) {
          console.error('Error during online status verification:', verifyError);
        }
        
        console.log('✅ Refresh operation completed successfully');
        
      } catch (error) {
        console.error("Error during refresh operation:", error);
        
        // Show user-friendly error message
        Alert.alert(
          "Erreur de rafraîchissement",
          "Impossible de rafraîchir les données. Veuillez réessayer.",
          [{ text: "OK" }]
        );
        
      } finally {
        // Always ensure refreshing state is reset
        try {
          setRefreshing(false);
        } catch (finalError) {
          console.error('Error resetting refreshing state:', finalError);
        }
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
    // 16.6.5. Online Status Synchronization Effect
    // -----------------------------------------------------------------
    useEffect(() => {
      let syncInterval = null;
      if (auth.currentUser) {
        // Check every 60 seconds to ensure Firestore matches local state
        // Reduced frequency to prevent conflicts with other updates
        syncInterval = setInterval(async () => {
          try {
            const driverRef = doc(db, "Drivers", auth.currentUser.uid);
            const driverDoc = await getDoc(driverRef);
            
            if (driverDoc.exists()) {
              const driverData = driverDoc.data();
              const firestoreOnline = driverData.isOnline;
              const localOnline = isOnline;
              
              // If there's a mismatch, fix it by updating Firestore to match local state
              if (firestoreOnline !== localOnline) {
                console.log(`🔄 Online status mismatch detected. Local: ${localOnline}, Firestore: ${firestoreOnline}. Fixing...`);
                
                await updateDoc(driverRef, {
                  isOnline: localOnline,
                  isAvailable: localOnline,
                  lastOnlineUpdate: new Date().toISOString()
                });
                
                console.log(`✅ Online status synchronized. Firestore now matches local: ${localOnline}`);
              }
            }
          } catch (error) {
            console.error('Error synchronizing online status:', error);
          }
        }, 60000); // Check every 60 seconds instead of 15 seconds
      }
      
      return () => {
        if (syncInterval) clearInterval(syncInterval);
      };
    }, [isOnline, auth.currentUser]);

    // -----------------------------------------------------------------
    // 16.6.6. Manual Online Status Verification Function
    // -----------------------------------------------------------------
    const verifyAndFixOnlineStatus = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        
        const driverRef = doc(db, "Drivers", currentUser.uid);
        const driverDoc = await getDoc(driverRef);
        
        if (driverDoc.exists()) {
          const driverData = driverDoc.data();
          const firestoreOnline = driverData.isOnline;
          const localOnline = isOnline;
          
          if (firestoreOnline !== localOnline) {
            console.log(`🔍 Manual verification: Online status mismatch. Local: ${localOnline}, Firestore: ${firestoreOnline}`);
            
            // Fix the mismatch
            if (localOnline) {
              await updateDoc(driverRef, { isOnline: true });
              console.log('✅ Fixed online status in Firestore');
            } else {
              await updateDoc(driverRef, { isOnline: false });
              console.log('✅ Fixed offline status in Firestore');
            }
          } else {
            console.log('✅ Online status is consistent between local and Firestore');
          }
        }
      } catch (error) {
        console.error('Error in manual online status verification:', error);
      }
    };

    // -----------------------------------------------------------------
    // 16.6.7. Periodic Push Token Refresh for Background Notifications
    // -----------------------------------------------------------------
    useEffect(() => {
      let tokenRefreshInterval = null;
      
      if (auth.currentUser && isOnline) {
        // Refresh push token every 30 minutes to ensure it stays valid
        tokenRefreshInterval = setInterval(async () => {
          try {
            console.log('🔄 Refreshing push token for background notifications...');
            
            // Update the push token
            await notificationService.updatePushToken();
            
            console.log('✅ Push token refreshed successfully');
          } catch (tokenError) {
            console.error('❌ Error refreshing push token:', tokenError);
          }
        }, 30 * 60 * 1000); // 30 minutes
      }
      
      return () => {
        if (tokenRefreshInterval) {
          clearInterval(tokenRefreshInterval);
        }
      };
    }, [auth.currentUser, isOnline]);

    // -----------------------------------------------------------------
    // 16.7. Ride Offer Service Integration
    // -----------------------------------------------------------------
    useEffect(() => {
      if (auth.currentUser && isOnline && rideOfferService) {
        try {
          // Check if the service has the required methods
          if (typeof rideOfferService.startListeningForOffers === 'function') {
            rideOfferService.startListeningForOffers(auth.currentUser.uid);
            
            // Set up offer update callback
            rideOfferService.onOfferUpdate = (offer) => {
              try {
                console.log('🔄 Ride offer received:', offer);
                setCurrentRideOffer(offer);
                setShowRideOfferModal(true);
              } catch (callbackError) {
                console.error('Error in offer update callback:', callbackError);
              }
            };
            
            // Set up offer expired callback
            rideOfferService.onOfferExpired = () => {
              try {
                console.log('⏰ Ride offer expired');
                setCurrentRideOffer(null);
                setShowRideOfferModal(false);
              } catch (callbackError) {
                console.error('Error in offer expired callback:', callbackError);
              }
            };
            
            console.log('✅ Ride offer service listening started successfully');
          } else {
            console.log('⚠️ RideOfferService missing required methods');
          }
        } catch (error) {
          console.error('❌ Error setting up ride offer service:', error);
          // Disable ride offers if service fails
          setCurrentRideOffer(null);
          setShowRideOfferModal(false);
        }
      }
      
      // Cleanup function
      return () => {
        try {
          if (rideOfferService && typeof rideOfferService.stopListening === 'function') {
            rideOfferService.stopListening();
            console.log('🔄 Ride offer service listening stopped');
          }
        } catch (cleanupError) {
          console.error('Error cleaning up ride offer service:', cleanupError);
        }
      };
    }, [auth.currentUser, isOnline, rideOfferService]);

    // -----------------------------------------------------------------
    // 16.8. Cleanup Effect
    // -----------------------------------------------------------------
    useEffect(() => {
      return () => {
        // Cleanup function to prevent crashes on unmount
        try {
          console.log('🔄 HomeScreenWithMap cleanup started');
          
          // Clear all timers and intervals
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          
          // Unsubscribe from Firestore listeners
          if (onSnapshotUnsubscribe.current) {
            try {
              onSnapshotUnsubscribe.current();
              onSnapshotUnsubscribe.current = null;
            } catch (unsubError) {
              console.error('Error during snapshot unsubscribe cleanup:', unsubError);
            }
          }
          
          // Stop ride offer service
          if (rideOfferService && typeof rideOfferService.stopListening === 'function') {
            try {
              rideOfferService.stopListening();
            } catch (serviceError) {
              console.error('Error stopping ride offer service during cleanup:', serviceError);
            }
          }
          
          // Clear background tasks
          if (backgroundTaskRef.current) {
            try {
              // Background functionality removed to prevent crashes
            } catch (taskError) {
              console.error('Error unregistering background task during cleanup:', taskError);
            }
          }
          
          // IMPORTANT: Do NOT change driver online status during cleanup
          // The driver's online status should only change when they explicitly toggle it
          console.log('✅ HomeScreenWithMap cleanup completed - online status preserved');
        } catch (cleanupError) {
          console.error('❌ Error during HomeScreenWithMap cleanup:', cleanupError);
        }
      };
    }, []);

    // Cleanup function for searching animation
    useEffect(() => {
      return () => {
        if (searchingTextIntervalRef.current) {
          clearInterval(searchingTextIntervalRef.current);
          searchingTextIntervalRef.current = null;
        }
        if (searchingDotAnimationRef.current) {
          searchingDotAnimationRef.current.stop();
          searchingDotAnimationRef.current = null;
        }
        if (circlePulseAnimationRef.current) {
          circlePulseAnimationRef.current.stop();
          circlePulseAnimationRef.current = null;
        }
      };
    }, []);

    // Stop searching animation when going offline
    useEffect(() => {
      if (!isOnline && showSearchingAnimation) {
        setShowSearchingAnimation(false);
        // Reset the text opacity
        searchingTextOpacity.setValue(0);
        // Stop any ongoing animations
        if (searchingTextIntervalRef.current) {
          clearInterval(searchingTextIntervalRef.current);
          searchingTextIntervalRef.current = null;
        }
        console.log('❌ Driver is offline, hiding searching animation');
      }
    }, [isOnline, showSearchingAnimation]);

    // Auto-show searching animation when driver goes online
    useEffect(() => {
      if (isOnline) {
        setShowSearchingAnimation(true);
        // Animate the text opacity to make it visible
        Animated.timing(searchingTextOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
        // Start the searching animation loop
        setTimeout(() => {
          startSearchingAnimation();
        }, 100);
        console.log('✅ Driver is online, showing searching animation');
      } else {
        setShowSearchingAnimation(false);
        // Reset the text opacity
        searchingTextOpacity.setValue(0);
        console.log('❌ Driver is offline, hiding searching animation');
      }
    }, [isOnline]);

    // -----------------------------------------------------------------
    // 16.6.7. Test Push Notification Function
    // -----------------------------------------------------------------
    const testPushNotification = async () => {
      try {
        console.log('🧪 Testing push notification system...');
        
        // First, check if we have a valid push token
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.log('❌ No authenticated user');
          return;
        }
        
        // Check current token status
        const tokenStatus = await notificationService.checkPushTokenStatus();
        console.log('📱 Current token status:', tokenStatus);
        
        if (tokenStatus.hasToken) {
          console.log('✅ Push token found');
          
          // Test local notification first
          await notificationService.sendLocalNotification(
            '🧪 Test Notification',
            'This is a test notification to verify the system is working.',
            { type: 'test', timestamp: new Date().toISOString() }
          );
          console.log('✅ Local test notification sent');
          
          // Now test if we can trigger the cloud function
          const testRideRef = doc(collection(db, "rideRequests"));
          await setDoc(testRideRef, {
            status: 'waiting',
            rideType: driverType || 'car',
            pickupAddress: 'Test Pickup Address',
            destinationAddress: 'Test Destination Address',
            fare: 1000,
            customerName: 'Test Customer',
            customerPhone: '+25377702036',
            createdAt: serverTimestamp(),
            isTest: true
          });
          
          console.log('✅ Test ride request created, should trigger cloud function');
          console.log('📱 Check your device for push notification (may take a few seconds)');
          
          // Clean up test ride after 30 seconds
          setTimeout(async () => {
            try {
              await updateDoc(testRideRef, { status: 'cancelled', testCleanedUp: true });
              console.log('🧹 Test ride cleaned up');
            } catch (cleanupError) {
              console.log('⚠️ Could not clean up test ride:', cleanupError.message);
            }
          }, 30000);
          
        } else {
          console.log('❌ No push token found');
          console.log('🔄 Attempting to update push token...');
          
          const newToken = await notificationService.updatePushToken();
          if (newToken) {
            console.log('✅ New push token obtained:', newToken.substring(0, 20) + '...');
            console.log('🔄 Retry the test after a few seconds');
          } else {
            console.log('❌ Failed to get push token');
          }
        }
      } catch (error) {
        console.error('❌ Error testing push notification:', error);
      }
    };

    // -----------------------------------------------------------------
    // 16.6.8. Test WhatsApp Notification Function
    // -----------------------------------------------------------------
    const testWhatsAppNotification = async () => {
      try {
        console.log('🧪 Testing WhatsApp notification system...');
        
        // Check if we have a current user
        const currentUser = auth.currentUser;
        if (!currentUser) {
          console.log('❌ No authenticated user');
          Alert.alert('Test Error', 'Please log in to test WhatsApp notifications');
          return;
        }
        
        // First check UltraMsg service status
        console.log('🔍 Checking UltraMsg service status...');
        const serviceStatus = await whatsAppService.checkUltraMsgStatus();
        console.log('📊 Service status:', serviceStatus);
        
        if (!serviceStatus.active) {
          Alert.alert(
            'WhatsApp Service Inactive', 
            `UltraMsg service is currently inactive:\n\n${JSON.stringify(serviceStatus.error, null, 2)}\n\nPlease reactivate your UltraMsg instance or set up an alternative service.`,
            [{ text: 'OK' }]
          );
          return;
        }
        
        // Get driver info from Firestore
        const driverDoc = await getDoc(doc(db, "Drivers", currentUser.uid));
        if (!driverDoc.exists()) {
          console.log('❌ Driver document not found');
          Alert.alert('Test Error', 'Driver information not found');
          return;
        }
        
        const driverData = driverDoc.data();
        const phoneNumber = driverData.phoneNumber || driverData.phone || driverData.number;
        
        if (!phoneNumber) {
          console.log('❌ Driver phone number not available');
          Alert.alert('Test Error', 'Driver phone number not available. Please update your profile with a phone number.');
          return;
        }
        
        console.log('📱 Testing WhatsApp with phone number:', phoneNumber);
        
        // Test WhatsApp integration
        await whatsAppService.testIntegration(phoneNumber);
        
        console.log('✅ WhatsApp test completed successfully');
        Alert.alert(
          'WhatsApp Test', 
          'WhatsApp test message sent successfully! Check your WhatsApp for the test message.',
          [{ text: 'OK' }]
        );
        
      } catch (error) {
        console.error('❌ Error testing WhatsApp notification:', error);
        Alert.alert(
          'WhatsApp Test Failed', 
          `Error: ${error.message}. Please check the console for details.`,
          [{ text: 'OK' }]
        );
      }
    };

    // -----------------------------------------------------------------
    // 16.6.9. Check WhatsApp Service Status Function
    // -----------------------------------------------------------------
    const checkWhatsAppServiceStatus = async () => {
      try {
        console.log('🔍 Checking WhatsApp service status...');
        
        const status = await whatsAppService.checkUltraMsgStatus();
        const serviceInfo = whatsAppService.getServiceStatus();
        
        console.log('📊 WhatsApp service status:', status);
        console.log('📊 Service configuration:', serviceInfo);
        
        let statusMessage = '';
        let statusTitle = '';
        
        if (status.active) {
          statusTitle = '✅ Service WhatsApp Actif';
          statusMessage = `Le service UltraMsg fonctionne correctement.\n\nInstance ID: ${serviceInfo.ultraMsg.instanceId}\nStatus: Active\n\nDeduplication: ${serviceInfo.deduplication.activeMessages} message actif\nCooldown: ${serviceInfo.deduplication.cooldownPeriod}ms`;
        } else {
          statusTitle = '❌ WhatsApp Service Inactive';
          statusMessage = `UltraMsg service is currently inactive.\n\nError: ${JSON.stringify(status.error, null, 2)}\n\nTo fix this:\n1. Go to ultramsg.com\n2. Log in to your account\n3. Reactivate instance ${serviceInfo.ultraMsg.instanceId}\n4. Wait 5 minutes for activation`;
        }
        
        Alert.alert(statusTitle, statusMessage, [
          { text: 'OK' },
          { text: 'Clear Cache', onPress: clearWhatsAppCache }
        ]);
        
      } catch (error) {
        console.error('❌ Error checking WhatsApp service status:', error);
        Alert.alert(
          'Status Check Failed', 
          `Error: ${error.message}. Please check the console for details.`,
          [{ text: 'OK' }]
        );
      }
    };

    // -----------------------------------------------------------------
    // 16.6.10. Clear WhatsApp Message Cache Function
    // -----------------------------------------------------------------
    const clearWhatsAppCache = async () => {
      try {
        console.log('🧹 Clearing WhatsApp message cache...');
        
        const result = whatsAppService.clearMessageCache();
        const stats = whatsAppService.getDeduplicationStats();
        
        console.log('📊 Cache cleared:', result);
        console.log('📊 Current stats:', stats);
        
        Alert.alert(
          'Cache Cleared', 
          `WhatsApp message cache has been cleared.\n\nRemoved: ${result.removedCount} entries\nCurrent active: ${stats.activeEntries}`,
          [{ text: 'OK' }]
        );
        
      } catch (error) {
        console.error('❌ Error clearing WhatsApp cache:', error);
        Alert.alert(
          'Cache Clear Failed', 
          `Error: ${error.message}. Please check the console for details.`,
          [{ text: 'OK' }]
        );
      }
    };

    // -----------------------------------------------------------------
    // 16.8.5. Find Closest Driver to Pickup Location
    // -----------------------------------------------------------------
    const findClosestDriverToPickup = async (rideId) => {
      try {
        console.log('🔍 Finding closest driver to pickup location for ride:', rideId);
        
        // First, get the ride request to get pickup coordinates
        const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
        if (!rideDoc.exists()) {
          console.log('❌ Ride request not found:', rideId);
          return null;
        }
        
        const rideData = rideDoc.data();
        
        // Get pickup coordinates from rideRequests collection
        const pickupLocation = {
          latitude: rideData.pickupLat,
          longitude: rideData.pickupLng
        };
        
        if (!pickupLocation.latitude || !pickupLocation.longitude) {
          console.error('❌ Invalid pickup coordinates in rideRequests:', pickupLocation);
          return null;
        }
        
        console.log('📍 Pickup location from rideRequests:', pickupLocation);
        
        // Get all available drivers of the same type
        const driversQuery = query(
          collection(db, "Drivers"),
          where("isOnline", "==", true),
          where("driverType", "==", rideData.rideType || "standard")
        );
        
        const driversSnapshot = await getDocs(driversQuery);
        const availableDrivers = [];
        
        console.log(`🔍 Found ${driversSnapshot.size} online drivers of type ${rideData.rideType || "standard"}`);
        
        driversSnapshot.forEach((doc) => {
          const driverData = doc.data();
          
          // Check if driver is available (not in progress, no current ride)
          const isAvailable = (
            driverData.isAvailable !== false &&
            driverData.rideInProgress !== true &&
            !driverData.currentRideId
          );
          
          // Only include drivers with valid coordinates and are available
          if (driverData.latitude && driverData.longitude && isAvailable) {
            const distance = calculateDistance(
              { latitude: driverData.latitude, longitude: driverData.longitude },
              pickupLocation
            );
            
            availableDrivers.push({
              id: doc.id,
              ...driverData,
              distanceToPickup: distance
            });
            
            console.log(`📍 Driver ${doc.id}: ${distance.toFixed(2)}km from pickup`);
          }
        });
        
        if (availableDrivers.length === 0) {
          console.log('❌ No available drivers found');
          return null;
        }
        
        // Sort drivers by distance (closest first)
        const sortedDrivers = availableDrivers.sort((a, b) => a.distanceToPickup - b.distanceToPickup);
        
        // Get the closest driver
        const closestDriver = sortedDrivers[0];
        
        console.log(`✅ Closest driver selected: ${closestDriver.id} at ${closestDriver.distanceToPickup.toFixed(2)}km`);
        console.log(`📍 Driver coordinates: ${closestDriver.latitude}, ${closestDriver.longitude}`);
        console.log(`📍 Pickup coordinates: ${pickupLocation.latitude}, ${pickupLocation.longitude}`);
        
        return closestDriver;
        
      } catch (error) {
        console.error('❌ Error finding closest driver to pickup:', error);
        return null;
      }
    };

    // -----------------------------------------------------------------
    // 16.8.6. Assign Ride to Best Driver in SelectedDriver Collection
    // -----------------------------------------------------------------
    const assignRideToBestDriver = async (rideId) => {
      // Ride assignment now runs only in Cloud Functions
      // (selectBestDriverForNewRideRequest / declineRide). Firestore rules
      // block drivers from assigning rides, so this is intentionally a no-op.
      return false;
      // eslint-disable-next-line no-unreachable
      try {
        console.log('🚀 Assigning ride to best driver:', rideId);
        
        // Find the closest available driver
        const bestDriver = await findClosestDriverToPickup(rideId);
        if (!bestDriver) {
          console.log('❌ No suitable driver found for ride assignment');
          return false;
        }
        
        // Update the rideRequests collection with the selected driver
        await updateDoc(doc(db, "rideRequests", rideId), {
          selectedDriverId: bestDriver.id,
          driverId: bestDriver.id,
          driverName: bestDriver.firstName || bestDriver.userName || bestDriver.name || "Driver",
          driverPhoto: bestDriver.photo || bestDriver.profilePhoto || "",
          driverPhone: bestDriver.phoneNumber || null,
          driverSelectedAt: serverTimestamp(),
          status: "driver_selected"
        });
        
        // Create or update the SelectedDriver collection entry
        const selectedDriverRef = doc(db, "SelectedDriver", rideId);
        await setDoc(selectedDriverRef, {
          rideId: rideId,
          driverId: bestDriver.id,
          driverInfo: {
            id: bestDriver.id,
            name: bestDriver.firstName || bestDriver.userName || bestDriver.name || "Driver",
            photo: bestDriver.photo || bestDriver.profilePhoto || "",
            phone: bestDriver.phoneNumber || null,
            rating: bestDriver.rating || 4.0,
            driverType: bestDriver.driverType || "standard"
          },
          pickupLocation: {
            latitude: bestDriver.latitude,
            longitude: bestDriver.longitude
          },
          distanceToPickup: bestDriver.distanceToPickup,
          status: "assigned",
          assignedAt: serverTimestamp(),
          countdownExpiryTime: new Date(Date.now() + 20 * 60 * 1000).toISOString() // 20 minutes countdown
        });
        
        console.log('✅ Ride successfully assigned to best driver in SelectedDriver collection');
        console.log(`🎯 Driver ${bestDriver.id} assigned to ride ${rideId}`);
        console.log(`📍 Distance: ${bestDriver.distanceToPickup.toFixed(2)}km`);
        
        // Send WhatsApp notification to the selected driver
        try {
          console.log('📱 Sending WhatsApp notification to selected driver...');
          
          // Get the complete ride data for the notification
          const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
          if (rideDoc.exists()) {
            const rideData = rideDoc.data();
            
            // Prepare ride info for WhatsApp notification
            const rideInfo = {
              id: rideId,
              pickupAddress: rideData.pickupAddress || 'Adresse de départ',
              destinationAddress: rideData.destinationAddress || 'Adresse de destination',
              fare: rideData.fare || 0,
              estimatedTime: Math.round((bestDriver.distanceToPickup / 30) * 60) || 15
            };
            
            // Send WhatsApp notification
            await whatsAppService.sendRideAssignmentNotification(bestDriver, rideInfo);
            console.log('✅ WhatsApp notification sent successfully to driver:', bestDriver.firstName || bestDriver.name);
          }
        } catch (whatsappError) {
          console.error('❌ Error sending WhatsApp notification:', whatsappError);
          // Don't fail the ride assignment if WhatsApp fails
          console.log('⚠️ Ride assignment continues despite WhatsApp notification failure');
        }
        
        // If this driver is the current user, immediately show the ride offer
        if (bestDriver.id === auth.currentUser?.uid) {
          console.log('🎯 This driver is the current user - immediately showing ride offer');
          
          try {
            // Get the complete ride data to show the offer
            const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
            if (rideDoc.exists()) {
              const rideData = rideDoc.data();
              
              // Fetch customer information from rideRequestsDriver collection
              let customerInfo = null;
              try {
                const rideRequestDriverQuery = query(
                  collection(db, "rideRequestsDriver"),
                  where("rideRequestId", "==", rideId)
                );
                const rideRequestDriverSnapshot = await getDocs(rideRequestDriverQuery);
                
                if (!rideRequestDriverSnapshot.empty) {
                  customerInfo = rideRequestDriverSnapshot.docs[0].data();
                  console.log('✅ Customer info fetched:', customerInfo);
                } else {
                  console.log('⚠️ No customer info found in rideRequestsDriver collection');
                }
              } catch (customerError) {
                console.error('❌ Error fetching customer info:', customerError);
              }
              
              // Create the ride offer object with customer information
              const rideOffer = {
                id: rideId,
                ...rideData,
                firstName: customerInfo?.firstName || "Customer",
                lastName: customerInfo?.lastName || "",
                number: customerInfo?.number || "",
                photo: customerInfo?.photo || "",
                customerId: customerInfo?.customerId || customerInfo?.userId || ""
              };
              
              console.log('🎯 Ride offer with customer info:', {
                firstName: rideOffer.firstName,
                lastName: rideOffer.lastName,
                number: rideOffer.number,
                photo: rideOffer.photo,
                customerId: rideOffer.customerId
              });
              
              // Set the current ride request to show the modal
              setCurrentRideRequest(rideOffer);
              
              // Start loading address and show modal
              setIsLoadingAddress(true);
              
              try {
                const pickupLocation = { latitude: rideData.pickupLat, longitude: rideData.pickupLng };
                const destinationLocation = {
                  latitude: rideData.destinationLat,
                  longitude: rideData.destinationLng,
                };
                
                // Calculate distance and time
                const distance = calculateDistance(pickupLocation, destinationLocation);
                setRideDistance(distance);
                const estimatedMinutes = Math.round((distance / 30) * 60);
                setEstimatedTime(estimatedMinutes);
                
                // Get addresses
                const pickupLoc = await Location.reverseGeocodeAsync(pickupLocation);
                const pickupAddr = pickupLoc.length > 0
                  ? `${pickupLoc[0].name || ""} ${pickupLoc[0].street || ""}`
                  : "Pickup Address Not Found";
                setPickupAddress(pickupAddr);
                
                const destLoc = await Location.reverseGeocodeAsync(destinationLocation);
                const destAddr = destLoc.length > 0
                  ? `${destLoc[0].name || ""} ${destLoc[0].street || ""}`
                  : "Destination Address Not Available";
                setDestinationAddress(destAddr);
                
              } catch (error) {
                console.error("Error in reverse geocoding:", error);
                setPickupAddress("Pickup Address Not Available");
                setDestinationAddress("Destination Address Not Available");
              } finally {
                setIsLoadingAddress(false);
                
                // Show the modal immediately
                setIsModalVisible(true);
                setTimeLeft(20);
                startTimer();
                
                // Start the countdown animation
                Animated.timing(countdownAnim, {
                  toValue: 0,
                  duration: 15000,
                  useNativeDriver: false,
                }).start();
                
                console.log('✅ Ride offer modal displayed immediately with customer info');
              }
            }
          } catch (error) {
            console.error('❌ Error showing immediate ride offer:', error);
          }
        }
        
        return true;
        
      } catch (error) {
        console.error('❌ Error assigning ride to best driver:', error);
        return false;
      }
    };

    // -----------------------------------------------------------------
    // 16.8.7. Smart Ride Assignment on New Ride Request
    // -----------------------------------------------------------------
    const handleNewRideRequest = async (rideId) => {
      try {
        console.log('🆕 New ride request received:', rideId);
        
        // Automatically assign to best driver
        const assignmentSuccess = await assignRideToBestDriver(rideId);
        
        if (assignmentSuccess) {
          console.log('✅ Ride automatically assigned to best driver');
          
          // Send notification to the selected driver
          try {
            const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
            if (rideDoc.exists()) {
              const rideData = rideDoc.data();
              
              // Check if notifications are properly initialized
              const hasPermission = await notificationService.requestPermissions();
              if (hasPermission) {
                await notificationService.sendLocalNotification(
                  '🎯 Course assignée!',
                  `Nouvelle course disponible! Départ: ${rideData.pickupAddress || 'Adresse de départ'}`,
                  {
                    type: 'ride_request',
                    rideId: rideId,
                    driverId: rideData.selectedDriverId,
                    fare: rideData.fare?.toString() || '0',
                    pickupAddress: rideData.pickupAddress || 'Adresse de départ',
                    destinationAddress: rideData.destinationAddress || 'Adresse de destination',
                    rideType: rideData.rideType || 'car'
                  },
                  'ride-requests'
                );
                console.log('✅ Notification sent to selected driver');
              }
            }
          } catch (notificationError) {
            console.error('❌ Error sending notification:', notificationError);
          }
          
          // Send WhatsApp notification to the selected driver
          try {
            const rideDoc = await getDoc(doc(db, "rideRequests", rideId));
            if (rideDoc.exists()) {
              const rideData = rideDoc.data();
              const selectedDriverId = rideData.selectedDriverId;
              
              if (selectedDriverId) {
                // Get driver information
                const driverDoc = await getDoc(doc(db, "Drivers", selectedDriverId));
                if (driverDoc.exists()) {
                  const driverData = driverDoc.data();
                  
                  // Prepare ride info for WhatsApp notification
                  const rideInfo = {
                    id: rideId,
                    pickupAddress: rideData.pickupAddress || 'Adresse de départ',
                    destinationAddress: rideData.destinationAddress || 'Adresse de destination',
                    fare: rideData.fare || 0,
                    estimatedTime: 15 // Default estimated time
                  };
                  
                  // Send WhatsApp notification
                  await whatsAppService.sendRideAssignmentNotification({ ...driverData, id: selectedDriverId }, rideInfo);
                  console.log('✅ WhatsApp notification sent to automatically assigned driver:', driverData.firstName || driverData.name);
                }
              }
            }
          } catch (whatsappError) {
            console.error('❌ Error sending WhatsApp notification for automatic assignment:', whatsappError);
            // Don't fail the automatic assignment if WhatsApp fails
            console.log('⚠️ Automatic assignment continues despite WhatsApp notification failure');
          }
        } else {
          console.log('❌ Failed to assign ride to driver');
        }
        
      } catch (error) {
        console.error('❌ Error handling new ride request:', error);
      }
    };

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

    // Safe render with error boundary
    return (
      <ErrorBoundary>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Full-screen circle animation overlay */}
            {showFullScreenAnimation && (
              <Animated.View
                style={[
                  styles.fullScreenAnimationOverlay,
                  {
                    opacity: fullScreenCircleOpacity,
                  },
                ]}
                pointerEvents="none"
              >
                {console.log('🎬 Rendering full-screen animation overlay:', {
                  showFullScreenAnimation,
                  fullScreenCircleOpacity: fullScreenCircleOpacity._value,
                  fullScreenCircleScale: fullScreenCircleScale._value,
                  fullScreenText: fullScreenText._value,
                  fullScreenIcon: fullScreenIcon._value
                })}
                
                {/* Debug indicator */}
                <View style={styles.debugIndicator}>
                  <Text style={styles.debugText}>🎬 ANIMATION ACTIVE!</Text>
                </View>
                
                {/* Background glow effect */}
                <Animated.View
                  style={[
                    styles.fullScreenBackgroundGlow,
                    {
                      opacity: fullScreenCircleOpacity.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.3],
                      }),
                    },
                  ]}
                />
                
                {/* Expanding circle from button center */}
                <Animated.View
                  style={[
                    styles.fullScreenCircle,
                    {
                      transform: [
                        {
                          scale: fullScreenCircleScale.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 6], // Expand to cover entire screen and beyond
                          }),
                        },
                      ],
                      opacity: fullScreenCircleOpacity.interpolate({
                        inputRange: [0, 0.5, 1],
                        outputRange: [0, 0.8, 0.3], // Fade out as it expands
                      }),
                    },
                  ]}
                />
                
                {/* Secondary expanding ring for extra drama */}
                <Animated.View
                  style={[
                    styles.fullScreenCircleRing,
                    {
                      transform: [
                        {
                          scale: fullScreenCircleScale.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 8], // Even larger ring
                          }),
                        },
                      ],
                      opacity: fullScreenCircleOpacity.interpolate({
                        inputRange: [0, 0.3, 1],
                        outputRange: [0, 0.6, 0.1], // Different fade pattern
                      }),
                    },
                  ]}
                />
                
                {/* Full-screen text */}
                <Animated.View
                  style={[
                    styles.fullScreenTextContainer,
                    {
                      opacity: fullScreenText,
                      transform: [
                        {
                          scale: fullScreenText.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.8, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <Text style={styles.fullScreenText}>{fullScreenMessage}</Text>
                </Animated.View>
                
                {/* Full-screen icon */}
                <Animated.View
                  style={[
                    styles.fullScreenIconContainer,
                    {
                      opacity: fullScreenIcon,
                      transform: [
                        {
                          scale: fullScreenIcon.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 1.2],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <MaterialIcons name="rocket-launch" size={80} color="#FFFFFF" />
                </Animated.View>
              </Animated.View>
            )}
            
            {/* Map Container with Error Boundary */}
            <View style={styles.mapContainer}>
              <MapView
                ref={mapRef}
                style={[styles.map, { backgroundColor: '#000000' }]}
                initialRegion={region}
                region={region}
                showsUserLocation
                showsMyLocationButton
                onMapReady={() => {
                  try {
                    setMapReady(true);
                    console.log('✅ Map is ready');
                    console.log('🗺️ Map region on ready:', region);
                  } catch (error) {
                    console.error('❌ Map ready error:', error);
                  }
                }}
                onError={(error) => {
                  try {
                    console.error('Map error:', error);
                    console.error('Map error details:', JSON.stringify(error));
                    Alert.alert(
                      'Map Error',
                      'There was an error loading the map. Please check your internet connection and try again.',
                      [{ text: 'OK' }]
                    );
                  } catch (alertError) {
                    console.error('❌ Alert error:', alertError);
                  }
                }}
                onLayout={() => {
                  console.log('🗺️ Map layout event triggered');
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
              
              {/* Location loading overlay */}
              {isLocationLoading && (
                <View style={styles.mapLoadingOverlay}>
                  <ActivityIndicator size="large" color="#FF8C00" />
                  <Text style={styles.mapLoadingText}>
                    {isLocationLoading ? "Getting your location..." : "Map ready"}
                  </Text>
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
                    onPress={() => {
                      try {
                        navigation.navigate("OnlineDriverScreen");
                      } catch (error) {
                        console.error('❌ Navigation error to OnlineDriverScreen:', error);
                      }
                    }}
                  >
                    <Ionicons name="people-outline" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.topButton}
                    onPress={() => {
                      try {
                        checkWhatsAppServiceStatus();
                      } catch (error) {
                        console.error('❌ WhatsApp status check error:', error);
                      }
                    }}
                  >
                    <MaterialIcons name="info-outline" size={24} color="#4CAF50" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => {
                      try {
                        navigation.navigate("SettingsScreen");
                      } catch (error) {
                        console.error('❌ Navigation error to SettingsScreen:', error);
                      }
                    }}
                  >
                    <Ionicons name="settings-outline" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              </View>
              
              <TouchableOpacity
                style={styles.earningsCard}
                onPress={() => {
                  try {
                    const currentActiveTime = isOnline ? Math.floor((Date.now() - startTime) / 1000) : activeTime;
                    navigation.navigate("EarningsScreen", { 
                      isOnline,
                      activeTime: currentActiveTime,
                      startTime: isOnline ? startTime : null,
                      rideCount: rideCount
                    });
                  } catch (error) {
                    console.error('❌ Navigation error to EarningsScreen:', error);
                  }
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

              {isOnline && !currentRideRequest && (
                <Animated.View 
                  style={[
                    styles.searchingContainer,
                    { opacity: fadeAnim }
                  ]}
                >
                  <View style={styles.searchingBlur}>
                    <View style={styles.searchingContent}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <View style={styles.searchingTextRow}>
                        <MaterialIcons name="directions-car" size={16} color="#FFFFFF" style={styles.searchingIcon} />
                        <Text style={styles.searchingText}>Nous cherchons des courses, restez sur place et attendez...</Text>
                      </View>
                    </View>
                  </View>
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
                      { scale: goButtonPressAnim },
                    ],
                  },
                ]}
              >
                {console.log('🎬 Button wrapper transform:', {
                  goButtonPressAnim: goButtonPressAnim._value,
                  isOnline,
                  showFullScreenAnimation
                })}
                <TouchableOpacity
                  style={[
                    styles.onlineButton,
                    isOnline ? styles.onlineButtonActive : {},
                    isUpdatingStatus && styles.onlineButtonUpdating
                  ]}
                  onPress={() => {
                    try {
                      console.log('🔘 GO button pressed!');
                      
                      // Simple test animation to verify it's working
                      Animated.sequence([
                        Animated.timing(goButtonPressAnim, {
                          toValue: 0.8,
                          duration: 100,
                          useNativeDriver: true,
                        }),
                        Animated.timing(goButtonPressAnim, {
                          toValue: 1.2,
                          duration: 200,
                          useNativeDriver: true,
                        }),
                        Animated.timing(goButtonPressAnim, {
                          toValue: 1,
                          duration: 100,
                          useNativeDriver: true,
                        }),
                      ]).start();
                      
                      // Try the ultra-safe toggle first
                      ultraSafeToggleOnlineStatus();
                    } catch (error) {
                      console.error('❌ Ultra-safe toggle failed, trying simple fallback:', error);
                      try {
                        simpleToggleOnlineStatus();
                      } catch (fallbackError) {
                        console.error('❌ Simple fallback also failed, trying main toggle:', fallbackError);
                        try {
                          toggleOnlineStatus();
                        } catch (mainError) {
                          console.error('❌ All toggle methods failed:', mainError);
                          // Last resort - just reset the state
                          try {
                            setIsUpdatingStatus(false);
                          } catch (resetError) {
                            console.error('❌ Even state reset failed:', resetError);
                          }
                        }
                      }
                    }
                  }}
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
                        {/* Enhanced glow effect */}
                        <Animated.View
                          style={[
                            styles.glowEffect,
                            {
                              opacity: goButtonGlowIntensity,
                              transform: [
                                {
                                  scale: goButtonGlowIntensity.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [1, 2],
                                  }),
                                },
                              ],
                            },
                          ]}
                        />
                        
                        {/* Success checkmark when going online */}
                        {isOnline && (
                          <Animated.View
                            style={[
                              styles.successCheck,
                              {
                                opacity: goButtonSuccess,
                                transform: [
                                  {
                                    scale: goButtonSuccess.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [0, 1],
                                    }),
                                  },
                                ],
                              },
                            ]}
                          >
                            <MaterialIcons name="check-circle" size={24} color="#FFFFFF" />
                          </Animated.View>
                        )}
                        
                        <Text style={styles.onlineButtonText}>
                          {isOnline ? "EN LIGNE" : "GO"}
                        </Text>
                        
                        {/* Ripple effect when going online */}
                        {isOnline && (
                          <Animated.View
                            style={[
                              styles.ripple,
                              {
                                transform: [
                                  {
                                    scale: goButtonRipple.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [0.5, 3],
                                    }),
                                  },
                                ],
                                opacity: goButtonRipple.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [1, 0],
                                }),
                              },
                            ]}
                          />
                        )}
                        
                        {/* Original animations for offline state */}
                        {!isOnline && (
                          <>
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
                          </>
                        )}
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
              
              {/* Searching status text - moved outside button to display on screen */}
              {isOnline && showSearchingAnimation && (
                <Animated.View
                  style={[
                    styles.searchingTextContainer,
                    {
                      opacity: searchingTextOpacity,
                    },
                  ]}
                >
                  <View style={styles.searchingTextRow}>
                    <MaterialIcons name="directions-car" size={16} color="#FFFFFF" style={styles.searchingIcon} />
                    <Text style={styles.searchingText}>{searchingText}</Text>
                  </View>
                  <View style={styles.searchingDots}>
                    <ActivityIndicator size="small" color="#FFFFFF" style={styles.loadingSpinner} />
                    <Animated.View
                      style={[
                        styles.searchingDot,
                        {
                          opacity: searchingAnimation.interpolate({
                            inputRange: [0, 0.33, 0.66, 1],
                            outputRange: [0.3, 1, 0.3, 0.3],
                          }),
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.searchingDot,
                        {
                          opacity: searchingAnimation.interpolate({
                            inputRange: [0, 0.33, 0.66, 1],
                            outputRange: [0.3, 0.3, 1, 0.3],
                          }),
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.searchingDot,
                        {
                          opacity: searchingAnimation.interpolate({
                            inputRange: [0, 0.33, 0.66, 1],
                            outputRange: [0.3, 0.3, 0.3, 1],
                          }),
                        },
                      ]}
                    />
                  </View>
                </Animated.View>
              )}
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
                                onPress={() => {
                                  try {
                                    Linking.openURL(`tel:${currentRideRequest.number}`);
                                  } catch (error) {
                                    console.error('❌ Error opening phone call:', error);
                                  }
                                }}
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

            {/* Ride Offer Modal - Only render if service is available */}
            {rideOfferService && (
              <RideOfferModal
                visible={showRideOfferModal}
                offer={currentRideOffer}
                onAccept={(offer) => {
                  try {
                    console.log('Ride offer accepted:', offer);
                    setShowRideOfferModal(false);
                    setCurrentRideOffer(null);
                    // Navigate to ride in progress screen
                    navigation.navigate('RideInProgressScreen', {
                      rideId: offer.rideId,
                      rideData: offer.rideData
                    });
                  } catch (error) {
                    console.error('❌ Error accepting ride offer:', error);
                  }
                }}
                onReject={(offer) => {
                  try {
                    console.log('Ride offer rejected:', offer);
                    setShowRideOfferModal(false);
                    setCurrentRideOffer(null);
                  } catch (error) {
                    console.error('❌ Error rejecting ride offer:', error);
                  }
                }}
                onClose={() => {
                  try {
                    console.log('Ride offer modal closed');
                    setShowRideOfferModal(false);
                    setCurrentRideOffer(null);
                  } catch (error) {
                    console.error('❌ Error closing ride offer modal:', error);
                  }
                }}
              />
            )}
            
            {/* AUTO-OFFLINE TIMER COMPONENT
                This component automatically appears when the driver has less than 5 minutes remaining
                before being automatically set offline. It provides two options:
                1. EXTEND: Resets the timer for another 20 minutes
                2. OFFLINE: Goes offline immediately
                
                The timer cannot be disabled or overridden - drivers MUST go offline after 20 minutes
                unless they explicitly extend their time. This ensures system reliability and prevents
                drivers from staying online indefinitely. */}
            <AutoOfflineTimer
              isOnline={isOnline}
              remainingTime={(() => {
                const time = getRemainingTime();
                if (time > 0 && time <= 5) {
                  console.log(`⏰ HomeScreen: AutoOfflineTimer requesting remaining time: ${time} minutes`);
                }
                return time;
              })()}
              onExtendTime={() => {
                console.log('⏰ HomeScreen: EXTEND requested from AutoOfflineTimer - resetting timer');
                resetTimer();
              }}
              onGoOffline={() => {
                try {
                  console.log('🔄 User chose to go offline from auto-offline timer');
                  setIsOnline(false);
                } catch (error) {
                  console.error('❌ Error going offline from timer:', error);
                }
              }}
            />
          </SafeAreaView>
        </ErrorBoundary>
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
    marginTop: 8,
    alignItems: 'center',
    paddingHorizontal: 16,
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    transform: [{ translateY: -25 }],
  },
  searchingBlur: {
    borderRadius: 8,
    overflow: 'hidden',
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    maxWidth: 300,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  searchingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  searchingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    flex: 1,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffcccc',
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#ff3333',
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginHorizontal: 20,
    color: '#333',
  },
  errorButton: {
    backgroundColor: '#ff3333',
    padding: 10,
    borderRadius: 5,
    marginTop: 20,
  },
  errorButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Enhanced GO button styles
  searchingTextContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 500 : 650,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 140, 0, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 8,
    marginBottom: 20,
    shadowColor: "#FF8C00",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2,
    borderColor: '#FF8C00',
  },
  searchingText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  searchingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
    marginHorizontal: 2,
  },
  successCheck: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    padding: 2,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  glowEffect: {
    position: 'absolute',
    top: -20,
    left: -20,
    right: -20,
    bottom: -20,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 140, 0, 0.3)',
    zIndex: -1,
  },
  fullScreenAnimationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  fullScreenCircle: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 215, 0, 0.3)',
    borderWidth: 3,
    borderColor: '#FFD700',
    marginLeft: -40,
    marginTop: -40,
    zIndex: 2,
  },
  fullScreenTextContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -100,
    marginTop: -30,
    zIndex: 3,
  },
  fullScreenText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  fullScreenIconContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -40,
    marginTop: 40,
    zIndex: 3,
  },
  fullScreenIcon: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '600',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 3,
    marginTop: 20,
  },
  fullScreenCircleRing: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: '#FFD700',
    marginLeft: -60,
    marginTop: -60,
    zIndex: 2,
  },
  fullScreenBackgroundGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
    zIndex: 1,
  },
  debugIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  debugText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  testAnimationButton: {
    backgroundColor: '#FF8C00',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
    marginBottom: 10,
  },
  testAnimationButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingSpinner: {
    marginRight: 8,
    marginLeft: 4,
  },
  searchingTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 0,
  },
  searchingIcon: {
    marginRight: 0,
  },
});

// Wrap the component export in an error boundary
const SafeHomeScreenWithMap = () => {
  try {
    return <HomeScreenWithMap />;
  } catch (error) {
    console.error('🚨 CRITICAL ERROR in HomeScreenWithMap:', error);
    return (
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ffcccc',
        padding: 20
      }}>
        <Text style={{
          fontSize: 24,
          fontWeight: 'bold',
          marginBottom: 10,
          color: '#ff3333',
          textAlign: 'center'
        }}>
          🚨 Erreur Critique
        </Text>
        <Text style={{
          fontSize: 16,
          textAlign: 'center',
          marginBottom: 20,
          color: '#333'
        }}>
          L'application a rencontré une erreur critique. Veuillez redémarrer l'application.
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: '#ff3333',
            padding: 15,
            borderRadius: 8
          }}
          onPress={() => {
            console.log('🔄 Critical error recovery attempted');
          }}
        >
          <Text style={{
            color: '#fff',
            fontSize: 16,
            fontWeight: 'bold'
          }}>
            Redémarrer
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
};

export default SafeHomeScreenWithMap;
