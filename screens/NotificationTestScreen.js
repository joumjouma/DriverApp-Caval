import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import notificationService from '../services/NotificationService';
import AuthDebugger from '../components/AuthDebugger';

const NotificationTestScreen = () => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('Unknown');
  const [pushToken, setPushToken] = useState(null);

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  const checkNotificationStatus = async () => {
    setIsLoading(true);
    try {
      const status = await notificationService.checkNotificationStatus();
      setNotificationStatus(status ? 'Enabled' : 'Disabled');
      
      // Get push token if available
      const token = await notificationService.getExpoPushToken();
      setPushToken(token);
    } catch (error) {
      console.error('Error checking notification status:', error);
      setNotificationStatus('Error');
    } finally {
      setIsLoading(false);
    }
  };

  const initializeNotifications = async () => {
    setIsLoading(true);
    try {
      const result = await notificationService.initialize();
      if (result.success) {
        setIsInitialized(true);
        Alert.alert('Success', 'Notifications initialized successfully!');
        checkNotificationStatus();
      } else {
        Alert.alert('Error', `Failed to initialize notifications: ${result.error}`);
      }
    } catch (error) {
      console.error('Error initializing notifications:', error);
      Alert.alert('Error', 'Failed to initialize notifications');
    } finally {
      setIsLoading(false);
    }
  };

  const testRideNotification = async () => {
    try {
      await notificationService.sendTestRideNotification();
      Alert.alert('Success', 'Test ride notification sent!');
    } catch (error) {
      console.error('Error sending test notification:', error);
      Alert.alert('Error', 'Failed to send test notification');
    }
  };

  const testApprovalNotification = async () => {
    try {
      await notificationService.sendTestApprovalNotification();
      Alert.alert('Success', 'Test approval notification sent!');
    } catch (error) {
      console.error('Error sending test notification:', error);
      Alert.alert('Error', 'Failed to send test notification');
    }
  };

  const testRideOfferWithCountdown = async () => {
    try {
      // Create a test ride offer in Firestore
      const { addDoc, collection } = require('firebase/firestore');
      const { db } = require('../config/firebase');
      const { auth } = require('../config/firebase');
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        Alert.alert('Error', 'No user logged in');
        return;
      }

      const now = new Date();
      const offerExpiryTime = new Date(now.getTime() + 15000); // 15 seconds

      const testOffer = {
        rideId: 'test-ride-' + Date.now(),
        selectedDriverId: currentUser.uid,
        selectedDriverName: 'Test Driver',
        selectedDriverPhone: '+1234567890',
        createdAt: now,
        offerSentAt: now,
        offerExpiryTime: offerExpiryTime,
        status: 'offer_sent',
        countdownSeconds: 15,
        rideData: {
          fare: 25.00,
          pickupAddress: '123 Test Street, Test City',
          destinationAddress: '456 Test Avenue, Test City',
          rideType: 'car',
          distance: 5.2,
          customerName: 'Test Customer',
          customerPhone: '+0987654321',
        }
      };

      await addDoc(collection(db, 'DriverSelection'), testOffer);
      Alert.alert('Success', 'Test ride offer with countdown created! Check your app for the offer modal.');
    } catch (error) {
      console.error('Error creating test ride offer:', error);
      Alert.alert('Error', 'Failed to create test ride offer');
    }
  };

  const requestPermissions = async () => {
    setIsLoading(true);
    try {
      const hasPermission = await notificationService.requestPermissions();
      if (hasPermission) {
        Alert.alert('Success', 'Notification permissions granted!');
        checkNotificationStatus();
      } else {
        Alert.alert('Permission Denied', 'Please enable notifications in your device settings.');
      }
    } catch (error) {
      console.error('Error requesting permissions:', error);
      Alert.alert('Error', 'Failed to request permissions');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Notification Test Screen</Text>
        
        <View style={styles.statusContainer}>
          <Text style={styles.statusLabel}>Notification Status:</Text>
          <Text style={[
            styles.statusValue,
            { color: notificationStatus === 'Enabled' ? '#4CAF50' : '#FF5722' }
          ]}>
            {notificationStatus}
          </Text>
        </View>

        {pushToken && (
          <View style={styles.tokenContainer}>
            <Text style={styles.tokenLabel}>Push Token:</Text>
            <Text style={styles.tokenValue} numberOfLines={3}>
              {pushToken}
            </Text>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={initializeNotifications}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Initialize Notifications</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={requestPermissions}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Request Permissions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={testRideNotification}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Test Ride Notification</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={testApprovalNotification}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Test Approval Notification</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.testButton]}
            onPress={testRideOfferWithCountdown}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Test Ride Offer with Countdown</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.refreshButton]}
            onPress={checkNotificationStatus}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Refresh Status</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>Instructions:</Text>
          <Text style={styles.infoText}>
            1. Tap "Initialize Notifications" to set up the notification service{'\n'}
            2. If permissions are not granted, tap "Request Permissions"{'\n'}
            3. Use the test buttons to send sample notifications{'\n'}
            4. Check your device's notification panel to see the notifications{'\n'}
            5. Make sure your device is not in Do Not Disturb mode
          </Text>
        </View>

        {/* Auth & Firestore Debugger */}
        <AuthDebugger />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1e1e1e',
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ff9f43',
    textAlign: 'center',
    marginBottom: 30,
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tokenContainer: {
    backgroundColor: '#2a2a2a',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  tokenLabel: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
    marginBottom: 5,
  },
  tokenValue: {
    fontSize: 12,
    color: '#ccc',
    fontFamily: 'monospace',
  },
  buttonContainer: {
    gap: 15,
    marginBottom: 30,
  },
  button: {
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  primaryButton: {
    backgroundColor: '#ff9f43',
  },
  secondaryButton: {
    backgroundColor: '#2196F3',
  },
  testButton: {
    backgroundColor: '#4CAF50',
  },
  refreshButton: {
    backgroundColor: '#9C27B0',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainer: {
    backgroundColor: '#2a2a2a',
    padding: 15,
    borderRadius: 10,
  },
  infoTitle: {
    fontSize: 18,
    color: '#ff9f43',
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#ccc',
    lineHeight: 20,
  },
});

export default NotificationTestScreen; 