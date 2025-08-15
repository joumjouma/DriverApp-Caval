import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Dimensions,
  Animated,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

const RideOfferModal = ({ 
  visible, 
  offer, 
  onAccept, 
  onReject, 
  onClose 
}) => {
  const [countdown, setCountdown] = useState(20);
  const [pulseAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    if (visible && offer) {
      setCountdown(offer.remainingSeconds || 20);
      startPulseAnimation();
    }
  }, [visible, offer]);

  useEffect(() => {
    if (visible && countdown > 0) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            onClose();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [visible, countdown, onClose]);

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const handleAccept = async () => {
    try {
      // Call the onAccept callback directly since we don't have the service
      onAccept(offer);
    } catch (error) {
      console.error('Error accepting offer:', error);
      Alert.alert('Error', 'Failed to accept offer. Please try again.');
    }
  };

  const handleReject = async () => {
    try {
      // Call the onReject callback directly since we don't have the service
      onReject(offer);
    } catch (error) {
      console.error('Error rejecting offer:', error);
      Alert.alert('Error', 'Failed to reject offer. Please try again.');
    }
  };

  if (!offer) return null;

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCountdownColor = () => {
    if (countdown > 10) return '#4CAF50';
    if (countdown > 5) return '#FF9800';
    return '#F44336';
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <LinearGradient
            colors={['#ff7e28', '#ff9f43']}
            style={styles.header}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <View style={styles.headerContent}>
              <Ionicons name="car" size={32} color="#fff" />
              <Text style={styles.headerTitle}>Nouvelle Course</Text>
              <Animated.View 
                style={[
                  styles.countdownContainer,
                  { transform: [{ scale: pulseAnim }] }
                ]}
              >
                <Text style={[styles.countdownText, { color: getCountdownColor() }]}>
                  {formatTime(countdown)}
                </Text>
              </Animated.View>
            </View>
          </LinearGradient>

          <View style={styles.content}>
            <View style={styles.rideInfo}>
              <View style={styles.infoRow}>
                <Ionicons name="location" size={20} color="#ff7e28" />
                <Text style={styles.infoText} numberOfLines={2}>
                  {offer.rideData?.pickupAddress || 'Adresse de départ'}
                </Text>
              </View>
              
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={20} color="#ff7e28" />
                <Text style={styles.infoText} numberOfLines={2}>
                  {offer.rideData?.destinationAddress || 'Adresse de destination'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Ionicons name="cash" size={20} color="#ff7e28" />
                <Text style={styles.infoText}>
                  {offer.rideData?.fare || 0}€
                </Text>
              </View>

              {offer.rideData?.distance && (
                <View style={styles.infoRow}>
                  <Ionicons name="speedometer" size={20} color="#ff7e28" />
                  <Text style={styles.infoText}>
                    {offer.rideData.distance} km
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, styles.rejectButton]}
                onPress={handleReject}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={24} color="#fff" />
                <Text style={styles.buttonText}>Refuser</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.acceptButton]}
                onPress={handleAccept}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={24} color="#fff" />
                <Text style={styles.buttonText}>Accepter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: width * 0.9,
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  header: {
    padding: 20,
    alignItems: 'center',
  },
  headerContent: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
    marginBottom: 15,
  },
  countdownContainer: {
    backgroundColor: '#fff',
    borderRadius: 25,
    paddingHorizontal: 20,
    paddingVertical: 10,
    minWidth: 80,
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    padding: 20,
  },
  rideInfo: {
    marginBottom: 30,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
    paddingHorizontal: 10,
  },
  infoText: {
    fontSize: 16,
    color: '#333',
    marginLeft: 15,
    flex: 1,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  rejectButton: {
    backgroundColor: '#F44336',
  },
  acceptButton: {
    backgroundColor: '#4CAF50',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});

export default RideOfferModal; 