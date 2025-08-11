import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import messaging from '@react-native-firebase/messaging';

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
  }

  // Request notification permissions
  async requestPermissions() {
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Failed to get push token for push notification!');
        return false;
      }
      
      return true;
    } else {
      console.log('Must use physical device for Push Notifications');
      return false;
    }
  }

  // Get the Expo push token
  async getExpoPushToken() {
    try {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) return null;

      const token = await Notifications.getExpoPushTokenAsync({
        projectId: '14b90510-8ecb-46b6-9f35-2537774896a1', // Updated to match app.json EAS project ID
      });

      this.expoPushToken = token.data;
      console.log('Expo push token:', this.expoPushToken);
      return this.expoPushToken;
    } catch (error) {
      console.error('Error getting Expo push token:', error);
      return null;
    }
  }

  // Get Firebase Cloud Messaging token
  async getFCMToken() {
    try {
      if (Platform.OS === 'ios') {
        const authStatus = await messaging().requestPermission();
        const enabled =
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
          const token = await messaging().getToken();
          this.fcmToken = token;
          console.log('FCM token:', this.fcmToken);
          return this.fcmToken;
        }
      }
      return null;
    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  // Save both push tokens to Firestore
  async savePushTokenToFirestore() {
    try {
      const user = this.auth.currentUser;
      if (!user) {
        console.log('No user logged in');
        return;
      }

      // Get both tokens
      const expoToken = await this.getExpoPushToken();
      const fcmToken = await this.getFCMToken();

      if (!expoToken && !fcmToken) {
        console.log('No push tokens available');
        return;
      }

      // Save tokens to user's document in Firestore
      const userDocRef = doc(db, 'Drivers', user.uid);
      await setDoc(userDocRef, {
        expoPushToken: expoToken,
        fcmToken: fcmToken,
        tokenUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      console.log('Push tokens saved to Firestore');
    } catch (error) {
      console.error('Error saving push tokens to Firestore:', error);
    }
  }

  // Update push token when user logs in
  async updatePushToken() {
    await this.savePushTokenToFirestore();
  }

  // Remove push token when user logs out
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
  async sendLocalNotification(title, body, data = {}) {
    try {
      // Create notification channel for Android (required for Android 8.0+)
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('ride-requests', {
          name: 'Courses Caval',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF8C00',
          sound: 'default',
          enableVibrate: true,
          enableLights: true,
          description: 'Notifications pour les nouvelles courses et demandes de transport',
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
          bypassDnd: true,
        });
        
        // Add driver approval notification channel
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
        });
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: 'default',
          priority: Notifications.AndroidNotificationPriority.HIGH,
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
      testData
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
      this.handleNotificationReceived
    );

    // Listener for notification responses (when user taps notification)
    const notificationResponseListener = Notifications.addNotificationResponseReceivedListener(
      this.handleNotificationResponse
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
    try {
      // Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        console.log('Notification permissions not granted');
        return false;
      }

      // Get and save push token
      await this.updatePushToken();

      // Set up notification listeners
      const listeners = this.setupNotificationListeners();

      console.log('Notification service initialized successfully');
      return { success: true, listeners };
    } catch (error) {
      console.error('Error initializing notification service:', error);
      return { success: false, error };
    }
  }
}

// Create and export a singleton instance
const notificationService = new NotificationService();
export default notificationService; 