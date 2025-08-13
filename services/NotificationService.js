import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert, NativeModules, NativeEventEmitter } from 'react-native';
import { auth } from '../config/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationService {
  constructor() {
    this.expoPushToken = null;
    this.fcmToken = null;
    this.auth = auth;
    this.isInitialized = false;
    this.fcmTokenModule = null;
    this.fcmEventEmitter = null;
    
    // Initialize FCM module for Android
    if (Platform.OS === 'android' && NativeModules.FCMTokenModule) {
      this.fcmTokenModule = NativeModules.FCMTokenModule;
      this.fcmEventEmitter = new NativeEventEmitter(NativeModules.FCMTokenModule);
      this.setupFCMListeners();
    }
  }

  // Setup FCM token listeners
  setupFCMListeners() {
    if (!this.fcmEventEmitter) return;

    // Listen for FCM token received
    this.fcmEventEmitter.addListener('FCMTokenReceived', (data) => {
      console.log('FCM token received:', data.token);
      this.fcmToken = data.token;
      this.savePushTokenToFirestore();
    });

    // Listen for FCM token refresh
    this.fcmEventEmitter.addListener('FCMTokenRefreshed', (data) => {
      console.log('FCM token refreshed:', data.token);
      this.fcmToken = data.token;
      this.savePushTokenToFirestore();
    });
  }

  // Request notification permissions with Android 13+ support
  async requestPermissions() {
    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return false;
    }

    try {
      // Check current permission status
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      // If permission not granted, request it
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true,
          },
          android: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
            allowAnnouncements: true,
          },
        });
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable notifications in your device settings to receive ride requests and important updates.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => this.openAppSettings() }
          ]
        );
        return false;
      }
      
      console.log('Notification permissions granted');
      return true;
    } catch (error) {
      console.error('Error requesting notification permissions:', error);
      return false;
    }
  }

  // Open app settings for manual permission enable
  async openAppSettings() {
    if (Platform.OS === 'ios') {
      // For iOS, you can use Linking to open settings
      const { Linking } = require('react-native');
      await Linking.openSettings();
    } else {
      // For Android, show instructions
      Alert.alert(
        'Enable Notifications',
        'Go to Settings > Apps > Caval Courrier > Notifications and enable all notification options.',
        [{ text: 'OK' }]
      );
    }
  }

  // Create Android notification channels
  async createAndroidChannels() {
    if (Platform.OS !== 'android') return;

    try {
      // Main ride requests channel
      await Notifications.setNotificationChannelAsync('ride-requests', {
        name: 'Course Caval',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF8C00',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        description: 'Notifications pour les nouvelles courses et demandes de transport',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        showBadge: true,
      });
      
      // Driver approval channel
      await Notifications.setNotificationChannelAsync('driver-approval', {
        name: 'Approbation Chauffeur',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#4CAF50',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        description: 'Notifications pour l\'approbation des comptes chauffeurs',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        showBadge: true,
      });

      // General notifications channel
      await Notifications.setNotificationChannelAsync('general', {
        name: 'Notifications Générales',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250],
        lightColor: '#2196F3',
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        description: 'Notifications générales de l\'application',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        showBadge: true,
      });

      console.log('Android notification channels created successfully');
    } catch (error) {
      console.error('Error creating Android notification channels:', error);
    }
  }

  // Get the Expo push token
  async getExpoPushToken() {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const token = await Notifications.getExpoPushTokenAsync({
        projectId: '14b90510-8ecb-46b6-9f35-2537774896a1',
      });

      this.expoPushToken = token.data;
      console.log('Expo push token:', this.expoPushToken);
      return this.expoPushToken;
    } catch (error) {
      console.error('Error getting Expo push token:', error);
      return null;
    }
  }

  // Get FCM token for Android using native module
  async getFCMToken() {
    if (Platform.OS !== 'android' || !this.fcmTokenModule) return null;
    
    try {
      const token = await this.fcmTokenModule.getFCMToken();
      this.fcmToken = token;
      console.log('FCM token received from native module:', token);
      return token;
    } catch (error) {
      console.error('Error getting FCM token from native module:', error);
      return null;
    }
  }

  // Save the push tokens to Firestore
  async savePushTokenToFirestore() {
    try {
      const user = this.auth.currentUser;
      if (!user) {
        console.log('No user logged in');
        return;
      }

      const expoToken = await this.getExpoPushToken();
      const fcmToken = await this.getFCMToken();
      
      if (!expoToken && !fcmToken) {
        console.log('No push tokens available');
        return;
      }

      // Save tokens to user's document in Firestore
      const userDocRef = doc(db, 'Drivers', user.uid);
      const tokenData = {
        tokenUpdatedAt: new Date().toISOString(),
        platform: Platform.OS,
        appVersion: '1.0.2', // Update this with your app version
      };

      if (expoToken) {
        tokenData.expoPushToken = expoToken;
      }
      
      if (fcmToken) {
        tokenData.fcmToken = fcmToken;
      }

      await setDoc(userDocRef, tokenData, { merge: true });

      console.log('Push tokens saved to Firestore:', { expoToken, fcmToken });
    } catch (error) {
      console.error('Error saving push tokens to Firestore:', error);
    }
  }

  // Update push tokens when user logs in
  async updatePushToken() {
    await this.savePushTokenToFirestore();
  }

  // Remove push tokens when user logs out
  async removePushToken() {
    try {
      const user = this.auth.currentUser;
      if (!user) return;

      const userDocRef = doc(db, 'Drivers', user.uid);
      await setDoc(userDocRef, {
        expoPushToken: null,
        fcmToken: null,
        tokenUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      console.log('Push tokens removed from Firestore');
    } catch (error) {
      console.error('Error removing push tokens:', error);
    }
  }

  // Send local notification for testing
  async sendLocalNotification(title, body, data = {}, channelId = 'ride-requests') {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.HIGH,
          channelId: Platform.OS === 'android' ? channelId : undefined,
        },
        trigger: null, // Send immediately
      });
      
      console.log('Local notification sent successfully');
    } catch (error) {
      console.error('Error sending local notification:', error);
    }
  }

  // Send test notification with ride request data
  async sendTestRideNotification() {
    const testData = {
      type: 'ride_request',
      rideId: 'test-ride-123',
      driverId: auth.currentUser?.uid || 'test-driver',
      fare: '25.00',
      pickupAddress: '123 Test Street',
      destinationAddress: '456 Test Avenue',
    };

    await this.sendLocalNotification(
      '🎯 Course assignée!',
      'Vous avez été sélectionné pour une nouvelle course. Ouvrez l\'app pour voir les détails.',
      testData,
      'ride-requests'
    );
  }

  // Send test approval notification
  async sendTestApprovalNotification() {
    const testData = {
      type: 'driver_approval',
      status: 'approved',
      message: 'Votre compte chauffeur a été approuvé!',
    };

    await this.sendLocalNotification(
      '✅ Compte Approuvé!',
      'Félicitations! Votre compte chauffeur a été approuvé. Vous pouvez maintenant commencer à recevoir des courses.',
      testData,
      'driver-approval'
    );
  }

  // Handle notification received while app is in foreground
  async handleNotificationReceived(notification) {
    console.log('Notification received:', notification);
    
    // Handle different types of notifications
    const { title, body, data } = notification.request.content;
    
    if (data?.type === 'ride_request') {
      // Handle ride request notification
      console.log('Ride request received:', data);
      // You can add custom logic here, like updating UI state
    } else if (data?.type === 'driver_approval') {
      // Handle driver approval notification
      console.log('Driver approval notification received:', data);
    }
  }

  // Handle notification response (when user taps notification)
  async handleNotificationResponse(response) {
    console.log('Notification response:', response);
    
    const { data } = response.notification.request.content;
    
    if (data?.type === 'ride_request') {
      // Navigate to ride request screen or handle the ride request
      console.log('User tapped ride request notification:', data);
      // You can add navigation logic here
    } else if (data?.type === 'driver_approval') {
      // Handle driver approval notification
      console.log('User tapped driver approval notification:', data);
      if (data?.status === 'approved') {
        // Navigate to home screen or show success message
        console.log('Driver account approved');
      } else if (data?.status === 'rejected') {
        // Show rejection message or navigate to support
        console.log('Driver account rejected');
      }
    }
  }

  // Set up notification listeners
  setupNotificationListeners() {
    // Listener for notifications received while app is in foreground
    const notificationReceivedListener = Notifications.addNotificationReceivedListener(
      this.handleNotificationReceived.bind(this)
    );

    // Listener for notification responses (when user taps notification)
    const notificationResponseListener = Notifications.addNotificationResponseReceivedListener(
      this.handleNotificationResponse.bind(this)
    );

    return {
      notificationReceivedListener,
      notificationResponseListener,
    };
  }

  // Clean up notification listeners
  removeNotificationListeners(listeners) {
    if (listeners?.notificationReceivedListener) {
      Notifications.removeNotificationSubscription(listeners.notificationReceivedListener);
    }
    if (listeners?.notificationResponseListener) {
      Notifications.removeNotificationSubscription(listeners.notificationResponseListener);
    }
  }

  // Initialize the notification service
  async initialize() {
    if (this.isInitialized) {
      console.log('Notification service already initialized');
      return { success: true, listeners: null };
    }

    try {
      console.log('Initializing notification service...');
      
      // Create Android channels first
      await this.createAndroidChannels();

      // Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.log('Notification permissions not granted');
        return { success: false, error: 'Permissions not granted' };
      }

      // Get and save push token
      await this.updatePushToken();

      // Set up notification listeners
      const listeners = this.setupNotificationListeners();

      this.isInitialized = true;
      console.log('Notification service initialized successfully');
      return { success: true, listeners };
    } catch (error) {
      console.error('Error initializing notification service:', error);
      return { success: false, error };
    }
  }

  // Check if notifications are enabled
  async checkNotificationStatus() {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted';
    } catch (error) {
      console.error('Error checking notification status:', error);
      return false;
    }
  }

  // Get all scheduled notifications
  async getScheduledNotifications() {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
      return [];
    }
  }

  // Cancel all scheduled notifications
  async cancelAllNotifications() {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('All scheduled notifications cancelled');
    } catch (error) {
      console.error('Error cancelling notifications:', error);
    }
  }
}

// Create and export a singleton instance
const notificationService = new NotificationService();
export default notificationService; 