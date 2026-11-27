import React, { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar, Image, Modal } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import CavalLogo from "../assets/Caval_courrier_logo-removebg-preview.png";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { APP_CONFIG } from "../constants/appConfig";
import PrivacyPolicyModal from "../components/PrivacyPolicyModal";
import * as ImagePicker from 'expo-image-picker';
import { t } from "../utils/i18n";
import { registerDriver } from "../services/registration";
import { authMessage } from "../utils/authErrors";
import { showAlert } from "../components/Dialog";

function RegisterScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [typeDeVehicule, setTypeDeVehicule] = useState("Caval Privé");
  const [isLoading, setIsLoading] = useState(false);
  const [ville, setVille] = useState("");
  const [pays, setPays] = useState("");
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // New state variables for documents and payment methods
  const [facePhoto, setFacePhoto] = useState(null);
  const [carteGrisePhoto, setCarteGrisePhoto] = useState(null);
  const [plaqueImmatriculation, setPlaqueImmatriculation] = useState("");
  const [carMake, setCarMake] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carColor, setCarColor] = useState("");
  const [paymentMethods, setPaymentMethods] = useState({
    dmoney: false,
    cacpay: false,
    waafi: false,
    sabapay: false
  });

  const navigation = useNavigation();

  const formatPhoneNumber = (text) => {
    // Remove any non-digit characters
    const cleaned = text.replace(/\D/g, '');
    
    // If the number starts with 253, remove it as we'll add it back
    let number = cleaned;
    if (number.startsWith('253')) {
      number = number.substring(3);
    }
    
    // Limit to 8 digits (Djibouti numbers are typically 8 digits after country code)
    number = number.substring(0, 8);
    
    // Format the number with spaces
    let formatted = '';
    for (let i = 0; i < number.length; i++) {
      if (i === 2 || i === 4) {
        formatted += ' ';
      }
      formatted += number[i];
    }
    
    return formatted;
  };

  const handlePhoneChange = (text) => {
    const formatted = formatPhoneNumber(text);
    setTelephone(formatted);
  };

  const handleLicensePlateChange = (text) => {
    setPlaqueImmatriculation(text.toUpperCase());
  };

  const handlePrivacyPolicyAccept = async () => {
    try {
      await AsyncStorage.setItem('privacyPolicyAccepted', 'true');
      setShowPrivacyPolicy(false);
      
      // Navigate to approval status screen since new users are pending approval
      navigation.reset({
        index: 0,
        routes: [{ name: 'ApprovalStatusScreen' }],
      });
    } catch (error) {
      console.error("Error saving privacy policy acceptance:", error);
      showAlert(t("Erreur"), t("Impossible d'enregistrer votre accord. Réessayez."));
    }
  };

  const takeFacePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      
      if (status !== 'granted') {
        showAlert('Permission Required', 'Camera permission is required to take your photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        setFacePhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      showAlert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const takeCarteGrisePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      
      if (status !== 'granted') {
        showAlert('Permission Required', 'Camera permission is required to take a photo of your carte-grise.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3], // Better aspect ratio for documents
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled) {
        setCarteGrisePhoto(result.assets[0]);
      }
    } catch (error) {
      console.error('Error taking carte-grise photo:', error);
      showAlert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword || !prenom || !nom || !telephone || !facePhoto || !carteGrisePhoto || !plaqueImmatriculation || !carMake || !carModel || !carColor) {
      showAlert(
        t("Informations manquantes"),
        t("Veuillez remplir tous les champs obligatoires, prendre une photo de votre visage et de votre carte-grise, et entrer votre plaque d'immatriculation, marque, modèle et couleur du véhicule."),
        [{ text: t("OK") }]
      );
      return;
    }
    if (password !== confirmPassword) {
      showAlert(
        t("Erreur de mot de passe"),
        t("Les mots de passe ne correspondent pas. Veuillez vérifier et réessayer."),
        [{ text: t("OK") }]
      );
      return;
    }
    if (password.length < 6) {
      showAlert(
        t("Mot de passe trop court"),
        t("Le mot de passe doit contenir au moins 6 caractères."),
        [{ text: t("OK") }]
      );
      return;
    }
    if (!paymentMethods.dmoney && !paymentMethods.cacpay && !paymentMethods.waafi && !paymentMethods.sabapay) {
      showAlert(
        t("Méthodes de paiement requises"),
        t("Veuillez sélectionner au moins une méthode de paiement pour recevoir vos gains."),
        [{ text: t("OK") }]
      );
      return;
    }
    if (!telephone || telephone.replace(/\s/g, '').length < 8) {
      showAlert(
        t("Numéro de téléphone invalide"),
        t("Veuillez entrer un numéro de téléphone valide."),
        [{ text: t("OK") }]
      );
      return;
    }
    setIsLoading(true);
    try {
      const res = await registerDriver({
        email, password,
        firstName: prenom, lastName: nom, phone: telephone,
        vehicleType: typeDeVehicule, city: ville, country: pays,
        plate: plaqueImmatriculation, carMake, carModel, carColor,
        paymentMethods,
        facePhotoUri: facePhoto?.uri, carteGrisePhotoUri: carteGrisePhoto?.uri,
      });
      setIsLoading(false);
      if (res.needsEmailConfirmation) {
        showAlert(
          t("Confirmez votre email"),
          t("Nous vous avons envoyé un lien. Ouvrez-le, puis connectez-vous : votre dossier sera envoyé automatiquement."),
          [{ text: t("OK"), onPress: () => navigation.navigate("LoginScreen") }]
        );
        return;
      }
      // Signed in: the app opens on the home screen, which shows the approval status.
      showAlert(
        t("Inscription réussie !"),
        t("Votre compte a été créé avec succès. Votre demande est maintenant en cours d'examen par notre équipe. Vous recevrez une notification dès que votre compte sera approuvé."),
        [{ text: t("OK") }]
      );
    } catch (error) {
      setIsLoading(false);
      const errorMessage = /upload|storage|bucket/i.test(error?.message || "")
        ? t("Erreur lors du téléchargement de la photo. Veuillez réessayer.")
        : authMessage(error, "Une erreur est survenue lors de l'inscription. Veuillez réessayer.");
      showAlert(t("Échec de l'inscription"), errorMessage, [{ text: t("OK") }]);
    }
  };

  const togglePaymentMethod = (method) => {
    setPaymentMethods(prev => ({
      ...prev,
      [method]: !prev[method]
    }));
  };

  return (
    <View style={styles.mainContainer}>
      <LinearGradient
        colors={[colors.background, colors.background]}
        style={styles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.logoContainer}>
          <Image 
            source={CavalLogo} 
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardAvoidingView}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t("Créer un compte chauffeur")}</Text>
              <Text style={styles.subtitle}>
                Rejoignez l'équipe Caval et commencez à gagner dès aujourd'hui
              </Text>
            </View>

            <View style={styles.formContainer}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("Type de véhicule")}</Text>
                <View style={styles.buttonGroup}>
                  {[
                    "Caval Privé",
                    `${APP_CONFIG.displayName} moto`
                  ].map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeButton,
                        typeDeVehicule === type && styles.selectedButton,
                      ]}
                      onPress={() => setTypeDeVehicule(type)}
                    >
                      <MaterialIcons
                        name={type.includes("moto") ? "two-wheeler" : "directions-car"}
                        size={24}
                        color={typeDeVehicule === type ? colors.onPrimary : colors.primaryText}
                        style={styles.typeIcon}
                      />
                      <Text
                        style={[
                          styles.typeButtonText,
                          typeDeVehicule === type && styles.selectedButtonText,
                        ]}
                      >
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Documents Section */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("Documents requis")}</Text>
                
                {/* License Plate */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Plaque d'immatriculation")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="car-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t(" (Format Djibouti)")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={handleLicensePlateChange}
                      value={plaqueImmatriculation}
                    />
                  </View>
                </View>

                {/* Car Make */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Marque du véhicule")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="car-sport-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Ex: Toyota, Honda, Nissan...")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setCarMake}
                      value={carMake}
                    />
                  </View>
                </View>

                {/* Car Model */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Modèle du véhicule")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="car-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Ex: Corolla, Civic, Sunny...")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setCarModel}
                      value={carModel}
                    />
                  </View>
                </View>

                {/* Car Color */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Couleur du véhicule")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="color-palette-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Ex: Blanc, Noir, Rouge...")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setCarColor}
                      value={carColor}
                    />
                  </View>
                </View>
                
                {/* Face Photo */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Photo de votre visage")}</Text>
                  <TouchableOpacity
                    style={styles.documentUploadButton}
                    onPress={takeFacePhoto}
                  >
                    {facePhoto ? (
                      <View style={styles.photoPreviewContainer}>
                        <Image source={{ uri: facePhoto.uri }} style={styles.facePhotoPreview} />
                        <TouchableOpacity
                          style={styles.retakeButton}
                          onPress={takeFacePhoto}
                        >
                          <MaterialIcons name="camera-alt" size={20} color={colors.text} />
                          <Text style={styles.retakeText}>{t("Reprendre")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.uploadPlaceholder}>
                        <MaterialIcons name="face" size={24} color={colors.primaryText} />
                        <Text style={styles.uploadText}>{t("Prendre une photo")}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Carte Grise Photo */}
                <View style={styles.documentSection}>
                  <Text style={styles.documentLabel}>{t("Photo de votre carte-grise")}</Text>
                  <TouchableOpacity
                    style={styles.documentUploadButton}
                    onPress={takeCarteGrisePhoto}
                  >
                    {carteGrisePhoto ? (
                      <View style={styles.photoPreviewContainer}>
                        <Image source={{ uri: carteGrisePhoto.uri }} style={styles.carteGrisePhotoPreview} />
                        <TouchableOpacity
                          style={styles.retakeButton}
                          onPress={takeCarteGrisePhoto}
                        >
                          <MaterialIcons name="camera-alt" size={20} color={colors.text} />
                          <Text style={styles.retakeText}>{t("Reprendre")}</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.uploadPlaceholder}>
                        <MaterialIcons name="credit-card" size={24} color={colors.primaryText} />
                        <Text style={styles.uploadText}>{t("Prendre une photo")}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Payment Methods Section */}
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("Méthodes de paiement acceptées")}</Text>
                <View style={styles.paymentMethodsContainer}>
                  {[
                    { id: 'dmoney', label: 'D-money', icon: 'phone-android' },
                    { id: 'cacpay', label: 'Cac pay', icon: 'payment' },
                    { id: 'waafi', label: 'Waafi', icon: 'smartphone' },
                    { id: 'sabapay', label: 'Saba Pay', icon: 'business' }
                  ].map((method) => (
                    <TouchableOpacity
                      key={method.id}
                      style={[
                        styles.paymentMethodButton,
                        paymentMethods[method.id] && styles.selectedPaymentMethod
                      ]}
                      onPress={() => togglePaymentMethod(method.id)}
                    >
                      <MaterialIcons
                        name={method.icon}
                        size={24}
                        color={paymentMethods[method.id] ? colors.onPrimary : colors.primaryText}
                      />
                      <Text
                        style={[
                          styles.paymentMethodText,
                          paymentMethods[method.id] && styles.selectedPaymentMethodText
                        ]}
                      >
                        {method.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t("Informations personnelles")}</Text>
                <View style={styles.inputRow}>
                  <View style={[styles.inputContainer, styles.halfWidth]}>
                    <Text style={styles.inputLabel}>{t("Prénom")}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="person-outline"
                        size={20}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder={t("Entrez votre prénom")}
                        placeholderTextColor={colors.placeholder}
                        onChangeText={setPrenom}
                        value={prenom}
                      />
                    </View>
                  </View>

                  <View style={[styles.inputContainer, styles.halfWidth]}>
                    <Text style={styles.inputLabel}>{t("Nom")}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="person-outline"
                        size={20}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder={t("Entrez votre nom")}
                        placeholderTextColor={colors.placeholder}
                        onChangeText={setNom}
                        value={nom}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t("Email")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="mail-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Entrez votre email")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setEmail}
                      value={email}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t("Téléphone")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="call-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <Text style={styles.countryCode}>+253</Text>
                    <TextInput
                      style={[styles.input, styles.phoneInput]}
                      placeholder={t("XX XX XX XX")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={handlePhoneChange}
                      value={telephone}
                      keyboardType="phone-pad"
                      maxLength={11} // 8 digits + 2 spaces
                    />
                  </View>
                </View>

                <View style={styles.inputRow}>
                  <View style={[styles.inputContainer, styles.halfWidth]}>
                    <Text style={styles.inputLabel}>{t("Ville")}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="location-outline"
                        size={20}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder={t("Votre ville")}
                        placeholderTextColor={colors.placeholder}
                        onChangeText={setVille}
                        value={ville}
                      />
                    </View>
                  </View>

                  <View style={[styles.inputContainer, styles.halfWidth]}>
                    <Text style={styles.inputLabel}>{t("Pays")}</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="earth-outline"
                        size={20}
                        color={colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.input}
                        placeholder={t("Votre pays")}
                        placeholderTextColor={colors.placeholder}
                        onChangeText={setPays}
                        value={pays}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t("Mot de passe")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Créez un mot de passe")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setPassword}
                      value={password}
                      secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowPassword(!showPassword)}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off" : "eye"}
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>{t("Confirmer le mot de passe")}</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons
                      name="lock-closed-outline"
                      size={20}
                      color={colors.textMuted}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder={t("Confirmez votre mot de passe")}
                      placeholderTextColor={colors.placeholder}
                      onChangeText={setConfirmPassword}
                      value={confirmPassword}
                      secureTextEntry={!showConfirmPassword}
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      <Ionicons
                        name={showConfirmPassword ? "eye-off" : "eye"}
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.button}
                onPress={handleRegister}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <View style={styles.buttonContent}>
                    <Text style={styles.buttonText}>{t("Créer un compte")}</Text>
                    <Ionicons name="arrow-forward" size={20} color={colors.onPrimary} style={styles.buttonIcon} />
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => navigation.navigate("LoginScreen")}
              >
                <Text style={styles.loginText}>
                  Vous avez déjà un compte ?{" "}
                  <Text style={styles.loginLinkText}>{t("Se connecter")}</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      <PrivacyPolicyModal
        visible={showPrivacyPolicy}
        onAccept={handlePrivacyPolicyAccept}
      />
    </View>
  );
}

export default RegisterScreen;

const useStyles = makeStyles((colors) => ({
  mainContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  gradient: {
    flex: 1,
  },
  logoContainer: {
    paddingTop: 40,
    paddingLeft: 20,
    paddingBottom: 10,
  },
  logo: {
    width: 120,
    height: 40,
  },
  container: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    marginBottom: 30,
    paddingTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  formContainer: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 22,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.text,
    marginBottom: 20,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  buttonGroup: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
    gap: 15,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 15,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  selectedButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    transform: [{ scale: 1.02 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  typeButtonText: {
    fontSize: 16,
    color: colors.textMuted,
    fontWeight: "600",
    marginTop: 8,
    textAlign: 'center',
  },
  selectedButtonText: {
    color: colors.onPrimary,
    fontWeight: "700",
  },
  typeIcon: {
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  halfWidth: {
    width: "48%",
  },
  inputContainer: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 25,
    marginBottom: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    color: colors.onPrimary,
    fontSize: 18,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  buttonIcon: {
    marginLeft: 8,
  },
  loginLink: {
    alignItems: "center",
    marginBottom: 30,
  },
  loginText: {
    color: colors.textMuted,
    fontSize: 16,
  },
  loginLinkText: {
    color: colors.primaryText,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  countryCode: {
    color: colors.text,
    fontSize: 16,
    marginRight: 8,
    fontWeight: "500",
  },
  phoneInput: {
    marginLeft: 0,
  },
  documentSection: {
    marginBottom: 18,
  },
  documentLabel: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  documentUploadButton: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  documentPreview: {
    width: 80,
    height: 120,
    borderRadius: 8,
    marginRight: 12,
  },
  uploadPlaceholder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  uploadText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "500",
  },
  paymentMethodsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  paymentMethodButton: {
    width: "48%",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 10,
    backgroundColor: colors.surface,
    marginBottom: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedPaymentMethod: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  paymentMethodText: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: "500",
  },
  selectedPaymentMethodText: {
    color: colors.onPrimary,
    fontWeight: "600",
  },
  photoPreviewContainer: {
    width: '100%',
    alignItems: 'center',
  },
  facePhotoPreview: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 10,
  },
  carteGrisePhotoPreview: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginBottom: 10,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  retakeText: {
    color: colors.text,
    marginLeft: 5,
    fontSize: 14,
    fontWeight: '600',
  },
  passwordToggle: {
    position: 'absolute',
    right: 15,
    top: 15,
  },
}));