import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, makeStyles } from "../context/ThemeContext";
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, me } from '../config/supabase';
import { t } from "../utils/i18n";
import { showAlert } from "../components/Dialog";

function ApprovalStatusScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [approvalStatus, setApprovalStatus] = useState('pending');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkApprovalStatus();
  }, []);

  const checkApprovalStatus = async () => {
    try {
      if (!me()) return;
      const { data: driverRow, error } = await supabase.from('drivers').select('approval_status').eq('id', me()).maybeSingle();
      if (error) throw error;
      if (driverRow) {
        const currentStatus = driverRow.approval_status || 'pending';
        setApprovalStatus(currentStatus);
        
        // Update stored status
        await AsyncStorage.setItem('driverApprovalStatus', currentStatus);
      } else {
        console.log('Driver document not found');
        setApprovalStatus('pending');
      }
    } catch (error) {
      console.error('Error checking approval status:', error);
      // Fallback to stored status
      const storedStatus = await AsyncStorage.getItem('driverApprovalStatus');
      setApprovalStatus(storedStatus || 'pending');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Signing out switches the app to the login screen (App.js)
      await AsyncStorage.removeItem('driverApprovalStatus').catch(() => {});
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Error logging out:', error);
      showAlert(t("Erreur"), t("Déconnexion impossible. Réessayez."));
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>{t("Vérification du statut...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const getStatusInfo = () => {
    switch (approvalStatus) {
      case 'approved':
        return {
          icon: 'checkmark-circle',
          title: t("Compte Approuvé!"),
          message: t("Votre compte a été approuvé avec succès. Vous pouvez maintenant commencer à travailler."),
          color: colors.successText,
          action: () => navigation.navigate('Home'),
          actionText: t("Commencer à travailler"),
        };
      case 'rejected':
        return {
          icon: 'close-circle',
          title: t("Compte Non Approuvé"),
          message: t("Votre demande de compte chauffeur n'a pas été approuvée. Contactez le support pour plus d'informations."),
          color: colors.errorText,
          action: handleLogout,
          actionText: t("Se déconnecter"),
        };
      default:
        return {
          icon: 'time',
          title: 'En Attente d\'Approbation',
          message: t("Votre compte est en cours d'examen par notre équipe. Vous recevrez une notification push ou un email dès que votre compte sera approuvé. Veuillez vous déconnecter et vous reconnecter plus tard."),
          color: colors.primaryText,
          action: handleLogout,
          actionText: t("Se déconnecter"),
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t("Statut du Compte")}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <View style={[styles.statusCard, { backgroundColor: colors.card }]}>
          <View style={[styles.iconContainer, { backgroundColor: statusInfo.color + '20' }]}>
            <Ionicons name={statusInfo.icon} size={60} color={statusInfo.color} />
          </View>
          
          <Text style={[styles.statusTitle, { color: colors.text }]}>{statusInfo.title}</Text>
          <Text style={[styles.statusMessage, { color: colors.textSecondary }]}>{statusInfo.message}</Text>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: statusInfo.color }]}
            onPress={statusInfo.action}
          >
            <Text style={styles.actionButtonText}>{statusInfo.actionText}</Text>
          </TouchableOpacity>
        </View>

        {approvalStatus === 'pending' && (
          <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
            <Ionicons name="information-circle" size={24} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Le processus d'approbation prend généralement 24-48 heures. Vous recevrez une notification push ou un email dès que votre compte sera approuvé. Veuillez vous déconnecter et vous reconnecter plus tard pour vérifier votre statut.
            </Text>
          </View>
        )}

        {approvalStatus === 'rejected' && (
          <View style={[styles.infoCard, { backgroundColor: colors.card }]}>
            <Ionicons name="help-circle" size={24} color={colors.error} />
            <Text style={[styles.infoText, { color: colors.textSecondary }]}>
              Si vous pensez qu'il s'agit d'une erreur, contactez notre équipe de support pour plus d'informations.
            </Text>
            <TouchableOpacity
              style={[styles.contactButton, { backgroundColor: colors.primary }]}
              onPress={() => {/* Add contact support logic */}}
            >
              <Text style={styles.contactButtonText}>{t("Contacter le Support")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  backButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  statusCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  statusMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 24,
  },
  actionButton: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  actionButtonText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 12,
  },
  contactButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  contactButtonText: {
    color: colors.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
}));

export default ApprovalStatusScreen; 