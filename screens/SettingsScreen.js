import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  SafeAreaView,
  Switch,
  Image,
  Animated,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useTheme } from "../context/ThemeContext";
import { useNavigation } from "@react-navigation/native";
import { deleteUser, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc, getDoc, updateDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "../config/firebase";
import notificationService from "../services/NotificationService";
import { auth } from "../config/firebase";

function SettingsScreen() {
  const { colors, toggleTheme, isDarkMode } = useTheme();
  const navigation = useNavigation();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [userDetails, setUserDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageLoadError, setImageLoadError] = useState(false);

  // We still track these if you need them for any other purpose.
  // They are no longer displayed in a separate box.
  const [todayOnlineTime, setTodayOnlineTime] = useState("0h 0m");
  const [rating, setRating] = useState(4.0); // Changed to match new format
  const [rideCount, setRideCount] = useState(0);

  // Animation for header
  const scrollY = useRef(new Animated.Value(0)).current;
  const headerOpacity = scrollY.interpolate({
    inputRange: [0, 50],
    outputRange: [1, 0.9],
    extrapolate: "clamp",
  });

  // Animation refs for tier badge
  const tierBadgeAnim = useRef(new Animated.Value(1)).current;

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false }
  );

  // Format time in hours and minutes
  const formatTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  useEffect(() => {
    const fetchUserDetails = async () => {
      const currentUser = auth.currentUser;
      if (!currentUser) return;

      try {
        console.log("Fetching user details...");
        // First try to get from AsyncStorage
        const cachedData = await AsyncStorage.getItem('driverInfo');
        if (cachedData) {
          console.log("Found cached data in AsyncStorage");
          const parsedData = JSON.parse(cachedData);
          setUserDetails(parsedData);
          setRating(parsedData.rating || 4.0); // Get rating from stored data
          setRideCount(parsedData.rideCount || 0);
        }

        // Fetch online time (similar to ProfileScreen)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const statsDocRef = doc(db, "driverStats", currentUser.uid);
        const statsDocSnap = await getDoc(statsDocRef);

        if (statsDocSnap.exists()) {
          const stats = statsDocSnap.data();
          const todayStats = stats.dailyStats?.find(
            (stat) => stat.date.toDate().toDateString() === today.toDateString()
          );

          if (todayStats) {
            setTodayOnlineTime(formatTime(todayStats.onlineTime));
          }
        }

        // Fetch driver details from Firestore
        console.log("Fetching from Firestore...");
        const docRefDriver = doc(db, "Drivers", currentUser.uid);
        const docSnapDriver = await getDoc(docRefDriver);

        if (docSnapDriver.exists()) {
          console.log("Firestore data:", docSnapDriver.data());
          const firestoreData = docSnapDriver.data();
          setUserDetails(firestoreData);
          setRating(firestoreData.rating || 4.0); // Get rating from Firebase
          setRideCount(firestoreData.rideCount || 0);
          
          // Update AsyncStorage with latest data
          await AsyncStorage.setItem('driverInfo', JSON.stringify(firestoreData));
          console.log("Updated AsyncStorage with Firestore data");
        }
      } catch (error) {
        console.error("Error fetching user details:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserDetails();
  }, []);

  // -----------------------------------------------------------------
  // Real-time Driver Data Listener (including rating)
  // -----------------------------------------------------------------
  useEffect(() => {
    if (!auth.currentUser) return;

    const currentUser = auth.currentUser;
    console.log("Setting up real-time driver data listener for SettingsScreen:", currentUser.uid);

    const driverRef = doc(db, "Drivers", currentUser.uid);
    const unsubscribe = onSnapshot(driverRef, (doc) => {
      if (doc.exists()) {
        const userData = doc.data();
        console.log("Real-time driver data update in SettingsScreen:", userData);
        
        // Update all driver data in real-time
        setUserDetails(userData);
        setRating(userData.rating || 4.0); // Real-time rating updates
        setRideCount(userData.rideCount || 0);
        
        // Update AsyncStorage with latest data
        AsyncStorage.setItem('driverInfo', JSON.stringify(userData));
        console.log("Real-time driver data updated in SettingsScreen, including rating:", userData.rating);
      }
    }, (error) => {
      console.error("Error in real-time driver data listener in SettingsScreen:", error);
    });

    return () => {
      console.log("Cleaning up real-time driver data listener in SettingsScreen");
      unsubscribe();
    };
  }, [auth.currentUser]);

  // Reset image error state when user details change
  useEffect(() => {
    if (userDetails?.photo) {
      setImageLoadError(false);
    }
  }, [userDetails?.photo]);

  const handleReferralPress = () => {
    Linking.openURL("https://www.caval.tech/contact");
  };

  const handlePrivacyPolicyPress = () => {
    Linking.openURL("https://www.caval.tech/privacy-policy");
  };

  const handleSupportPress = () => {
    Linking.openURL("https://www.caval.tech/support");
  };

  const handleProfilePictureChange = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(
        "Erreur",
        "Vous devez être connecté pour changer votre photo de profil."
      );
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (!result.canceled) {
        setLoading(true);
        const imageUri = result.assets[0].uri;
        console.log("Selected image URI:", imageUri);
        
        // Create a reference to the storage location
        const filename = `${user.uid}_${Date.now()}.jpg`;
        const storageRef = ref(storage, `profile_photos/${filename}`);
        console.log("Storage reference created:", storageRef);
        
        // Convert URI to blob
        console.log("Converting image to blob...");
        const response = await fetch(imageUri);
        const blob = await response.blob();
        console.log("Blob created, size:", blob.size);
        
        // Upload the image with metadata
        const metadata = {
          contentType: 'image/jpeg',
          customMetadata: {
            'uploadedBy': user.uid,
            'uploadedAt': new Date().toISOString()
          }
        };
        
        console.log("Uploading to Firebase Storage...");
        const uploadResult = await uploadBytes(storageRef, blob, metadata);
        console.log("Upload result:", uploadResult);
        
        console.log("Getting download URL...");
        const downloadURL = await getDownloadURL(uploadResult.ref);
        console.log("Download URL:", downloadURL);
        
        // Update Firestore with the download URL
        console.log("Updating Firestore...");
        const docRef = doc(db, "Drivers", user.uid);
        await updateDoc(docRef, { 
          photo: downloadURL,
          photoUpdatedAt: new Date().toISOString()
        });
        
        // Update local state
        console.log("Updating local state...");
        setUserDetails((prev) => {
          const updated = { 
            ...prev, 
            photo: downloadURL,
            photoUpdatedAt: new Date().toISOString()
          };
          console.log("Updated user details:", updated);
          return updated;
        });
        
        // Update AsyncStorage
        console.log("Updating AsyncStorage...");
        const updatedDetails = { 
          ...userDetails, 
          photo: downloadURL,
          photoUpdatedAt: new Date().toISOString()
        };
        await AsyncStorage.setItem('driverInfo', JSON.stringify(updatedDetails));
        console.log("AsyncStorage updated");
        
        Alert.alert("Succès", "Photo de profil mise à jour avec succès.");
      }
    } catch (error) {
      console.error("Error updating profile picture:", error);
      Alert.alert("Erreur", "Impossible de mettre à jour la photo de profil. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  async function handleLogout() {
    try {
      await auth.signOut();
      navigation.navigate("LoginScreen");
    } catch (error) {
      Alert.alert("Erreur", error.message, [{ text: "D'accord" }]);
    }
  }

  async function handleAccountDeletion() {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Erreur", "Aucun utilisateur n'est actuellement connecté.");
      return;
    }

    // First confirmation dialog
    Alert.alert(
      "Supprimer le compte",
      "Êtes-vous sûr de vouloir supprimer votre compte ? Cette action ne peut pas être annulée et supprimera définitivement tous vos données.",
      [
        {
          text: "Annuler",
          style: "cancel",
        },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            // Second confirmation dialog
            Alert.alert(
              "Confirmation finale",
              "Cela supprimera définitivement votre compte et toutes les données associées. Êtes-vous absolument sûr ?",
              [
                {
                  text: "Annuler",
                  style: "cancel",
                },
                {
                  text: "Oui, supprimer mon compte",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      setLoading(true);
                      
                      // Delete user data from Firestore
                      const userDocRef = doc(db, "Drivers", user.uid);
                      const userDoc = await getDoc(userDocRef);
                      
                      if (userDoc.exists()) {
                        const userData = userDoc.data();
                        
                        // Delete profile photo from storage if it exists
                        if (userData.photo) {
                          try {
                            const photoRef = ref(storage, userData.photo);
                            await deleteObject(photoRef);
                          } catch (error) {
                            console.log("Error deleting profile photo:", error);
                          }
                        }
                        
                        // Delete user document from Firestore
                        await deleteDoc(userDocRef);
                      }
                      
                      // Delete user stats from Firestore
                      try {
                        const statsDocRef = doc(db, "driverStats", user.uid);
                        await deleteDoc(statsDocRef);
                      } catch (error) {
                        console.log("Error deleting stats:", error);
                      }
                      
                      // Clear AsyncStorage
                      await AsyncStorage.clear();
                      
                      // Delete the user account from Firebase Auth
                      await deleteUser(user);
                      
                      Alert.alert(
                        "Compte supprimé",
                        "Votre compte a été supprimé avec succès.",
                        [
                          {
                            text: "D'accord",
                            onPress: () => {
                              navigation.reset({
                                index: 0,
                                routes: [{ name: "LoginScreen" }],
                              });
                            },
                          },
                        ]
                      );
                    } catch (error) {
                      console.error("Error deleting account:", error);
                      setLoading(false);
                      
                      let errorMessage = "Une erreur est survenue lors de la suppression de votre compte.";
                      
                      if (error.code === "auth/requires-recent-login") {
                        errorMessage = "Pour des raisons de sécurité, veuillez vous déconnecter et vous reconnecter avant de supprimer votre compte.";
                      } else if (error.code === "auth/user-token-expired") {
                        errorMessage = "Votre session a expiré. Veuillez vous déconnecter et vous reconnecter avant de supprimer votre compte.";
                      } else if (error.code === "auth/network-request-failed") {
                        errorMessage = "Erreur de réseau. Veuillez vérifier votre connexion internet et réessayer.";
                      }
                      
                      Alert.alert("Erreur", errorMessage);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  // Helper function to handle re-authentication if needed
  const handleReAuthentication = async (email, password) => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user logged in");
      
      const credential = EmailAuthProvider.credential(email, password);
      await reauthenticateWithCredential(user, credential);
      return true;
    } catch (error) {
      console.error("Re-authentication error:", error);
      return false;
    }
  };

  // Get driver tier based on rating
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
        Animated.timing(tierBadgeAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(tierBadgeAnim, {
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

  // Renders the star rating beneath the driver's name
  const renderStars = () => {
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
          size={20}
          color="#FFC107"
          style={styles.starIcon}
        />
      );
    }
    
    // Add half star if needed
    if (hasHalfStar) {
      stars.push(
        <Ionicons
          key="star-half"
          name="star-half"
          size={20}
          color="#FFC107"
          style={styles.starIcon}
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
          size={20}
          color="#FFC107"
          style={styles.starIcon}
        />
      );
    }
    
    return (
      <View style={styles.starsContainer}>
        {stars}
        <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
        <Animated.View 
          style={[
            styles.tierBadge, 
            { 
              backgroundColor: tier.color,
              transform: [{ scale: tierBadgeAnim }]
            }
          ]}
        >
          <Ionicons name={tier.icon} size={12} color="#000" />
          <Text style={styles.tierText}>{tier.tier}</Text>
        </Animated.View>
      </View>
    );
  };

  // Test notification function
  const handleTestNotification = async () => {
    try {
      console.log('Sending test notification...');
      
      // First check if notifications are properly initialized
      const hasPermission = await notificationService.requestPermissions();
      if (!hasPermission) {
        Alert.alert(
          "Permission Requise", 
          "Veuillez activer les notifications dans les paramètres de votre appareil pour recevoir les alertes de course."
        );
        return;
      }
      
      // Send test notification with enhanced sound and vibration
      await notificationService.sendTestRideNotification();
      
      Alert.alert(
        "Notification de test envoyée !", 
        "Vous devriez recevoir une notification avec le titre '🎯 Course assignée!' et entendre un son avec vibration. Si vous n'entendez rien, vérifiez les paramètres de notification de votre appareil et le volume."
      );
    } catch (error) {
      console.error("Error sending test notification:", error);
      Alert.alert(
        "Erreur", 
        "Impossible d'envoyer la notification de test. Assurez-vous d'utiliser une version de développement pour les notifications push."
      );
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color="#ff7e28" />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Enhanced header with animation */}
      <Animated.View
        style={[
          styles.headerContainer,
          {
            backgroundColor: colors.background,
            shadowColor: colors.text,
            opacity: headerOpacity,
          },
        ]}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Paramètres</Text>
        <TouchableOpacity style={styles.helpButton}>
          <Ionicons name="help-circle-outline" size={24} color={colors.primary} />
        </TouchableOpacity>
      </Animated.View>

      {/* Profile section at the top */}
      <View style={[styles.profileSection, { backgroundColor: colors.card }]}>
        <View style={styles.profileImageContainer}>
          {userDetails?.photo && !imageLoadError ? (
            <Image 
              source={{ 
                uri: userDetails.photo,
                headers: {
                  'Cache-Control': 'no-cache'
                }
              }} 
              style={styles.profileImage}
              onError={(error) => {
                console.error("Image loading error:", error.nativeEvent.error);
                setImageLoadError(true);
              }}
              onLoad={() => {
                console.log("Image loaded successfully");
                setImageLoadError(false);
              }}
              defaultSource={require('../assets/driver_placeholder.png')}
            />
          ) : (
            <View style={[styles.placeholderPic, { backgroundColor: colors.primary }]}>
              <Ionicons name="person" size={30} color="#FFFFFF" />
            </View>
          )}
          <TouchableOpacity
            style={[styles.editIconContainer, { backgroundColor: colors.primary }]}
            onPress={handleProfilePictureChange}
          >
            <Ionicons name="pencil" size={14} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.text }]}>
            {userDetails?.firstName || ""} {userDetails?.lastName || ""}
          </Text>
          <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>
            {userDetails?.email || "driver@example.com"}
          </Text>
          {renderStars()}
          <TouchableOpacity
            style={[styles.editProfileButton, { backgroundColor: colors.primaryLight }]}
            onPress={() => navigation.navigate("EditProfile")}
          >
            <Text style={[styles.editProfileText, { color: colors.primary }]}>
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 
        Removed the entire Driver Stats Section here as requested:
        (Online Today, Rides, Ratings box)
      */}

      {/* Main scrollable area */}
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
        <View style={styles.content}>
          {/* Account Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Paramètres du compte
            </Text>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={() => navigation.navigate("ModifyInfo")}
            >
              <View style={styles.settingItemLeft}>
                <Ionicons name="person-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Informations personnelles
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Mettre à jour vos détails de profil
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem} 
              onPress={() => navigation.navigate("PaymentScreen")}
            >
              <View style={styles.settingItemLeft}>
                <Ionicons name="wallet-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Méthodes de paiement
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Gérer les options de paiement
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Theme & Appearance Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Thème et apparence
            </Text>

            <TouchableOpacity style={styles.settingItem} onPress={toggleTheme}>
              <View style={styles.settingItemLeft}>
                <Ionicons
                  name={isDarkMode ? "moon" : "sunny"}
                  size={24}
                  color={colors.primary}
                />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Mode sombre
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Basculer entre le thème sombre et clair
                  </Text>
                </View>
              </View>
              <Switch
                trackColor={{ false: "#767577", true: colors.primaryLight }}
                thumbColor={isDarkMode ? colors.primary : "#f4f3f4"}
                ios_backgroundColor="#3e3e3e"
                onValueChange={toggleTheme}
                value={isDarkMode}
              />
            </TouchableOpacity>
          </View>

          {/* Security Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Sécurité
            </Text>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="finger-print" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Authentification biométrique
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Utiliser le code biométrique ou Face ID
                  </Text>
                </View>
              </View>
              <Switch
                trackColor={{ false: "#767577", true: colors.primaryLight }}
                thumbColor={biometricsEnabled ? colors.primary : "#f4f3f4"}
                ios_backgroundColor="#3e3e3e"
                onValueChange={() => setBiometricsEnabled((prev) => !prev)}
                value={biometricsEnabled}
              />
            </TouchableOpacity>
          </View>

          {/* Notifications Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Notifications
            </Text>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="notifications-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Notifications push
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Recevoir les demandes de course et les mises à jour
                  </Text>
                </View>
              </View>
              <Switch
                trackColor={{ false: "#767577", true: colors.primaryLight }}
                thumbColor={notificationsEnabled ? colors.primary : "#f4f3f4"}
                ios_backgroundColor="#3e3e3e"
                onValueChange={() => setNotificationsEnabled((prev) => !prev)}
                value={notificationsEnabled}
              />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="car-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Alertes de demande de course
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Recevoir les notifications des nouvelles demandes de course
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.settingItem}
              onPress={handleTestNotification}
            >
              <View style={styles.settingItemLeft}>
                <Ionicons name="flash-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Test de notification
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Envoyer une notification de test
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Referral Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Récompenses</Text>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="gift" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Inviter un ami
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Recevoir 3500 FDJ pour chaque référence
                  </Text>
                </View>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                <Text style={styles.badgeText}>NOUVEAU</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Support Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Aide et support
            </Text>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="help-circle-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Centre d'aide
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Obtenir de l'aide et du support
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={24}
                  color={colors.primary}
                />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Nous contacter
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Prendre contact avec le support
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Legal Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              À propos
            </Text>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons
                  name="information-circle-outline"
                  size={24}
                  color={colors.primary}
                />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    À propos de Caval
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    En savoir plus sur notre application
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="document-text-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Conditions d'utilisation
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Lire nos conditions d'utilisation
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.settingItem} onPress={() => Linking.openURL('https://www.caval.tech/contact')}>
              <View style={styles.settingItemLeft}>
                <Ionicons name="shield-outline" size={24} color={colors.primary} />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Politique de confidentialité
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    Lire notre politique de confidentialité
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* About/App info section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              À propos
            </Text>

            <TouchableOpacity style={styles.settingItem}>
              <View style={styles.settingItemLeft}>
                <Ionicons
                  name="information-circle-outline"
                  size={24}
                  color={colors.primary}
                />
                <View>
                  <Text style={[styles.settingText, { color: colors.text }]}>
                    Informations sur l'application
                  </Text>
                  <Text style={[styles.settingSubtext, { color: colors.textSecondary }]}>
                    version 2.1.4
                  </Text>
                </View>
              </View>
              <View style={[styles.updateBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.updateBadgeText}>Mise à jour disponible</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Account deletion section */}
          <View style={[styles.warningSection, { backgroundColor: colors.card }]}>
            <View style={styles.warningContent}>
              <Ionicons name="warning-outline" size={24} color="#FF6B35" />
              <Text style={[styles.warningText, { color: colors.text }]}>
                Cette action supprimera définitivement votre compte et toutes les données associées. Cette action ne peut pas être annulée.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.logoutButton,
              {
                backgroundColor: "#DC3545",
                borderColor: "#DC3545",
                borderWidth: 1,
              }
            ]}
            onPress={handleAccountDeletion}
          >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={[styles.logoutButtonText, { color: '#FFFFFF' }]}>
              Supprimer le compte
            </Text>
          </TouchableOpacity>

          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            © 2025 Caval Technologies Inc.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default SettingsScreen;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
    marginTop: Platform.OS === 'android' ? 32 : 0,
  },
  backButton: {
    padding: 8,
  },
  helpButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  profileSection: {
    flexDirection: "row",
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  profileImageContainer: {
    position: "relative",
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  placeholderPic: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  editIconContainer: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    marginBottom: 8,
  },
  starsContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  starIcon: {
    marginRight: 2,
  },
  ratingText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
    marginLeft: 4,
  },
  editProfileButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: "flex-start",
  },
  editProfileText: {
    fontSize: 14,
    fontWeight: "600",
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  section: {
    borderRadius: 12,
    marginBottom: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    padding: 16,
    paddingBottom: 8,
  },
  settingItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  settingItemLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  settingText: {
    fontSize: 16,
    fontWeight: "500",
    marginLeft: 12,
  },
  settingSubtext: {
    fontSize: 13,
    marginLeft: 12,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  updateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  updateBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    marginTop: 12,
    marginHorizontal: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  footerText: {
    textAlign: "center",
    marginTop: 16,
    fontSize: 12,
  },
  warningSection: {
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FF6B35",
    borderStyle: "dashed",
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
  },
  warningContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  warningText: {
    fontSize: 14,
    marginLeft: 8,
    flexShrink: 1,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 8,
  },
  tierText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#000',
    marginLeft: 4,
  },
});
