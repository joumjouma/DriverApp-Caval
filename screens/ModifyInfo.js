import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  SafeAreaView,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";
import { useTheme } from "../context/ThemeContext";
import { useNavigation } from "@react-navigation/native";
import { auth } from "../config/firebase";
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../config/firebase";

function ModifyInfo() {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const user = auth.currentUser;

  // User information states
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [drivingLicense, setDrivingLicense] = useState("");
  const [address, setAddress] = useState("");
  
  // UI states
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [secureEntry, setSecureEntry] = useState(true);
  const [secureEntryNew, setSecureEntryNew] = useState(true);
  const [secureEntryConfirm, setSecureEntryConfirm] = useState(true);
  const [editMode, setEditMode] = useState({
    personalInfo: false,
    contactInfo: false,
    password: false,
    drivingInfo: false,
  });

  // Fetch user data on component mount
  useEffect(() => {
    const fetchUserData = async () => {
      if (!user) {
        navigation.navigate("LoginScreen");
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "Drivers", user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setFirstName(userData.firstName || "");
          setLastName(userData.lastName || "");
          setEmail(user.email || "");
          setPhone(userData.phoneNumber || "");
          setDrivingLicense(userData.drivingLicense || "");
          setAddress(userData.address || "");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        Alert.alert("Erreur", "Impossible de charger vos informations. Veuillez réessayer.");
      } finally {
        setInitialLoading(false);
      }
    };

    fetchUserData();
  }, []);

  // Function to toggle edit mode for different sections
  const toggleEditMode = (section) => {
    setEditMode((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));

    // Reset password fields when cancelling password edit
    if (section === "password" && editMode.password) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  // Function to validate email format
  const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Function to validate phone number format
  const isValidPhone = (phone) => {
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    return phoneRegex.test(phone);
  };

  // Function to handle personal info update
  const handlePersonalInfoUpdate = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Erreur", "Le prénom et le nom ne peuvent pas être vides.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, "Drivers", user.uid), {
        firstName,
        lastName,
      });
      
      Alert.alert("Succès", "Les informations personnelles ont été mises à jour avec succès.");
      setEditMode((prev) => ({ ...prev, personalInfo: false }));
    } catch (error) {
      console.error("Error updating personal info:", error);
      Alert.alert("Erreur", "Impossible de mettre à jour les informations personnelles. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  // Function to handle contact info update
  const handleContactInfoUpdate = async () => {
    if (!isValidEmail(email)) {
      Alert.alert("Erreur", "Veuillez entrer une adresse email valide.");
      return;
    }

    if (!isValidPhone(phone)) {
      Alert.alert("Erreur", "Veuillez entrer un numéro de téléphone valide (10-15 chiffres).");
      return;
    }

    setLoading(true);
    try {
      // Update email requires re-authentication
      if (email !== user.email) {
        Alert.alert(
          "Authentification requise",
          "Pour mettre à jour votre email, veuillez entrer votre mot de passe actuel :",
          [
            { text: "Annuler", style: "cancel" },
            {
              text: "Confirmer",
              onPress: async (password) => {
                if (!password) {
                  Alert.alert("Erreur", "Le mot de passe est requis pour mettre à jour l'email.");
                  setLoading(false);
                  return;
                }
                
                try {
                  const credential = EmailAuthProvider.credential(user.email, password);
                  await reauthenticateWithCredential(user, credential);
                  await updateEmail(user, email);
                  
                  await updateDoc(doc(db, "Drivers", user.uid), {
                    email,
                    phoneNumber: phone,
                  });
                  
                  Alert.alert("Succès", "Les informations de contact ont été mises à jour avec succès.");
                  setEditMode((prev) => ({ ...prev, contactInfo: false }));
                } catch (error) {
                  console.error("Error updating email:", error);
                  Alert.alert("Erreur", "Impossible de mettre à jour l'email. Veuillez vérifier votre mot de passe et réessayer.");
                } finally {
                  setLoading(false);
                }
              },
              style: "default",
            },
          ],
          { 
            cancelable: true,
            prompt: true,
            type: "secure-text",
          }
        );
      } else {
        // Just update phone number
        await updateDoc(doc(db, "Drivers", user.uid), {
          phoneNumber: phone,
        });
        
        Alert.alert("Succès", "Les informations de contact ont été mises à jour avec succès.");
        setEditMode((prev) => ({ ...prev, contactInfo: false }));
        setLoading(false);
      }
    } catch (error) {
      console.error("Error updating contact info:", error);
      Alert.alert("Erreur", "Impossible de mettre à jour les informations de contact. Veuillez réessayer.");
      setLoading(false);
    }
  };

  // Function to handle password update
  const handlePasswordUpdate = async () => {
    if (!currentPassword) {
      Alert.alert("Erreur", "Le mot de passe actuel est requis.");
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert("Erreur", "Le nouveau mot de passe doit comporter au moins 8 caractères.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Erreur", "Les nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      // Re-authenticate user before changing password
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      Alert.alert("Succès", "Le mot de passe a été mis à jour avec succès.");
      setEditMode((prev) => ({ ...prev, password: false }));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Error updating password:", error);
      Alert.alert("Erreur", "Impossible de mettre à jour le mot de passe. Veuillez vérifier votre mot de passe actuel et réessayer.");
    } finally {
      setLoading(false);
    }
  };

  // Function to handle driving info update
  const handleDrivingInfoUpdate = async () => {
    if (!drivingLicense.trim()) {
      Alert.alert("Erreur", "Le numéro de permis de conduire ne peut pas être vide.");
      return;
    }

    if (!address.trim()) {
      Alert.alert("Erreur", "L'adresse ne peut pas être vide.");
      return;
    }

    setLoading(true);
    try {
      await updateDoc(doc(db, "Drivers", user.uid), {
        drivingLicense,
        address,
      });
      
      Alert.alert("Succès", "Les informations de conduite ont été mises à jour avec succès.");
      setEditMode((prev) => ({ ...prev, drivingInfo: false }));
    } catch (error) {
      console.error("Error updating driving info:", error);
      Alert.alert("Erreur", "Impossible de mettre à jour les informations de conduite. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Informations personnelles
        </Text>
        <View style={styles.placeholder} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <ScrollView style={styles.scrollView}>
          {/* Personal Info Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Informations personnelles
              </Text>
              <TouchableOpacity
                onPress={() => toggleEditMode("personalInfo")}
                style={styles.editButton}
              >
                <Text style={[styles.editButtonText, { color: colors.primary }]}>
                  {editMode.personalInfo ? "Annuler" : "Modifier"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Prénom
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.personalInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.personalInfo
                      ? colors.primary
                      : "transparent",
                  },
                ]}
                value={firstName}
                onChangeText={setFirstName}
                editable={editMode.personalInfo}
                placeholder="Entrez le prénom"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Nom
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.personalInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.personalInfo
                      ? colors.primary
                      : "transparent",
                  },
                ]}
                value={lastName}
                onChangeText={setLastName}
                editable={editMode.personalInfo}
                placeholder="Entrez le nom"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            {editMode.personalInfo && (
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={handlePersonalInfoUpdate}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Enregistrer les modifications</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Contact Info Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Informations de contact
              </Text>
              <TouchableOpacity
                onPress={() => toggleEditMode("contactInfo")}
                style={styles.editButton}
              >
                <Text style={[styles.editButtonText, { color: colors.primary }]}>
                  {editMode.contactInfo ? "Annuler" : "Modifier"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Email
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.contactInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.contactInfo
                      ? colors.primary
                      : "transparent",
                  },
                ]}
                value={email}
                onChangeText={setEmail}
                editable={editMode.contactInfo}
                placeholder="Entrez l'email"
                placeholderTextColor={colors.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Numéro de téléphone
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.contactInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.contactInfo
                      ? colors.primary
                      : "transparent",
                  },
                ]}
                value={phone}
                onChangeText={setPhone}
                editable={editMode.contactInfo}
                placeholder="Entrez le numéro de téléphone"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
              />
            </View>

            {editMode.contactInfo && (
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={handleContactInfoUpdate}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Enregistrer les modifications</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Password Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Mot de passe
              </Text>
              <TouchableOpacity
                onPress={() => toggleEditMode("password")}
                style={styles.editButton}
              >
                <Text style={[styles.editButtonText, { color: colors.primary }]}>
                  {editMode.password ? "Annuler" : "Changer"}
                </Text>
              </TouchableOpacity>
            </View>

            {editMode.password ? (
              <>
                <View style={styles.infoContainer}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Mot de passe actuel
                  </Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        {
                          backgroundColor: colors.inputBackground,
                          color: colors.text,
                        },
                      ]}
                      value={currentPassword}
                      onChangeText={setCurrentPassword}
                      placeholder="Entrez le mot de passe actuel"
                      placeholderTextColor={colors.textSecondary}
                      secureTextEntry={secureEntry}
                    />
                    <TouchableOpacity
                      style={styles.eyeIcon}
                      onPress={() => setSecureEntry(!secureEntry)}
                    >
                      <Ionicons
                        name={secureEntry ? "eye-off" : "eye"}
                        size={24}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.infoContainer}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Nouveau mot de passe
                  </Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        {
                          backgroundColor: colors.inputBackground,
                          color: colors.text,
                        },
                      ]}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="Entrez le nouveau mot de passe"
                      placeholderTextColor={colors.textSecondary}
                      secureTextEntry={secureEntryNew}
                    />
                    <TouchableOpacity
                      style={styles.eyeIcon}
                      onPress={() => setSecureEntryNew(!secureEntryNew)}
                    >
                      <Ionicons
                        name={secureEntryNew ? "eye-off" : "eye"}
                        size={24}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.infoContainer}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Confirmer le nouveau mot de passe
                  </Text>
                  <View style={styles.passwordContainer}>
                    <TextInput
                      style={[
                        styles.passwordInput,
                        {
                          backgroundColor: colors.inputBackground,
                          color: colors.text,
                        },
                      ]}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Confirmez le nouveau mot de passe"
                      placeholderTextColor={colors.textSecondary}
                      secureTextEntry={secureEntryConfirm}
                    />
                    <TouchableOpacity
                      style={styles.eyeIcon}
                      onPress={() => setSecureEntryConfirm(!secureEntryConfirm)}
                    >
                      <Ionicons
                        name={secureEntryConfirm ? "eye-off" : "eye"}
                        size={24}
                        color={colors.textSecondary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={[styles.passwordRequirements, { color: colors.textSecondary }]}>
                  Le mot de passe doit comporter au moins 8 caractères et inclure une combinaison de lettres, de chiffres et de caractères spéciaux.
                </Text>

                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: colors.primary }]}
                  onPress={handlePasswordUpdate}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.saveButtonText}>Mettre à jour le mot de passe</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.passwordPlaceholder}>
                <Text style={[styles.passwordPlaceholderText, { color: colors.textSecondary }]}>
                  ••••••••••
                </Text>
                <Text style={[styles.passwordLastChanged, { color: colors.textSecondary }]}>
                  Pour des raisons de sécurité, le mot de passe est masqué
                </Text>
              </View>
            )}
          </View>

          {/* Driving Info Section */}
          <View style={[styles.section, { backgroundColor: colors.card }]}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Informations de conduite
              </Text>
              <TouchableOpacity
                onPress={() => toggleEditMode("drivingInfo")}
                style={styles.editButton}
              >
                <Text style={[styles.editButtonText, { color: colors.primary }]}>
                  {editMode.drivingInfo ? "Annuler" : "Modifier"}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Numéro de permis de conduire
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.drivingInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.drivingInfo
                      ? colors.primary
                      : "transparent",
                  },
                ]}
                value={drivingLicense}
                onChangeText={setDrivingLicense}
                editable={editMode.drivingInfo}
                placeholder="Entrez le numéro de permis de conduire"
                placeholderTextColor={colors.textSecondary}
              />
            </View>

            <View style={styles.infoContainer}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Adresse
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: editMode.drivingInfo
                      ? colors.inputBackground
                      : "transparent",
                    color: colors.text,
                    borderColor: editMode.drivingInfo
                      ? colors.primary
                      : "transparent",
                    minHeight: 60,
                  },
                ]}
                value={address}
                onChangeText={setAddress}
                editable={editMode.drivingInfo}
                placeholder="Entrez l'adresse"
                placeholderTextColor={colors.textSecondary}
                multiline={true}
              />
            </View>

            {editMode.drivingInfo && (
              <TouchableOpacity
                style={[styles.saveButton, { backgroundColor: colors.primary }]}
                onPress={handleDrivingInfoUpdate}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>Enregistrer les modifications</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Security notice */}
          <View style={[styles.securityNotice, { backgroundColor: colors.cardSecondary }]}>
            <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
            <Text style={[styles.securityText, { color: colors.textSecondary }]}>
              Vos informations personnelles sont chiffrées et protégées. Nous ne partageons jamais vos détails avec des tiers.
            </Text>
          </View>

          {/* Bottom padding */}
          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  placeholder: {
    width: 40,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  editButton: {
    padding: 8,
  },
  editButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  infoContainer: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    marginBottom: 8,
  },
  input: {
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  passwordContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.1)",
  },
  passwordInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  eyeIcon: {
    padding: 12,
  },
  passwordRequirements: {
    fontSize: 12,
    marginTop: -8,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  passwordPlaceholder: {
    paddingVertical: 12,
  },
  passwordPlaceholderText: {
    fontSize: 18,
    letterSpacing: 2,
  },
  passwordLastChanged: {
    fontSize: 12,
    marginTop: 4,
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  securityNotice: {
    flexDirection: "row",
    alignItems: "center",
    margin: 16,
    padding: 16,
    borderRadius: 12,
  },
  securityText: {
    flex: 1,
    marginLeft: 16,
    fontSize: 14,
  },
  bottomPadding: {
    height: 40,
  },
});

export default ModifyInfo;