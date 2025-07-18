import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Linking,
  ActivityIndicator,
  Image,
  Animated,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import * as Haptics from 'expo-haptics';
import MapView, { Marker } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, updateDoc, serverTimestamp, getDoc, onSnapshot } from "firebase/firestore";
import { db, auth } from "../config/firebase";
import { createConversation } from "../utils/messaging";

// Import your custom pin image
import CustomPin from "../assets/CustomPin.png";

const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

const RideInProgressScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const mapRef = useRef(null);
  const GOOGLE_MAPS_APIKEY = "AIzaSyBnVN-ACYzcA0Sy8BcPLpXG50Y9T8jhJGE";

  // Configure navigation options to prevent swiping back
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: false, // Disable swipe back gesture
      headerLeft: () => null, // Remove back button
    });
  }, [navigation]);

  // Initialize customer info from route params
  const [customerInfo, setCustomerInfo] = useState({
    firstName: route.params?.firstName || "",
    number: route.params?.number || "",
    photo: route.params?.photo || "",
    price: route.params?.ridePrice || 0
  });

  // Extract parameters from route
  const {
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    pickupAddress,
    destinationAddress,
    driverLat,
    driverLng,
    rideId,
  } = route.params || {};

  console.log('Route params:', {
    pickupLat,
    pickupLng,
    destinationLat,
    destinationLng,
    pickupAddress,
    destinationAddress,
    driverLat,
    driverLng,
    rideId,
  });

  // Define initial states
  const [driverLocation, setDriverLocation] = useState(
    driverLat && driverLng ? { latitude: driverLat, longitude: driverLng } : null
  );
  const [pickupLocation] = useState(
    pickupLat && pickupLng ? { latitude: pickupLat, longitude: pickupLng } : null
  );
  const [dropOffLocation, setDropOffLocation] = useState(() => {
    console.log('Initializing dropOffLocation with:', {
      destinationLat,
      destinationLng,
      routeParams: route.params
    });
    
    if (destinationLat && destinationLng) {
      const location = {
        latitude: destinationLat,
        longitude: destinationLng
      };
      console.log('Created dropOffLocation:', location);
      return location;
    }
    console.log('No destination coordinates available');
    return null;
  });

  // New step-based state management
  const [currentStep, setCurrentStep] = useState(1); // 1: Arrivé, 2: Client pris, 3: Client déposé
  const [isLoadingState, setIsLoadingState] = useState(true);
  const stateInitializedRef = useRef(false);

  // Legacy state variables (kept for compatibility)
  const [hasPickedUpCustomer, setHasPickedUpCustomer] = useState(false);
  const [hasArrivedAtPickup, setHasArrivedAtPickup] = useState(false);
  const [hasDroppedOffCustomer, setHasDroppedOffCustomer] = useState(false);

  const [isNavigating, setIsNavigating] = useState(false);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [pressing, setPressing] = useState(false);
  const [buttonScale] = useState(new Animated.Value(1));
  const [buttonGlow] = useState(new Animated.Value(0));
  const [successAnimation] = useState(new Animated.Value(0));
  const [pulseAnimation] = useState(new Animated.Value(1));
  const [rippleAnimation] = useState(new Animated.Value(0));
  const [successScaleAnimation] = useState(new Animated.Value(1));
  const progress = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef(null);
  const longPressTimer = useRef(null);
  const [currentRideId, setCurrentRideId] = useState(rideId);
  const [showProblemModal, setShowProblemModal] = useState(false);
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [problemModalStep, setProblemModalStep] = useState(1); // 1: select problem, 2: answer questions, 3: contact support
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [customAnswers, setCustomAnswers] = useState({});

  // Questions that need custom answer options
  const customAnswerQuestions = {
    1: [false, false, false], // Client non présent - all Yes/No
    2: [false, false, false], // Adresse incorrecte - all Yes/No
    3: [false, false, false], // Client annule - all Yes/No
    4: [false, false, false], // Problème de paiement - all Yes/No
    5: [false, false, false], // Problème technique - all Yes/No
    6: [true, true, false], // Autre problème - custom answers for first two questions
  };

  // Custom answer options for specific questions
  const customAnswerOptions = {
    6: [ // Autre problème
      ["Client", "Moi"], // For "Ce problème affecte-t-il votre sécurité ou celle du client ?"
      ["Client", "Moi"], // For "Ce problème affecte-t-il votre sécurité ou celle du client ?"
      ["Oui", "Non"] // For "Avez-vous besoin d'une assistance urgente ?"
    ]
  };

  // Questions for each problem type
  const problemQuestions = {
    1: [ // Client non présent
      "Avez-vous attendu plus de 5 minutes au point de rendez-vous ?",
      "Avez-vous essayé d'appeler le client ?",
      "Le client a-t-il confirmé qu'il était en route ?"
    ],
    2: [ // Adresse incorrecte
      "L'adresse est-elle complètement incorrecte ou imprécise ?",
      "Avez-vous essayé de localiser le client par téléphone ?",
      "Le client peut-il vous donner une adresse alternative ?"
    ],
    3: [ // Client annule
      "Le client a-t-il explicitement demandé l'annulation ?",
      "Avez-vous déjà commencé le trajet vers le client ?",
      "Le client a-t-il donné une raison pour l'annulation ?"
    ],
    4: [ // Problème de paiement
      "Le client conteste-t-il le tarif affiché ?",
      "Y a-t-il un problème avec le mode de paiement ?",
      "Le client refuse-t-il de payer ?"
    ],
    5: [ // Problème technique
      "L'application ne fonctionne-t-elle pas correctement ?",
      "Le GPS ne fonctionne-t-il pas ?",
      "Avez-vous des problèmes de connexion internet ?"
    ],
    6: [ // Autre problème
      "Pouvez-vous décrire brièvement le problème ?",
      "Ce problème affecte-t-il votre capacité à effectuer la course ?",
      "Avez-vous besoin d'une assistance immédiate ?"
    ]
  };

  // Additional "Autre" option for custom problems
  const autreQuestions = [
    "Pouvez-vous décrire le problème en détail ?",
    "Ce problème affecte-t-il votre sécurité ou celle du client ?",
    "Avez-vous besoin d'une assistance urgente ?"
  ];

  // Common problems list
  const commonProblems = [
    {
      id: 1,
      title: "Client non présent au point de rendez-vous",
      description: "Le client n'est pas arrivé au point de prise en charge"
    },
    {
      id: 2,
      title: "Adresse incorrecte",
      description: "L'adresse fournie est incorrecte ou imprécise"
    },
    {
      id: 3,
      title: "Client annule la course",
      description: "Le client a annulé la course"
    },
    {
      id: 4,
      title: "Problème de paiement",
      description: "Problème avec le paiement de la course"
    },
    {
      id: 5,
      title: "Problème technique",
      description: "Problème avec l'application ou le GPS"
    },
    {
      id: 6,
      title: "Autre problème",
      description: "Autre problème non listé ci-dessus"
    }
  ];

  // Helper function to sync legacy state with current step
  const syncLegacyState = () => {
    if (currentStep >= 2) {
      setHasArrivedAtPickup(true);
    }
    if (currentStep >= 3) {
      setHasPickedUpCustomer(true);
    }
    if (currentStep >= 4) {
      setHasDroppedOffCustomer(true);
    }
  };

  // Save current step to AsyncStorage
  const saveCurrentStep = async (step) => {
    try {
      const rideState = {
        currentStep: step,
        rideId: currentRideId,
        customerInfo: customerInfo,
        pickupLocation: pickupLocation,
        dropOffLocation: dropOffLocation,
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng,
        pickupAddress,
        destinationAddress,
        driverLat,
        driverLng,
        ridePrice: customerInfo.price,
        firstName: customerInfo.firstName,
        number: customerInfo.number,
        photo: customerInfo.photo,
        hasArrivedAtPickup,
        hasPickedUpCustomer,
        hasDroppedOffCustomer,
        timestamp: new Date().toISOString()
      };
      await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
      console.log('💾 Saved current step:', step, 'with complete state');
    } catch (error) {
      console.error('❌ Error saving current step:', error);
    }
  };

  // Restore state from AsyncStorage on mount - SINGLE SOURCE OF TRUTH
  useEffect(() => {
    const restoreState = async () => {
      setIsLoadingState(true);
      try {
        const storedRide = await AsyncStorage.getItem('currentRide');
        if (storedRide) {
          const rideState = JSON.parse(storedRide);
          console.log('🔍 Restoring state from AsyncStorage:', rideState);
          
          // Restore currentStep first - this is the most important
          if (rideState.currentStep) {
            console.log('🔄 About to restore currentStep from:', currentStep, 'to:', rideState.currentStep);
            setCurrentStep(rideState.currentStep);
            console.log('✅ Restored currentStep:', rideState.currentStep);
          } else {
            console.log('⚠️ No currentStep found in stored state, keeping default:', currentStep);
          }
          
          // Restore customer info
          if (rideState.customerInfo) {
            setCustomerInfo(rideState.customerInfo);
          }
          
          // Restore legacy state variables
          if (rideState.hasArrivedAtPickup !== undefined) {
            setHasArrivedAtPickup(!!rideState.hasArrivedAtPickup);
          }
          if (rideState.hasPickedUpCustomer !== undefined) {
            setHasPickedUpCustomer(!!rideState.hasPickedUpCustomer);
          }
          if (rideState.hasDroppedOffCustomer !== undefined) {
            setHasDroppedOffCustomer(!!rideState.hasDroppedOffCustomer);
          }
          
          // Restore ride ID
          if (rideState.rideId) {
            setCurrentRideId(rideState.rideId);
          }
          
          console.log('✅ State restoration completed successfully');
        } else {
          console.log('❌ No stored ride found in AsyncStorage');
        }
      } catch (error) {
        console.error('❌ Error restoring state:', error);
      } finally {
        setIsLoadingState(false);
      }
    };
    restoreState();
  }, []);

  // Sync legacy state whenever currentStep changes
  useEffect(() => {
    syncLegacyState();
  }, [currentStep]);

  // Save step whenever it changes
  useEffect(() => {
    if (!isLoadingState) {
      saveCurrentStep(currentStep);
    }
  }, [currentStep, isLoadingState]);

  // Handle ride completion (step 4)
  useEffect(() => {
    if (currentStep === 4) {
      console.log("🎉 Ride completed! Clearing state and navigating...");
      // Clear ride state and navigate back to home screen
      clearRideState();
      AsyncStorage.removeItem('currentRide');
      navigation.navigate("HomeScreenWithMap", { rideCompleted: true });
    }
  }, [currentStep]);

  // Monitor currentStep changes for debugging
  useEffect(() => {
    console.log('🔄 currentStep changed to:', currentStep);
  }, [currentStep]);

  // Function to advance to next step
  const advanceToNextStep = async () => {
    const nextStep = currentStep + 1;
    console.log(`🔄 Advancing from step ${currentStep} to step ${nextStep}`);
    setCurrentStep(nextStep);
    await saveCurrentStep(nextStep);
    
    // Haptic feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    console.log(`✅ Successfully advanced to step ${nextStep}`);
  };

  // Function to check if step is completed
  const isStepCompleted = (step) => {
    return currentStep > step;
  };

  // Function to check if step is current
  const isCurrentStep = (step) => {
    return currentStep === step;
  };

  // Function to check if step is accessible
  const isStepAccessible = (step) => {
    return currentStep >= step;
  };

  // Add listener for ride status changes
  useEffect(() => {
    if (!currentRideId) return;

    const rideRequestRef = doc(db, "rideRequests", currentRideId);
    const unsubscribe = onSnapshot(rideRequestRef, (doc) => {
      if (doc.exists()) {
        const rideData = doc.data();
        if (rideData.status === "declined") {
          // Clear ride state and navigate back to home screen
          clearRideState();
          navigation.navigate("HomeScreenWithMap");
        } else if (rideData.status === "completed") {
          // Ride is completed, navigate away
          console.log("Ride completed in Firebase, navigating to HomeScreenWithMap");
          AsyncStorage.removeItem('currentRide');
          navigation.navigate("HomeScreenWithMap", { rideCompleted: true });
        }
      }
    });

    return () => unsubscribe();
  }, [currentRideId]);

  // Store ride state in AsyncStorage when component mounts
  useEffect(() => {
    const storeRideState = async () => {
      try {
        console.log('💾 Storing ride state with customer info:', {
          firstName: customerInfo.firstName,
          number: customerInfo.number,
          photo: customerInfo.photo,
          ridePrice: customerInfo.price
        });
        
        const rideState = {
          pickupLat,
          pickupLng,
          destinationLat,
          destinationLng,
          pickupAddress,
          destinationAddress,
          driverLat,
          driverLng,
          ridePrice: customerInfo.price,
          firstName: customerInfo.firstName,
          number: customerInfo.number,
          photo: customerInfo.photo,
          hasArrivedAtPickup,
          hasPickedUpCustomer,
          hasDroppedOffCustomer,
          rideId: currentRideId,
        };
        
        console.log('💾 Full ride state to save:', rideState);
        await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
        console.log('✅ Successfully stored ride state');
      } catch (error) {
        console.error('❌ Error storing ride state:', error);
      }
    };

    if (route.params && currentRideId) {
      storeRideState();
    }
  }, [pickupLat, pickupLng, destinationLat, destinationLng, pickupAddress, destinationAddress, 
      driverLat, driverLng, customerInfo, hasArrivedAtPickup, hasPickedUpCustomer, hasDroppedOffCustomer, currentRideId]);

  // Log state changes for debugging
  useEffect(() => {
    console.log("🔄 State updated:", {
      hasArrivedAtPickup,
      hasPickedUpCustomer,
      hasDroppedOffCustomer,
      currentRideId,
      customerInfo
    });
  }, [hasArrivedAtPickup, hasPickedUpCustomer, hasDroppedOffCustomer, currentRideId, customerInfo]);

  // Track component mount/unmount
  useEffect(() => {
    console.log("🚀 RideInProgressScreen mounted");
    return () => {
      console.log("🛑 RideInProgressScreen unmounted");
    };
  }, []);

  // Function to manually clear AsyncStorage (for testing)
  const clearAsyncStorage = async () => {
    try {
      await AsyncStorage.removeItem('currentRide');
      console.log("🧹 AsyncStorage cleared manually");
    } catch (error) {
      console.error("❌ Error clearing AsyncStorage:", error);
    }
  };

  // Function to save current state to AsyncStorage
  const saveCurrentStateToStorage = async () => {
    try {
      const rideState = {
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng,
        pickupAddress,
        destinationAddress,
        driverLat,
        driverLng,
        ridePrice: customerInfo.price,
        firstName: customerInfo.firstName,
        number: customerInfo.number,
        photo: customerInfo.photo,
        hasArrivedAtPickup,
        hasPickedUpCustomer,
        hasDroppedOffCustomer,
        rideId: currentRideId,
      };
      
      console.log("💾 Auto-saving current state:", rideState);
      await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
      console.log("✅ Current state auto-saved");
    } catch (error) {
      console.error("❌ Error auto-saving state:", error);
    }
  };

  // Auto-save state whenever ride progress changes
  useEffect(() => {
    if (currentRideId && !isLoadingState) {
      saveCurrentStateToStorage();
    }
  }, [hasArrivedAtPickup, hasPickedUpCustomer, hasDroppedOffCustomer, currentRideId]);

  // Update ride status in Firebase when component mounts
  useEffect(() => {
    const updateRideStatus = async () => {
      try {
        const rideIdToUse = rideId || currentRideId;
        
        if (rideIdToUse) {
          console.log("Updating ride status to active for ride:", rideIdToUse);
          const rideRequestRef = doc(db, "rideRequests", rideIdToUse);
          await updateDoc(rideRequestRef, {
            status: "active",
            updatedAt: serverTimestamp()
          });

          // Fetch customer information from rideRequestsDriver
          const rideRequestDriverRef = doc(db, "rideRequestsDriver", rideIdToUse);
          const rideRequestDriverDoc = await getDoc(rideRequestDriverRef);
          
          if (rideRequestDriverDoc.exists()) {
            const rideData = rideRequestDriverDoc.data();
            setCustomerInfo({
              firstName: rideData.firstName || "",
              number: rideData.number || "",
              photo: rideData.photo || "",
              price: rideData.fare || 0
            });
          }
        } else {
          console.warn("No rideId available to update status");
        }
      } catch (error) {
        console.error("Error updating ride status:", error);
      }
    };

    updateRideStatus();
  }, [rideId, currentRideId]);

  // Check for existing ride state on mount - IMMEDIATE RESTORATION
  useEffect(() => {
    const restoreStateImmediately = async () => {
      try {
        console.log('🚀 IMMEDIATE STATE RESTORATION STARTING...');
        setIsLoadingState(true);
        
        const storedRide = await AsyncStorage.getItem('currentRide');
        console.log('🔍 Raw stored ride data:', storedRide);
        
        if (storedRide) {
          const rideState = JSON.parse(storedRide);
          console.log('📦 Parsed stored ride state:', rideState);
          
          // Check if ride is completed - if so, navigate away immediately
          const hasDroppedOff = Boolean(rideState.hasDroppedOffCustomer);
          if (hasDroppedOff) {
            console.log('✅ Ride already completed, navigating to HomeScreenWithMap');
            await AsyncStorage.removeItem('currentRide'); // Clean up any remaining data
            navigation.navigate("HomeScreenWithMap", { rideCompleted: true });
            return;
          }
          
          // IMMEDIATELY restore all states
          const hasArrived = Boolean(rideState.hasArrivedAtPickup);
          const hasPickedUp = Boolean(rideState.hasPickedUpCustomer);
          
          console.log('🔄 IMMEDIATELY restoring ride progress:', {
            hasArrived,
            hasPickedUp,
            hasDroppedOff,
            rideId: rideState.rideId
          });
          
          // Set all states IMMEDIATELY
          setHasArrivedAtPickup(hasArrived);
          setHasPickedUpCustomer(hasPickedUp);
          setHasDroppedOffCustomer(hasDroppedOff);
          setCurrentRideId(rideState.rideId);
          
          // Set customer info from stored state
          if (rideState.firstName) {
            setCustomerInfo({
              firstName: rideState.firstName || "",
              number: rideState.number || "",
              photo: rideState.photo || "",
              price: rideState.ridePrice || 0
            });
          }
          
          console.log('✅ IMMEDIATE state restoration completed');
        } else {
          console.log('❌ No stored ride found in AsyncStorage');
        }
      } catch (error) {
        console.error('❌ Error in immediate state restoration:', error);
      } finally {
        setIsLoadingState(false);
      }
    };

    // Call immediately on mount
    restoreStateImmediately();
  }, []); // Empty dependency array - only run once on mount

  // Sync state when route params change
  useEffect(() => {
    console.log('🔄 Route params changed:', route.params);
    
    if (route.params) {
      // If we have route params, make sure we also check AsyncStorage for the latest state
      const syncState = async () => {
        try {
          const storedRide = await AsyncStorage.getItem('currentRide');
          console.log('🔄 Syncing state with stored ride:', storedRide);
          
          if (storedRide) {
            const rideState = JSON.parse(storedRide);
            console.log('🔄 Found stored state for sync:', rideState);
            
            // Only update the ride progress states, keep route params for other data
            const hasArrived = rideState.hasArrivedAtPickup || false;
            const hasPickedUp = rideState.hasPickedUpCustomer || false;
            const hasDroppedOff = rideState.hasDroppedOffCustomer || false;
            
            console.log('🔄 Syncing ride progress:', {
              hasArrived,
              hasPickedUp,
              hasDroppedOff
            });
            
            // Only update if the stored state is different from current state
            if (hasArrived !== hasArrivedAtPickup) {
              console.log('🔄 Updating hasArrivedAtPickup from', hasArrivedAtPickup, 'to', hasArrived);
              setHasArrivedAtPickup(hasArrived);
            }
            
            if (hasPickedUp !== hasPickedUpCustomer) {
              console.log('🔄 Updating hasPickedUpCustomer from', hasPickedUpCustomer, 'to', hasPickedUp);
              setHasPickedUpCustomer(hasPickedUp);
            }
            
            if (hasDroppedOff !== hasDroppedOffCustomer) {
              console.log('🔄 Updating hasDroppedOffCustomer from', hasDroppedOffCustomer, 'to', hasDroppedOff);
              setHasDroppedOffCustomer(hasDroppedOff);
            }
            
            if (rideState.rideId !== currentRideId) {
              console.log('🔄 Updating currentRideId from', currentRideId, 'to', rideState.rideId);
              setCurrentRideId(rideState.rideId);
            }
          }
        } catch (error) {
          console.error('❌ Error syncing state:', error);
        }
      };
      syncState();
    }
  }, [route.params]);

  // Clear ride state and update Firebase when ride is completed
  const clearRideState = async () => {
    try {
      const rideIdToUse = rideId || currentRideId;
      
      if (rideIdToUse) {
        console.log("Completing ride:", rideIdToUse);
        const rideRequestRef = doc(db, "rideRequests", rideIdToUse);
        await updateDoc(rideRequestRef, {
          status: "completed",
          updatedAt: serverTimestamp(),
          completedAt: serverTimestamp()
        });

        // Update driver's status to be available for new rides
        if (auth.currentUser) {
          const driverRef = doc(db, "Drivers", auth.currentUser.uid);
          await updateDoc(driverRef, {
            isAvailable: true, // Set to true to allow new ride assignment
            isOnline: true,    // Set to true to keep driver online
            rideInProgress: false,
            currentRideId: null,
            lastRideCompletedAt: serverTimestamp()
          });
        }
      } else {
        console.warn("No rideId available to complete ride");
      }
      
      await AsyncStorage.removeItem('currentRide');
    } catch (error) {
      console.error('Error completing ride:', error);
    }
  };

  // Function to open Google Maps for navigation
  const openGoogleMapsDirections = (lat, lng) => {
    console.log('Opening navigation to:', { lat, lng });
    if (!lat || !lng) {
      console.error('Invalid coordinates:', { lat, lng });
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    console.log('Navigation URL:', url);
    Linking.openURL(url)
      .then(() => {
        // Reset isNavigating after a short delay to ensure the navigation has started
        setTimeout(() => {
          setIsNavigating(false);
        }, 1000);
      })
      .catch(error => {
        console.error('Error opening navigation:', error);
        setIsNavigating(false);
      });
    setIsNavigating(true);
  };

  // Function to handle phone calls
  const handlePhoneCall = () => {
    if (customerInfo.number) {
      const formattedPhone = customerInfo.number.replace(/\D/g, '');
      console.log('Calling phone number:', formattedPhone);
      Linking.openURL(`tel:${formattedPhone}`).catch(err => {
        console.error('Error opening phone dialer:', err);
      });
    }
  };

  // Function to message the customer
  const messageCustomer = async () => {
    try {
      const currentUser = auth.currentUser;
      
      if (!currentUser) {
        console.error('No authenticated user found');
        return;
      }
      
      // Get the customer ID from route params
      let customerId = route.params?.customerId;
      
      // If customerId is not in route params, try to get it from the rideId
      if (!customerId && route.params?.rideId) {
        try {
          console.log('No customerId in route params, fetching from rideId:', route.params.rideId);
          const rideRequestRef = doc(db, "rideRequests", route.params.rideId);
          const rideRequestDoc = await getDoc(rideRequestRef);
          
          if (rideRequestDoc.exists()) {
            const rideData = rideRequestDoc.data();
            customerId = rideData.userId || rideData.customerId;
            console.log('Found customerId from ride request:', customerId);
          }
        } catch (error) {
          console.error('Error fetching customer ID from ride request:', error);
        }
      }
      
      if (!customerId) {
        console.error('No customer ID found in route params or ride request');
        // Fallback to SMS if customerId is not available
        if (customerInfo.number) {
          const formattedPhone = customerInfo.number.replace(/\D/g, '');
          Linking.openURL(`sms:${formattedPhone}`).catch(err => {
            console.error('Error opening messaging app:', err);
          });
        }
        return;
      }
      
      console.log('Creating conversation between driver:', currentUser.uid, 'and customer:', customerId);
      
      // Create a conversation with the customer
      const conversationId = await createConversation(currentUser.uid, customerId);
      
      console.log('Conversation created with ID:', conversationId);
      
      // Navigate to the inbox screen with the conversation ID
      navigation.navigate('DriverInboxScreen', { 
        conversationId,
        customerName: `${customerInfo.firstName} ${route.params?.lastName || ''}`,
        customerPhoto: customerInfo.photo
      });
    } catch (error) {
      console.error('Error creating conversation:', error);
      // Fallback to SMS if in-app messaging fails
      if (customerInfo.number) {
        const formattedPhone = customerInfo.number.replace(/\D/g, '');
        Linking.openURL(`sms:${formattedPhone}`).catch(err => {
          console.error('Error opening messaging app:', err);
        });
      }
    }
  };

  // Automatically adjust the camera to fit all points with improved padding
  useEffect(() => {
    if (mapRef.current && driverLocation) {
      setTimeout(() => {
        fitMapToRoute();
      }, 500);
    }
  }, []);

  // Function to fit map to show the entire route with more zoom out
  const fitMapToRoute = () => {
    if (mapRef.current && driverLocation) {
      const locations = [];
      
      // Always include driver location
      locations.push(driverLocation);
      
      // Add relevant destination based on ride state
      if (!hasPickedUpCustomer && pickupLocation) {
        locations.push(pickupLocation);
      } else if (hasPickedUpCustomer && dropOffLocation) {
        locations.push(dropOffLocation);
      }

      // Add extra padding for better visibility
      const padding = {
        top: 200,
        right: 100,
        bottom: 500,
        left: 100
      };

      mapRef.current.fitToCoordinates(locations, {
        edgePadding: padding,
        animated: true,
      });
    }
  };

  // Handler for directions ready
  const handleDirectionsReady = (result) => {
    if (result && typeof result.distance === 'number' && typeof result.duration === 'number') {
      setDistance(result.distance);
      setDuration(result.duration);
    }
    
    fitMapToRoute();
  };

  // Function to get formatted arrival time
  const getFormattedArrivalTime = (extraMinutes) => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + extraMinutes);
    let hours = now.getHours();
    const minutes = now.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    const paddedMinutes = minutes < 10 ? "0" + minutes : minutes;
    return `${hours}:${paddedMinutes} ${ampm}`;
  };

  // Functions to handle long press for pickup button
  const startLongPress = (callback) => {
    setPressing(true);
    
    // Initial haptic feedback
    try {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.log('Haptics not supported on this device');
    }
    
    // Start pulsing animation (native driver)
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnimation, {
          toValue: 1.05,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();
    
    // Start ripple animation (JS driver for opacity)
    Animated.timing(rippleAnimation, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();
    
    // Scale animations (native driver)
    Animated.timing(buttonScale, {
      toValue: 0.95,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    // Glow animation (JS driver for shadow)
    Animated.timing(buttonGlow, {
      toValue: 1,
      duration: 300,
      useNativeDriver: false,
    }).start();
    
    // Progress animation (JS driver)
    Animated.timing(progress, {
      toValue: 1,
      duration: 2000,
      useNativeDriver: false,
    }).start();
    
    longPressTimer.current = setTimeout(() => {
      // Stop pulsing
      pulseAnim.stop();
      
      // Haptic feedback
      try {
        if (Platform.OS === 'ios') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      } catch (error) {
        console.log('Haptics not supported on this device');
      }
      
      // Success animation (native driver for transform, JS driver for opacity)
      Animated.parallel([
        Animated.timing(successAnimation, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false, // Use JS driver for opacity
        }),
        Animated.timing(successScaleAnimation, {
          toValue: 1.1,
          duration: 200,
          useNativeDriver: true, // Use native driver for transform
        }),
      ]).start();
      
      // Reset success animation
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(successAnimation, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
          }),
          Animated.timing(successScaleAnimation, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 200);
      
      // Execute callback after success animation
      setTimeout(() => {
        callback();
        resetPress();
      }, 500);
    }, 2000);
  };

  const cancelLongPress = () => {
    if (progressAnimation.current) {
      progressAnimation.current.stop();
    }
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
    resetPress();
  };

  const resetPress = () => {
    progress.setValue(0);
    setPressing(false);
    
    // Reset animations with consistent native driver settings
    Animated.timing(buttonScale, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    Animated.timing(buttonGlow, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
    
    Animated.timing(pulseAnimation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    Animated.timing(rippleAnimation, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
    
    Animated.timing(successScaleAnimation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    Animated.timing(successAnimation, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  // Recenter map to show full route
  const recenterMap = () => {
    // Add a small delay to ensure smooth recentering
    setTimeout(() => {
      fitMapToRoute();
    }, 100);
  };

  // Handle arrival at pickup location
  const handleArrivedAtPickup = async () => {
    try {
      console.log("✅ Arrived at pickup location - updating state");
      
      // Update local state first
      setHasArrivedAtPickup(true);
      
      // Update ride status in Firebase
      if (currentRideId) {
        const rideRef = doc(db, "rideRequests", currentRideId);
        await updateDoc(rideRef, {
          status: "driver_arrived",
          driverArrivedAt: serverTimestamp(),
          state: "Arrivé", // <-- Add this line
        });
        console.log("✅ Ride status updated to driver_arrived in Firebase");
      }
      
      // Advance to next step
      await advanceToNextStep();
      
      // Update local storage immediately
      const rideState = {
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng,
        pickupAddress,
        destinationAddress,
        driverLat,
        driverLng,
        ridePrice: customerInfo.price,
        firstName: customerInfo.firstName,
        number: customerInfo.number,
        photo: customerInfo.photo,
        hasArrivedAtPickup: true,
        hasPickedUpCustomer,
        hasDroppedOffCustomer,
        rideId: currentRideId,
      };
      
      console.log("💾 Saving ride state to AsyncStorage:", rideState);
      await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
      console.log("✅ Ride state saved to AsyncStorage");
      
      await updateProgress({ hasArrivedAtPickup: true, hasPickedUpCustomer, hasDroppedOffCustomer });
    } catch (error) {
      console.error("❌ Error updating arrival status:", error);
    }
  };

  // Handle customer pickup
  const handleCustomerPickup = async () => {
    try {
      console.log("✅ Customer pickup confirmed - updating state");
      
      // Update local state first
      setHasPickedUpCustomer(true);
      
      // Update ride status in Firebase
      if (currentRideId) {
        const rideRef = doc(db, "rideRequests", currentRideId);
        await updateDoc(rideRef, {
          status: "picked_up",
          pickedUpAt: serverTimestamp(),
          state: "En Charge", // <-- Add this line
        });
        console.log("✅ Ride status updated to picked_up in Firebase");
      }
      
      // Advance to next step
      await advanceToNextStep();
      
      // Update local storage immediately
      const rideState = {
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng,
        pickupAddress,
        destinationAddress,
        driverLat,
        driverLng,
        ridePrice: customerInfo.price,
        firstName: customerInfo.firstName,
        number: customerInfo.number,
        photo: customerInfo.photo,
        hasArrivedAtPickup,
        hasPickedUpCustomer: true,
        hasDroppedOffCustomer,
        rideId: currentRideId,
      };
      
      console.log("💾 Saving ride state to AsyncStorage:", rideState);
      await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
      console.log("✅ Ride state saved to AsyncStorage");
      
      await updateProgress({ hasArrivedAtPickup, hasPickedUpCustomer: true, hasDroppedOffCustomer });
    } catch (error) {
      console.error("❌ Error updating pickup status:", error);
    }
  };

  // Handle customer drop off
  const handleCustomerDropOff = async () => {
    try {
      console.log("Customer drop off confirmed");
      setHasDroppedOffCustomer(true);
      
      // Update ride status in Firebase
      if (currentRideId) {
        const rideRef = doc(db, "rideRequests", currentRideId);
        await updateDoc(rideRef, {
          status: "completed",
          completedAt: serverTimestamp(),
          state: "déposé", // <-- Add this line
        });
        console.log("Ride status updated to completed");
      }
      
      // Advance to next step (step 4 - completed)
      await advanceToNextStep();
      
      await updateProgress({ hasArrivedAtPickup, hasPickedUpCustomer, hasDroppedOffCustomer: true });
    } catch (error) {
      console.error("Error updating drop off status:", error);
      // Even if there's an error, try to navigate away
      await AsyncStorage.removeItem('currentRide');
      navigation.navigate("HomeScreenWithMap", { rideCompleted: true });
    }
  };

  // Problem handling functions
  const handleProblemButton = () => {
    setShowProblemModal(true);
    setProblemModalStep(1);
    setSelectedProblem(null);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setCustomAnswers({});
  };

  const handleProblemSelection = (problem) => {
    setSelectedProblem(problem);
    setProblemModalStep(2);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setCustomAnswers({});
  };

  const handleAnswerQuestion = (answer) => {
    const newAnswers = { ...answers };
    newAnswers[currentQuestionIndex] = answer;
    setAnswers(newAnswers);

    if (currentQuestionIndex < 2) {
      // Move to next question
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      // All questions answered, move to support contact
      setProblemModalStep(3);
    }
  };

  const handleCustomAnswer = (answer) => {
    const newCustomAnswers = { ...customAnswers };
    newCustomAnswers[currentQuestionIndex] = answer;
    setCustomAnswers(newCustomAnswers);

    if (currentQuestionIndex < 2) {
      // Move to next question
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      // All questions answered, move to support contact
      setProblemModalStep(3);
    }
  };

  const handleContactSupport = () => {
    const supportNumber = "+25377702036";
    const problemTitle = selectedProblem?.title || "Problème non spécifié";
    const rideId = currentRideId || 'N/A';
    
    // Create detailed message with problem and answers
    let message = `Bonjour, je rencontre un problème avec ma course.\n\n`;
    message += `**Problème:** ${problemTitle}\n`;
    message += `**Course ID:** ${rideId}\n\n`;
    message += `**Réponses aux questions:**\n`;
    
    // Use appropriate questions based on problem type
    const questions = selectedProblem?.id === 6 ? autreQuestions : (problemQuestions[selectedProblem?.id] || []);
    const needsCustomAnswers = customAnswerQuestions[selectedProblem?.id] || [false, false, false];
    
    questions.forEach((question, index) => {
      let answer;
      if (needsCustomAnswers[index]) {
        answer = customAnswers[index] || "Non spécifié";
      } else {
        answer = answers[index] === true ? "Oui" : "Non";
      }
      message += `• ${question}\n   Réponse: ${answer}\n`;
    });
    
    message += `\nMerci de votre assistance.`;
    
    // Encode message for WhatsApp URL
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${supportNumber.replace('+', '')}?text=${encodedMessage}`;
    
    Linking.openURL(whatsappUrl);
  };

  const handleCancelRide = () => {
    Alert.alert(
      "Annuler la course",
      "Êtes-vous sûr de vouloir annuler cette course ? Cette action ne peut pas être annulée.",
      [
        {
          text: "Non",
          style: "cancel"
        },
        {
          text: "Oui, annuler",
          style: "destructive",
          onPress: async () => {
            try {
              if (currentRideId) {
                const rideRef = doc(db, "rideRequests", currentRideId);
                await updateDoc(rideRef, {
                  status: "cancelled_by_driver",
                  cancelledAt: serverTimestamp(),
                  cancellationReason: selectedProblem?.title || "Problème non spécifié"
                });
              }
              await clearRideState();
              navigation.navigate("HomeScreenWithMap");
            } catch (error) {
              console.error("Error cancelling ride:", error);
              Alert.alert("Erreur", "Impossible d'annuler la course. Veuillez contacter le support.");
            }
          }
        }
      ]
    );
  };

  const closeProblemModal = () => {
    setShowProblemModal(false);
    setSelectedProblem(null);
    setProblemModalStep(1);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setCustomAnswers({});
  };

  const goBackToProblemSelection = () => {
    setProblemModalStep(1);
    setSelectedProblem(null);
    setCurrentQuestionIndex(0);
    setAnswers({});
    setCustomAnswers({});
  };

  const goBackToQuestions = () => {
    setProblemModalStep(2);
    setCurrentQuestionIndex(0);
  };

  // Restore progress from AsyncStorage on mount
  useEffect(() => {
    const restoreProgress = async () => {
      setIsLoadingState(true);
      try {
        const storedRide = await AsyncStorage.getItem('currentRide');
        if (storedRide) {
          const rideState = JSON.parse(storedRide);
          setHasArrivedAtPickup(!!rideState.hasArrivedAtPickup);
          setHasPickedUpCustomer(!!rideState.hasPickedUpCustomer);
          setHasDroppedOffCustomer(!!rideState.hasDroppedOffCustomer);
          // Optionally restore other info (customer, etc.)
        }
      } catch (e) {
        console.error('Error restoring progress from AsyncStorage', e);
      }
      setIsLoadingState(false);
    };
    restoreProgress();
  }, []);

  // Helper to update progress and AsyncStorage
  const updateProgress = async (progress) => {
    setHasArrivedAtPickup(progress.hasArrivedAtPickup);
    setHasPickedUpCustomer(progress.hasPickedUpCustomer);
    setHasDroppedOffCustomer(progress.hasDroppedOffCustomer);
    try {
      const storedRide = await AsyncStorage.getItem('currentRide');
      let rideState = storedRide ? JSON.parse(storedRide) : {};
      rideState = { ...rideState, ...progress };
      await AsyncStorage.setItem('currentRide', JSON.stringify(rideState));
    } catch (e) {
      console.error('Error updating progress in AsyncStorage', e);
    }
  };

  // Loading state
  if (!pickupLocation || !driverLocation || isLoadingState) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF6F00" />
        <Text style={{ color: "#fff", marginTop: 10 }}>
          {isLoadingState ? "Chargement de l'état..." : "Chargement..."}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }}
        showsUserLocation
        showsMyLocationButton
      >
        {/* Route: Driver → Pickup */}
        {currentStep === 1 && (
          <MapViewDirections
            origin={driverLocation}
            destination={pickupLocation}
            apikey={GOOGLE_MAPS_APIKEY}
            strokeWidth={4}
            strokeColor="#FF6F00"
            onReady={handleDirectionsReady}
          />
        )}

        {/* Route: Pickup → Drop-off */}
        {dropOffLocation && currentStep >= 2 && (
          <MapViewDirections
            origin={currentStep === 2 ? pickupLocation : driverLocation}
            destination={dropOffLocation}
            apikey={GOOGLE_MAPS_APIKEY}
            strokeWidth={4}
            strokeColor="#FF6F00"
            onReady={handleDirectionsReady}
          />
        )}

        {/* Pickup Marker - Only show if not picked up yet */}
        {currentStep <= 2 && (
          <Marker coordinate={pickupLocation}>
            <View style={styles.markerContainer}>
              <Image source={CustomPin} style={styles.pin} resizeMode="contain" />
              <Text style={[styles.markerLabel, Platform.OS === 'android' && styles.pickupLabel]} numberOfLines={2} ellipsizeMode="tail">
                {Platform.OS === 'android' ? 'PICKUP: ' : ''}{pickupAddress || "Point de départ"}
              </Text>
            </View>
          </Marker>
        )}

        {/* Drop-off Marker */}
        {dropOffLocation && currentStep >= 2 && (
          <Marker coordinate={dropOffLocation}>
            <View style={styles.markerContainer}>
              <Image source={CustomPin} style={styles.pin} resizeMode="contain" />
              <Text style={[styles.markerLabel, Platform.OS === 'android' && styles.dropoffLabel]} numberOfLines={2} ellipsizeMode="tail">
                {Platform.OS === 'android' ? 'DROPOFF: ' : ''}{destinationAddress || "Destination"}
              </Text>
            </View>
          </Marker>
        )}

        {/* Driver Marker */}
        <Marker coordinate={driverLocation} title="Driver">
          <View style={styles.driverMarkerContainer}>
            <Ionicons name="car" size={24} color="#FF6F00" />
          </View>
        </Marker>
      </MapView>

      {/* Recenter Button */}
      <View style={styles.recenterButtonContainer}>
        <TouchableOpacity onPress={recenterMap}>
          <Ionicons name="locate" size={28} color="#FF6F00" />
        </TouchableOpacity>
      </View>

      {/* Customer Info Banner */}
      <View style={styles.newCustomerBanner}>
        <View style={styles.newBannerHeader}>
          <View style={styles.newAvatarContainer}>
            {customerInfo.photo ? (
              <Image 
                source={{ uri: customerInfo.photo }} 
                style={styles.newAvatarImage} 
                resizeMode="cover"
              />
            ) : (
              <Ionicons name="person" size={24} color="#fff" />
            )}
          </View>
          <View style={styles.newCustomerInfo}>
            <Text style={styles.newCustomerFirstName}>
              {customerInfo.firstName || "Client"}
            </Text>
            <Text style={styles.newCustomerPhone}>
              {customerInfo.number || "Téléphone non disponible"}
            </Text>
            <Text style={styles.newRidePrice}>
              {customerInfo.price ? `${customerInfo.price.toFixed(2)} Fdj` : "Prix non disponible"}
            </Text>
          </View>
        </View>
        
        <View style={styles.newActionButtons}>
          <TouchableOpacity 
            style={styles.newActionButton} 
            onPress={handlePhoneCall}
            activeOpacity={0.7}
          >
            <Ionicons name="call" size={24} color="#fff" />
            <Text style={styles.newButtonText}>Appeler</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.newActionButton} 
            onPress={messageCustomer}
            activeOpacity={0.7}
          >
            <Ionicons name="chatbubble" size={24} color="#fff" />
            <Text style={styles.newButtonText}>Message</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Step Indicator */}
      <View style={styles.stepIndicatorContainer}>
        <View style={styles.stepIndicator}>
          <View style={styles.stepRow}>
            <View style={[styles.stepCircle, currentStep >= 1 && styles.stepCompleted]}>
              {currentStep > 1 ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text style={styles.stepNumber}>1</Text>
              )}
            </View>
            <Text style={[styles.stepText, currentStep >= 1 && styles.stepTextCompleted]}>
              Arrivé au point de rendez-vous
            </Text>
          </View>
          
          <View style={[styles.stepLine, currentStep >= 2 && styles.stepLineCompleted]} />
          
          <View style={styles.stepRow}>
            <View style={[styles.stepCircle, currentStep >= 2 && styles.stepCompleted]}>
              {currentStep > 2 ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text style={styles.stepNumber}>2</Text>
              )}
            </View>
            <Text style={[styles.stepText, currentStep >= 2 && styles.stepTextCompleted]}>
              Client pris en charge
            </Text>
          </View>
          
          <View style={[styles.stepLine, currentStep >= 3 && styles.stepLineCompleted]} />
          
          <View style={styles.stepRow}>
            <View style={[styles.stepCircle, currentStep >= 3 && styles.stepCompleted]}>
              {currentStep > 3 ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text style={styles.stepNumber}>3</Text>
              )}
            </View>
            <Text style={[styles.stepText, currentStep >= 3 && styles.stepTextCompleted]}>
              Client déposé
            </Text>
          </View>
        </View>
      </View>

      {/* Ride Details */}
      <View style={styles.bottomSheet}>
        <Text style={styles.headerText}>
          {currentStep === 1 
            ? "En route vers le client" 
            : currentStep === 2
              ? "Client notifié de votre arrivée" 
              : "En route vers la destination"
          }
        </Text>

        {/* Ride Info */}
        <View style={styles.rideInfoContainer}>
          <View style={styles.rideInfoItem}>
            <Text style={styles.rideInfoLabel}>Distance</Text>
            <Text style={styles.rideInfoValue}>{distance ? distance.toFixed(1) : "0.0"} km</Text>
          </View>
          <View style={styles.rideInfoItem}>
            <Text style={styles.rideInfoLabel}>Durée</Text>
            <Text style={styles.rideInfoValue}>{duration ? Math.round(duration) : "0"} min</Text>
          </View>
          <View style={styles.rideInfoItem}>
            <Text style={styles.rideInfoLabel}>Tarif</Text>
            <Text style={styles.rideInfoValue}>
              {customerInfo.price ? `${customerInfo.price.toFixed(2)} Fdj` : "N/A"}
            </Text>
          </View>
        </View>

        {/* Current destination details */}
        <View style={styles.destinationInfo}>
          <Ionicons name="location" size={24} color="#FF6F00" />
          <View style={styles.destinationTextContainer}>
            <Text style={styles.destinationText} numberOfLines={2}>
              {currentStep === 1 
                ? pickupAddress || "Point de départ"
                : currentStep === 2
                  ? "En attente du client"
                  : destinationAddress || "Destination"
              }
            </Text>
            <Text style={styles.arrivalTime}>
              {currentStep === 1 
                ? `Arrivée vers ${getFormattedArrivalTime(duration / 2)}`
                : currentStep === 2
                  ? "Client notifié"
                  : `Arrivée vers ${getFormattedArrivalTime(duration)}`
              }
            </Text>
          </View>
        </View>

        {/* Problem Button */}
        <TouchableOpacity 
          style={styles.problemButton}
          onPress={handleProblemButton}
        >
          <Ionicons name="warning" size={20} color="#FF6F00" />
          <Text style={styles.problemButtonText}>J'ai un problème</Text>
        </TouchableOpacity>

        {/* Step-based Ride Buttons */}
        {currentStep === 1 ? (
          // Step 1: Navigate to pickup and mark arrival
          <>
            <TouchableOpacity 
              style={styles.buttonPrimary}
              onPress={() => openGoogleMapsDirections(pickupLocation.latitude, pickupLocation.longitude)}
              disabled={isNavigating}
            >
              <Text style={styles.buttonText}>Naviguer vers le client</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.buttonSecondary}
              onPressIn={() => startLongPress(handleArrivedAtPickup)}
              onPressOut={cancelLongPress}
              activeOpacity={0.9}
            >
              {/* Scale and pulse animations (native driver) */}
              <Animated.View
                style={[
                  styles.buttonContent,
                  {
                    transform: [
                      { scale: buttonScale },
                      { scale: pulseAnimation },
                      { scale: successScaleAnimation },
                    ],
                  },
                ]}
              >
                {/* Glow effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.buttonGlow,
                    {
                      shadowOpacity: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 0.8],
                      }),
                      shadowRadius: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 12],
                      }),
                      shadowColor: '#FF6F00',
                    },
                  ]}
                />
                
                {/* Ripple Effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.rippleEffect,
                    {
                      opacity: rippleAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 0],
                      }),
                      transform: [
                        { scale: rippleAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 2],
                        })},
                      ],
                    },
                  ]}
                />
                
                <Text style={styles.buttonText}>
                  {pressing ? "Maintenez pour confirmer..." : "Arrivé au point de rendez-vous"}
                </Text>
                
                {/* Success Icon (JS driver for opacity, native for transform) */}
                <Animated.View
                  style={[
                    styles.successIcon,
                    {
                      opacity: successAnimation,
                      transform: [
                        { scale: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1],
                        })},
                        { rotate: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        })},
                      ],
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                </Animated.View>
                
                <View style={styles.progressContainer}>
                  <Animated.View
                    style={[
                      styles.progressBar,
                      {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                </View>
              </Animated.View>
            </TouchableOpacity>
          </>
        ) : currentStep === 2 ? (
          // Step 2: Mark customer as picked up
          <>
            <TouchableOpacity 
              style={styles.buttonPrimary}
              onPress={() => openGoogleMapsDirections(dropOffLocation.latitude, dropOffLocation.longitude)}
              disabled={isNavigating || !dropOffLocation}
            >
              <Text style={styles.buttonText}>Naviguer vers la destination</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.buttonSecondary}
              onPressIn={() => startLongPress(handleCustomerPickup)}
              onPressOut={cancelLongPress}
              activeOpacity={0.9}
            >
              {/* Scale and pulse animations (native driver) */}
              <Animated.View
                style={[
                  styles.buttonContent,
                  {
                    transform: [
                      { scale: buttonScale },
                      { scale: pulseAnimation },
                      { scale: successScaleAnimation },
                    ],
                  },
                ]}
              >
                {/* Glow effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.buttonGlow,
                    {
                      shadowOpacity: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 0.8],
                      }),
                      shadowRadius: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 12],
                      }),
                      shadowColor: '#FF6F00',
                    },
                  ]}
                />
                
                {/* Ripple Effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.rippleEffect,
                    {
                      opacity: rippleAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 0],
                      }),
                      transform: [
                        { scale: rippleAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 2],
                        })},
                      ],
                    },
                  ]}
                />
                
                <Text style={styles.buttonText}>
                  {pressing ? "Maintenez pour confirmer..." : "Client pris en charge"}
                </Text>
                
                {/* Success Icon (JS driver for opacity, native for transform) */}
                <Animated.View
                  style={[
                    styles.successIcon,
                    {
                      opacity: successAnimation,
                      transform: [
                        { scale: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1],
                        })},
                        { rotate: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        })},
                      ],
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                </Animated.View>
                
                <View style={styles.progressContainer}>
                  <Animated.View
                    style={[
                      styles.progressBar,
                      {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                </View>
              </Animated.View>
            </TouchableOpacity>
          </>
        ) : currentStep === 3 ? (
          // Step 3: Mark customer as dropped off
          <>
            <TouchableOpacity 
              style={[
                styles.buttonPrimary,
                (!dropOffLocation || isNavigating) && styles.disabledButton
              ]}
              onPress={() => {
                if (dropOffLocation) {
                  openGoogleMapsDirections(dropOffLocation.latitude, dropOffLocation.longitude);
                }
              }}
              disabled={isNavigating || !dropOffLocation}
            >
              <Text style={styles.buttonText}>Naviguer vers la destination</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.buttonSecondary}
              onPressIn={() => startLongPress(handleCustomerDropOff)}
              onPressOut={cancelLongPress}
              activeOpacity={0.9}
            >
              {/* Scale and pulse animations (native driver) */}
              <Animated.View
                style={[
                  styles.buttonContent,
                  {
                    transform: [
                      { scale: buttonScale },
                      { scale: pulseAnimation },
                      { scale: successScaleAnimation },
                    ],
                  },
                ]}
              >
                {/* Glow effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.buttonGlow,
                    {
                      shadowOpacity: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.3, 0.8],
                      }),
                      shadowRadius: buttonGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [4, 12],
                      }),
                      shadowColor: '#FF6F00',
                    },
                  ]}
                />
                
                {/* Ripple Effect (JS driver) */}
                <Animated.View
                  style={[
                    styles.rippleEffect,
                    {
                      opacity: rippleAnimation.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 0],
                      }),
                      transform: [
                        { scale: rippleAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 2],
                        })},
                      ],
                    },
                  ]}
                />
                
                <Text style={styles.buttonText}>
                  {pressing ? "Maintenez pour confirmer..." : "Client déposé"}
                </Text>
                
                {/* Success Icon (JS driver for opacity, native for transform) */}
                <Animated.View
                  style={[
                    styles.successIcon,
                    {
                      opacity: successAnimation,
                      transform: [
                        { scale: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, 1],
                        })},
                        { rotate: successAnimation.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        })},
                      ],
                    },
                  ]}
                >
                  <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
                </Animated.View>
                
                <View style={styles.progressContainer}>
                  <Animated.View
                    style={[
                      styles.progressBar,
                      {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                </View>
              </Animated.View>
            </TouchableOpacity>
          </>
        ) : null}
      </View>

      {/* Problem Modal */}
      {showProblemModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Step 1: Problem Selection */}
            {problemModalStep === 1 && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Problème rencontré</Text>
                  <TouchableOpacity onPress={closeProblemModal} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                <Text style={styles.modalSubtitle}>
                  Sélectionnez le problème que vous rencontrez :
                </Text>

                <ScrollView style={styles.problemsList}>
                  {commonProblems.map((problem) => (
                    <TouchableOpacity
                      key={problem.id}
                      style={styles.problemItem}
                      onPress={() => handleProblemSelection(problem)}
                    >
                      <View style={styles.problemContent}>
                        <Text style={styles.problemTitle}>{problem.title}</Text>
                        <Text style={styles.problemDescription}>{problem.description}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={24} color="#FF6F00" />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Step 2: Answer Questions */}
            {problemModalStep === 2 && selectedProblem && (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={goBackToProblemSelection} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#FF6F00" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Questions</Text>
                  <TouchableOpacity onPress={closeProblemModal} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>

                <View style={styles.questionContainer}>
                  <Text style={styles.questionNumber}>
                    Question {currentQuestionIndex + 1} sur 3
                  </Text>
                  <Text style={styles.questionText}>
                    {selectedProblem?.id === 6 
                      ? autreQuestions[currentQuestionIndex]
                      : problemQuestions[selectedProblem?.id]?.[currentQuestionIndex]
                    }
                  </Text>

                  <View style={styles.answerButtons}>
                    {(() => {
                      const needsCustomAnswers = customAnswerQuestions[selectedProblem?.id] || [false, false, false];
                      const isCustomAnswer = needsCustomAnswers[currentQuestionIndex];
                      
                      if (isCustomAnswer) {
                        const customOptions = customAnswerOptions[selectedProblem?.id]?.[currentQuestionIndex] || ["Oui", "Non"];
                        return customOptions.map((option, index) => (
                          <TouchableOpacity
                            key={index}
                            style={[styles.answerButton, styles.customButton]}
                            onPress={() => handleCustomAnswer(option)}
                          >
                            <Text style={styles.customAnswerButtonText}>{option}</Text>
                          </TouchableOpacity>
                        ));
                      } else {
                        return (
                          <>
                            <TouchableOpacity
                              style={[styles.answerButton, styles.yesButton]}
                              onPress={() => handleAnswerQuestion(true)}
                            >
                              <Text style={styles.answerButtonText}>Oui</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.answerButton, styles.noButton]}
                              onPress={() => handleAnswerQuestion(false)}
                            >
                              <Text style={styles.answerButtonText}>Non</Text>
                            </TouchableOpacity>
                          </>
                        );
                      }
                    })()}
                  </View>
                </View>
              </>
            )}

            {/* Step 3: Contact Support */}
            {problemModalStep === 3 && (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={goBackToQuestions} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color="#FF6F00" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Contact Support</Text>
                  <TouchableOpacity onPress={closeProblemModal} style={styles.closeButton}>
                    <Ionicons name="close" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>

                <View style={styles.supportContainer}>
                  <Text style={styles.supportText}>
                    Nous avons enregistré votre problème. Notre équipe de support va vous contacter dans les plus brefs délais.
                  </Text>
                  
                  <View style={styles.supportButtonsContainer}>
                    <TouchableOpacity
                      style={styles.whatsappButton}
                      onPress={handleContactSupport}
                    >
                      <View style={styles.whatsappLogoContainer}>
                        <Ionicons name="logo-whatsapp" size={24} color="#fff" />
                      </View>
                      <Text style={styles.whatsappButtonText}>Contacter le support WhatsApp</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity
                      style={styles.cancelRideButton}
                      onPress={handleCancelRide}
                    >
                      <Ionicons name="close-circle" size={20} color="#FF3B30" />
                      <Text style={styles.cancelRideButtonText}>Annuler la course</Text>
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.supportInfo}>
                    <View style={styles.supportInfoHeader}>
                      <Ionicons name="information-circle" size={16} color="#FF6F00" />
                      <Text style={styles.supportInfoTitle}>Support disponible 24/7</Text>
                    </View>
                    <Text style={styles.supportInfoText}>
                      Notre équipe est disponible pour vous aider à résoudre ce problème rapidement.
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: "#121212",
  },
  loadingContainer: { 
    flex: 1, 
    alignItems: "center", 
    justifyContent: "center", 
    backgroundColor: "#121212" 
  },
  map: { 
    flex: 1 
  },
  markerContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30,30,30,0.9)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    maxWidth: 220,
    borderWidth: 1,
    borderColor: "#FF6F00",
  },
  driverMarkerContainer: {
    backgroundColor: "#1E1E1E",
    borderRadius: 50,
    padding: 8,
    borderWidth: 2,
    borderColor: "#FF6F00",
  },
  pin: {
    width: 25,
    height: 25,
    marginRight: 8,
  },
  markerLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    maxWidth: 170,
    flexShrink: 1,
  },
  bottomSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1E1E1E",
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    paddingVertical: 24,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 10,
  },
  headerText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 20,
    textAlign: "center",
  },
  rideInfoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  rideInfoItem: {
    flex: 1,
    backgroundColor: "#2C2C2C",
    borderRadius: 10,
    padding: 10,
    marginHorizontal: 5,
    alignItems: "center",
  },
  rideInfoLabel: {
    color: "#b3b3b3",
    fontSize: 14,
    marginBottom: 5,
  },
  rideInfoValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  destinationInfo: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2C",
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
  },
  destinationTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  destinationText: {
    color: "#fff",
    fontSize: 16,
  },
  arrivalTime: {
    color: "#FF6F00",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
  buttonPrimary: {
    backgroundColor: "#FF6F00",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    position: "relative",
    overflow: "hidden",
  },
  buttonSecondary: {
    backgroundColor: "#2C2C2C",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 2,
    borderColor: "#FF6F00",
    position: "relative",
    overflow: "hidden",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  progressContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#fff",
  },
  disabledButton: {
    backgroundColor: "#5F5F5F",
    opacity: 0.5,
  },
  newCustomerBanner: {
    position: "absolute",
    top: 70,
    left: '8%',
    right: '8%',
    zIndex: 200,
    backgroundColor: "rgba(30, 30, 30, 0.98)",
    borderRadius: 14,
    padding: 10,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    borderWidth: 2,
    borderColor: "#FF6F00",
    alignItems: 'center',
  },
  newBannerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  newAvatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FF6F00",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: '#fff',
  },
  newAvatarImage: {
    width: "100%",
    height: "100%",
  },
  newCustomerInfo: {
    flex: 1,
  },
  newCustomerFirstName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 2,
  },
  newCustomerPhone: {
    color: "#b3b3b3",
    fontSize: 13,
    marginBottom: 2,
  },
  newRidePrice: {
    color: "#FF6F00",
    fontSize: 15,
    fontWeight: "700",
  },
  newActionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 10,
  },
  newActionButton: {
    backgroundColor: "#FF6F00",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 25,
    minWidth: 120,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  newButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  newDisabledButton: {
    backgroundColor: "#5F5F5F",
    opacity: 0.5,
  },
  pickupLabel: {
    backgroundColor: '#4CD964',
    color: '#fff',
    fontWeight: 'bold',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    marginRight: 4,
  },
  dropoffLabel: {
    backgroundColor: '#FF3B30',
    color: '#fff',
    fontWeight: 'bold',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
    marginRight: 4,
  },
  problemButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2C",
    padding: 15,
    borderRadius: 12,
    marginTop: 10,
    borderWidth: 2,
    borderColor: "#FF6F00",
    alignSelf: "center",
    width: "100%",
    justifyContent: "center",
  },
  problemButtonText: {
    color: "#FF6F00",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContainer: {
    backgroundColor: '#1E1E1E',
    borderRadius: 20,
    width: '90%',
    maxWidth: 400,
    padding: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 15,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
  },
  backButton: {
    padding: 5,
  },
  modalSubtitle: {
    color: '#b3b3b3',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  problemsList: {
    width: '100%',
    maxHeight: 250, // Limit height for scrolling
  },
  problemItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10,
    marginBottom: 8,
    backgroundColor: '#2C2C2C',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedProblemItem: {
    borderColor: '#FF6F00',
    borderWidth: 1,
  },
  problemContent: {
    flex: 1,
    marginRight: 10,
  },
  problemTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  problemDescription: {
    color: '#b3b3b3',
    fontSize: 13,
    marginTop: 2,
  },
  questionContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  questionNumber: {
    color: '#FF6F00',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  questionText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 20,
  },
  answerButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  answerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 25,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  yesButton: {
    backgroundColor: '#FF6F00',
    borderWidth: 1,
    borderColor: '#FF6F00',
  },
  noButton: {
    backgroundColor: '#2C2C2C',
    borderWidth: 1,
    borderColor: '#FF6F00',
  },
  answerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  customButton: {
    backgroundColor: '#2C2C2C',
    borderWidth: 1,
    borderColor: '#FF6F00',
  },
  customAnswerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  supportContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  supportIconContainer: {
    marginBottom: 20,
  },
  supportTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  supportDescription: {
    color: '#b3b3b3',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 22,
  },
  supportButtonsContainer: {
    width: '100%',
    marginTop: 10,
  },
  whatsappButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 12,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  whatsappButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF6F00',
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 25,
    minWidth: 150,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  supportButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  cancelRideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 16,
    paddingHorizontal: 30,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FF3B30',
  },
  cancelRideButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  supportInfo: {
    marginTop: 25,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#333',
    width: '100%',
    alignItems: 'center',
  },
  supportInfoText: {
    color: '#b3b3b3',
    fontSize: 13,
    textAlign: 'center',
  },
  supportInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  supportInfoTitle: {
    color: '#FF6F00',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 5,
  },
  whatsappLogoContainer: {
    backgroundColor: '#25D366',
    borderRadius: 20,
    padding: 10,
    borderWidth: 1,
    borderColor: '#fff',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  successIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleEffect: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.3)',
    opacity: 0,
    transform: [{ scale: 0 }],
  },
  buttonGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    backgroundColor: 'transparent',
    zIndex: -1,
  },
  stepIndicatorContainer: {
    position: 'absolute',
    top: 70,
    left: '8%',
    right: '8%',
    zIndex: 200,
    backgroundColor: "rgba(30, 30, 30, 0.98)",
    borderRadius: 14,
    padding: 15,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    borderWidth: 2,
    borderColor: "#FF6F00",
  },
  stepIndicator: {
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#2C2C2C',
    borderWidth: 2,
    borderColor: '#FF6F00',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepCompleted: {
    backgroundColor: '#FF6F00',
  },
  stepText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  stepTextCompleted: {
    color: '#b3b3b3',
  },
  stepLine: {
    width: 2,
    height: 20,
    backgroundColor: '#FF6F00',
    marginLeft: 13,
    marginBottom: 8,
  },
  stepLineCompleted: {
    backgroundColor: '#FF6F00',
  },
  stepNumber: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});

export default RideInProgressScreen;