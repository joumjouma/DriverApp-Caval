import React, { useState, useEffect } from "react";
import { Platform, StyleSheet, View, ActivityIndicator, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons"; // For icons
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StripeProvider } from '@stripe/stripe-react-native';
import { auth, db } from './config/firebase';
import notificationService from './services/NotificationService';
import * as Linking from 'expo-linking';

// Import Screens
import LoginScreen from "./screens/LoginScreen";
import RegisterScreen from "./screens/RegisterScreen";
import HomeScreenWithMap from "./screens/HomeScreenWithMap";
import RideInProgressScreen from "./screens/RideInProgressScreen";
import ProfileScreen from "./screens/ProfileScreen";
import SettingsScreen from "./screens/SettingsScreen";
import RideOptionsScreen from "./screens/RideOptionsScreen";
import EarningsScreen from "./screens/EarningsScreen";
import ModifyInfo from "./screens/ModifyInfo";
import PaymentScreen from "./screens/PaymentScreen";
import DriverInboxScreen from "./screens/DriverInboxScreen";
import ApprovalStatusScreen from "./screens/ApprovalStatusScreen";
import OnlineDriverScreen from "./screens/OnlineDriverScreen";
import TestOnlineDriverScreen from "./screens/TestOnlineDriverScreen";
import "react-native-get-random-values";

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Bottom Tab Navigator (Home and Profile only)
function HomeTabs() {
  const { user } = useAuth();
  
  if (!user) {
    return null;
  }

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === "Home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "Profile") {
            iconName = focused ? "person" : "person-outline";
          }
          return <Ionicons name={iconName} size={30} color={color} />;
        },
        tabBarActiveTintColor: "#ff9f43",
        tabBarInactiveTintColor: "gray",
        tabBarStyle: {
          backgroundColor: "#1e1e1e",
          borderTopColor: "transparent",
          position: "absolute",
          bottom: 0,
          height: Platform.OS === 'android' ? 100 : 70,
          paddingBottom: Platform.OS === 'android' ? 60 : 10,
          zIndex: 10,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: {
            width: 0,
            height: -2,
          },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
        },
      })}
    >
      <Tab.Screen
        name="Home"
        options={{ headerShown: false }}
      >
        {() => <HomeScreenWithMap />}
      </Tab.Screen>
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ headerShown: false }}
      />
    </Tab.Navigator>
  );
}

