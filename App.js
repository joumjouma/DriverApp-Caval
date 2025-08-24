import React, { useState, useEffect } from "react";
import { Platform, StyleSheet, View, ActivityIndicator, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StripeProvider } from '@stripe/stripe-react-native';
import { auth, db } from './config/firebase';
import notificationService from './services/NotificationService';
import * as Linking from 'expo-linking';

// Import only essential screens for now
import LoginScreen from "./screens/LoginScreen";
import RegisterScreen from "./screens/RegisterScreen";
import HomeScreenWithMap from "./screens/HomeScreenWithMap";
import ProfileScreen from "./screens/ProfileScreen";
import RideInProgressScreen from "./screens/RideInProgressScreen";
import EarningsScreen from "./screens/EarningsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import PaymentScreen from "./screens/PaymentScreen";
import ModifyInfo from "./screens/ModifyInfo";
import "react-native-get-random-values";

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// Simplified HomeTabs
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

// Simplified AppContent
const AppContent = () => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#ff9f43" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (!user) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Register" component={RegisterScreen} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="MainApp" component={HomeTabs} />
      <Stack.Screen name="RideInProgressScreen" component={RideInProgressScreen} />
      <Stack.Screen name="EarningsScreen" component={EarningsScreen} />
              <Stack.Screen name="ModifyInfo" component={ModifyInfo} />
        <Stack.Screen name="PaymentScreen" component={PaymentScreen} />
        <Stack.Screen name="SettingsScreen" component={SettingsScreen} />
    </Stack.Navigator>
  );
};

export default function App() {
  const [isFirebaseInitialized, setIsFirebaseInitialized] = useState(false);
  const [initError, setInitError] = useState(null);

  useEffect(() => {
    const checkFirebaseInitialization = () => {
      try {
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
    <NavigationContainer>
      <StripeProvider publishableKey="pk_live_51R9ek8CmEzIPQVTO8V3wcapg87N24eNFOCaJ4dz2krvfKSBaNe5g0vYAW4XBHESTYpQBi6fdz7GA4fPGJh4BlGIW00L1KYPz6m">
        <AuthProvider>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </AuthProvider>
      </StripeProvider>
    </NavigationContainer>
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