// Create a wrapper component to use the auth context
const AppContent = () => {
  const { user, loading } = useAuth();
  const [notificationListeners, setNotificationListeners] = useState(null);
  const navigationRef = React.useRef();
  
  // Initialize notifications when user logs in
  useEffect(() => {
    if (user) {
      const initializeNotifications = async () => {
        try {
          // Set up navigation ref for background notifications
          global.navigationRef = navigationRef;
          
          console.log('🚀 Initializing notifications for user:', user.uid);
          
          // Set up background notification handling
          const { Notifications } = await import('expo-notifications');
          
          // Handle notifications when app is in background
          Notifications.setNotificationHandler({
            handleNotification: async (notification) => {
              console.log('📱 Background notification received:', notification);
              return {
                shouldShowAlert: true,
                shouldPlaySound: true,
                shouldSetBadge: true,
              };
            },
          });
          
          const result = await notificationService.initialize();
          if (result.success) {
            setNotificationListeners(result.listeners);
            console.log('✅ Notifications initialized successfully');
            
            // Force update push token to ensure it's saved to Firestore
            setTimeout(async () => {
              try {
                console.log('🔄 Updating push token...');
                const token = await notificationService.updatePushToken();
                if (token) {
                  console.log('✅ Push token updated and saved to Firestore:', token.substring(0, 20) + '...');
                  
                  // Verify token was saved by checking Firestore
                  try {
                    const { getDoc, doc } = await import('firebase/firestore');
                    const { db } = await import('./config/firebase');
                    const driverDoc = await getDoc(doc(db, "Drivers", user.uid));
                    if (driverDoc.exists()) {
                      const driverData = driverDoc.data();
                      if (driverData.expoPushToken) {
                        console.log('✅ Token verified in Firestore:', driverData.expoPushToken.substring(0, 20) + '...');
                      } else {
                        console.log('⚠️ Token not found in Firestore after save');
                      }
                    }
                  } catch (verifyError) {
                    console.log('⚠️ Could not verify token in Firestore:', verifyError.message);
                  }
                } else {
                  console.log('❌ Failed to get push token');
                }
              } catch (tokenError) {
                console.error('❌ Error updating push token:', tokenError);
              }
            }, 2000); // Small delay to ensure auth is fully ready
            
            // Set up periodic token refresh (every 5 minutes)
            const tokenRefreshInterval = setInterval(async () => {
              try {
                await notificationService.updatePushToken();
                console.log('🔄 Periodic push token refresh completed');
              } catch (refreshError) {
                console.log('⚠️ Periodic token refresh failed:', refreshError.message);
              }
            }, 5 * 60 * 1000); // 5 minutes
            
            // Clean up interval on unmount
            return () => clearInterval(tokenRefreshInterval);
            
          } else {
            console.log('❌ Failed to initialize notifications:', result.error);
          }
        } catch (error) {
          console.error('❌ Error initializing notifications:', error);
        }
      };

      initializeNotifications();
    } else {
      // Clean up notification listeners when user logs out
      if (notificationListeners) {
        notificationService.removeNotificationListeners(notificationListeners);
        setNotificationListeners(null);
      }
      // Clear global navigation ref
      global.navigationRef = null;
    }

    // Cleanup function
    return () => {
      if (notificationListeners) {
        notificationService.removeNotificationListeners(notificationListeners);
      }
      global.navigationRef = null;
    };
  }, [user]);
  
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ff9f43" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      linking={{
        prefixes: [Linking.createURL('/')],
        config: {
          screens: {
            LoginScreen: 'login',
            RegisterScreen: 'register',
            HomeScreenWithMap: 'home',
            RideInProgressScreen: 'ride',
            DriverInboxScreen: 'inbox',
            RideOptionsScreen: 'options',
            EarningsScreen: 'earnings',
            ModifyInfo: 'modify',
            PaymentScreen: 'payment',
            SettingsScreen: 'settings',
            Profile: 'profile',
            ApprovalStatusScreen: 'approval',
            OnlineDriverScreen: 'online',
            TestOnlineDriverScreen: 'test-online'
          }
        }
      }}
    >
      <Stack.Navigator
        initialRouteName={user ? "HomeScreenWithMap" : "LoginScreen"}
        screenOptions={{
          headerShown: false,
          gestureEnabled: false // Disable swipe back gesture
        }}
      >
        {/* Authentication Screens */}
        <Stack.Screen
          name="LoginScreen"
          component={LoginScreen}
          options={{ 
            headerShown: false,
            gestureEnabled: false
          }}
        />
        <Stack.Screen
          name="RegisterScreen"
          component={RegisterScreen}
          options={{ 
            headerShown: false,
            gestureEnabled: false
          }}
        />

        {/* Bottom Tabs (Home and Profile) */}
        {user && (
          <Stack.Screen
            name="HomeScreenWithMap"
            component={HomeTabs}
            options={{ 
              headerShown: false,
              gestureEnabled: false,
              headerLeft: () => null
            }}
          />
        )}
        
        {/* Rest of the screens */}
        <Stack.Screen
          name="RideInProgressScreen"
          component={RideInProgressScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="DriverInboxScreen"
          component={DriverInboxScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="RideOptionsScreen"
          component={RideOptionsScreen}
          options={{
            headerTitle: "Ride Options",
            headerStyle: { backgroundColor: "#ff9f43" },
            headerTintColor: "#fff",
            headerTitleAlign: "center",
          }}
        />
        <Stack.Screen
          name="EarningsScreen"
          component={EarningsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="ModifyInfo"
          component={ModifyInfo}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="PaymentScreen"
          component={PaymentScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="SettingsScreen"
          component={SettingsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="Profile" 
          component={ProfileScreen} 
        />
        <Stack.Screen
          name="ApprovalStatusScreen"
          component={ApprovalStatusScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="OnlineDriverScreen"
          component={OnlineDriverScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="TestOnlineDriverScreen"
          component={TestOnlineDriverScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default function App() {
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);
  const [initError, setInitError] = useState(null);

  useEffect(() => {
    const checkFirebaseInitialization = () => {
      try {
        // Check if auth is initialized
        if (auth) {
          setIsFirebaseInitialized(true);
        } else {
          setInitError("Firebase Auth not initialized");
        }
      } catch (error) {
        console.error("Firebase initialization check error:", error);
        setInitError(error.message);
      }
    };

    checkFirebaseInitialization();
  }, []);

  if (initError) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Error initializing Firebase: {initError}</Text>
      </View>
    );
  }

  if (!isFirebaseInitialized) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ff9f43" />
        <Text style={styles.loadingText}>Initializing Firebase...</Text>
      </View>
    );
  }

  return (
    <StripeProvider publishableKey="pk_live_51R9ek8CmEzIPQVTO8V3wcapg87N24eNFOCaJ4dz2krvfKSBaNe5g0vYAW4XBHESTYpQBi6fdz7GA4fPGJh4BlGIW00L1KYPz6m">
      <AuthProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </AuthProvider>
    </StripeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1e1e1e",
  },
  loadingText: {
    color: "#ff9f43",
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    color: "#ff4444",
    marginTop: 10,
    fontSize: 16,
    textAlign: "center",
    padding: 20,
  },
});
