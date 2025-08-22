import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Alert } from 'react-native';
import { auth } from '../config/firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

// Configure notification behavior for both foreground and background
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    console.log('📱 Notification received in handler:', notification);
    
    // Always show notifications, even in background
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowAlert: true, // Explicitly ensure alerts show
    };
  },
});

class NotificationService {
  constructor() {
    this.expoPushToken = null;
    this.auth = auth;
    this.isInitialized = false;
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
        // Critical for background notifications
        allowBubbles: true,
        enableVibration: true,
        enableLights: true,
        // Ensure notifications show in background
        importance: Notifications.AndroidImportance.HIGH,
        // Allow notifications when app is in background
        allowBubbles: true,
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
        // Critical for background notifications
        allowBubbles: true,
        enableVibration: true,
        enableLights: true,
        // Ensure notifications show in background
        importance: Notifications.AndroidImportance.HIGH,
        // Allow notifications when app is in background
        allowBubbles: true,
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
        // Critical for background notifications
        allowBubbles: true,
        enableVibration: true,
        enableLights: true,
        // Ensure notifications show in background
        importance: Notifications.AndroidImportance.DEFAULT,
        // Allow notifications when app is in background
        allowBubbles: true,
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

  // Save the push token to Firestore
  async savePushTokenToFirestore() {
    try {
      const user = this.auth.currentUser;
      if (!user) {
        console.log('No user logged in');
        return;
      }

      const token = await this.getExpoPushToken();
      if (!token) {
        console.log('No push token available');
        return;
      }

      // Save token to user's document in Firestore
      const userDocRef = doc(db, 'Drivers', user.uid);
      await setDoc(userDocRef, {
        expoPushToken: token,
        tokenUpdatedAt: new Date().toISOString(),
        platform: Platform.OS,
        appVersion: '1.0.2', // Update this with your app version
      }, { merge: true });

      console.log('Push token saved to Firestore');
    } catch (error) {
      console.error('Error saving push token to Firestore:', error);
    }
  }

  // Update push token and save to Firestore
  async updatePushToken() {
    try {
      if (!Device.isDevice) {
        console.log('Must use physical device for Push Notifications');
        return null;
      }

      // Get the push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: '97f35a2b-2bbf-4893-9f43-cd2df775196a', // Your Expo project ID
      });

      if (token?.data) {
        this.expoPushToken = token.data;
        console.log('✅ Expo push token obtained:', this.expoPushToken.substring(0, 20) + '...');

        // Save token to Firestore if user is authenticated
        if (auth.currentUser) {
          try {
            const driverRef = doc(db, "Drivers", auth.currentUser.uid);
            
            // First try to update the existing document
            try {
              await updateDoc(driverRef, {
                expoPushToken: this.expoPushToken,
                lastTokenUpdate: new Date().toISOString(),
                tokenPlatform: Platform.OS,
                tokenDevice: Device.modelName || 'Unknown',
                tokenVersion: '2.0', // Add version to track token updates
                tokenStatus: 'active'
              });
              console.log('✅ Push token updated in Firestore successfully');
            } catch (updateError) {
              console.log('⚠️ Update failed, trying to set with merge...');
              
              // If update fails, try to set with merge (creates if doesn't exist)
              await setDoc(driverRef, {
                expoPushToken: this.expoPushToken,
                lastTokenUpdate: new Date().toISOString(),
                tokenPlatform: Platform.OS,
                tokenDevice: Device.modelName || 'Unknown',
                tokenVersion: '2.0',
                tokenStatus: 'active'
              }, { merge: true });
              console.log('✅ Push token saved to Firestore using merge');
            }
            
            // Also save to a separate tokens collection for backup
            try {
              const tokenRef = doc(db, "DriverPushTokens", auth.currentUser.uid);
              await setDoc(tokenRef, {
                driverId: auth.currentUser.uid,
                expoPushToken: this.expoPushToken,
                fcmToken: null, // Will be updated if FCM is used
                lastUpdated: new Date().toISOString(),
                platform: Platform.OS,
                device: Device.modelName || 'Unknown',
                appVersion: '1.0.2',
                isActive: true
              }, { merge: true });
              console.log('✅ Push token also saved to backup collection');
            } catch (backupError) {
              console.log('⚠️ Backup token save failed (non-critical):', backupError.message);
            }
            
          } catch (firestoreError) {
            console.error('❌ Critical error saving push token to Firestore:', firestoreError);
            
            // Try one more time with a simpler approach
            try {
              const driverRef = doc(db, "Drivers", auth.currentUser.uid);
              await setDoc(driverRef, {
                expoPushToken: this.expoPushToken,
                lastTokenUpdate: new Date().toISOString()
              }, { merge: true });
              console.log('✅ Push token saved with minimal data');
            } catch (finalError) {
              console.error('❌ Final attempt to save push token failed:', finalError);
            }
          }
        } else {
          console.log('⚠️ No authenticated user, push token not saved to Firestore');
        }

        return this.expoPushToken;
      } else {
        console.error('❌ Failed to get push token');
        return null;
      }
    } catch (error) {
      console.error('❌ Error updating push token:', error);
      return null;
    }
  }

  // Remove push token when user logs out
  async removePushToken() {
    try {
      const user = this.auth.currentUser;
      if (!user) return;

      const userDocRef = doc(db, 'Drivers', user.uid);
      await setDoc(userDocRef, {
        expoPushToken: null,
        tokenUpdatedAt: new Date().toISOString(),
      }, { merge: true });

      console.log('Push token removed from Firestore');
    } catch (error) {
      console.error('Error removing push token:', error);
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

  // Handle notification received while app is in foreground
  async handleNotificationReceived(notification) {
    console.log('📱 Notification received in foreground:', notification);
    
    // Handle different types of notifications
    const { title, body, data } = notification.request.content;
    
    if (data?.type === 'ride_request' || data?.type === 'new_ride_offer') {
      // Handle ride request notification
      console.log('🚗 Ride request received in foreground:', data);
      // You can add custom logic here, like updating UI state
    } else if (data?.type === 'driver_approval') {
      // Handle driver approval notification
      console.log('✅ Driver approval notification received in foreground:', data);
    }
    
    // Always return true to show the notification
    return true;
  }

  // Handle notification response (when user taps notification)
  async handleNotificationResponse(response) {
    console.log('📱 Notification response received:', response);
    
    const { data } = response.notification.request.content;
    
    if (data?.type === 'ride_request' || data?.type === 'new_ride_offer') {
      // Handle ride request notification
      console.log('🚗 User tapped ride request notification:', data);
      
      // Navigate to the appropriate screen based on the notification data
      try {
        // Import navigation dynamically to avoid circular dependencies
        const { CommonActions } = await import('@react-navigation/native');
        
        // Navigate to home screen where the ride offer will be processed
        if (global.navigationRef?.current) {
          global.navigationRef.current.dispatch(
            CommonActions.navigate({
              name: 'Home',
              params: {
                notificationRideId: data.rideId,
                fromNotification: true
              }
            })
          );
          console.log('✅ Navigated to Home screen from notification');
        } else {
          console.log('⚠️ Navigation ref not available, cannot navigate from notification');
        }
      } catch (navigationError) {
        console.error('❌ Error navigating from notification:', navigationError);
      }
      
    } else if (data?.type === 'driver_approval') {
      // Handle driver approval notification
      console.log('✅ User tapped driver approval notification:', data);
      if (data?.status === 'approved') {
        // Navigate to home screen or show success message
        console.log('Driver account approved');
        try {
          const { CommonActions } = await import('@react-navigation/native');
          if (global.navigationRef?.current) {
            global.navigationRef.current.dispatch(
              CommonActions.navigate({
                name: 'Home',
                params: { accountApproved: true }
              })
            );
          }
        } catch (navError) {
          console.error('Error navigating after approval:', navError);
        }
      } else if (data?.status === 'rejected') {
        // Show rejection message or navigate to support
        console.log('Driver account rejected');
        try {
          const { CommonActions } = await import('@react-navigation/native');
          if (global.navigationRef?.current) {
            global.navigationRef.current.dispatch(
              CommonActions.navigate({
                name: 'ApprovalStatusScreen',
                params: { status: 'rejected' }
              })
            );
          }
        } catch (navError) {
          console.error('Error navigating after rejection:', navError);
        }
      }
    } else {
      console.log('Unknown notification type:', data?.type);
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

  // Check current push token status
  async checkPushTokenStatus() {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        return { hasUser: false, hasToken: false, token: null, error: 'No authenticated user' };
      }

      // Check local token
      const localToken = this.expoPushToken;
      
      // Check Firestore token
      const driverRef = doc(db, "Drivers", currentUser.uid);
      const driverDoc = await getDoc(driverRef);
      
      if (!driverDoc.exists()) {
        return { hasUser: true, hasToken: false, token: null, error: 'Driver document not found' };
      }
      
      const driverData = driverDoc.data();
      const firestoreToken = driverData.expoPushToken;
      
      // Check backup collection
      let backupToken = null;
      try {
        const tokenRef = doc(db, "DriverPushTokens", currentUser.uid);
        const tokenDoc = await getDoc(tokenRef);
        if (tokenDoc.exists()) {
          backupToken = tokenDoc.data().expoPushToken;
        }
      } catch (backupError) {
        console.log('Could not check backup token collection:', backupError.message);
      }
      
      return {
        hasUser: true,
        hasToken: !!(localToken || firestoreToken || backupToken),
        localToken: localToken,
        firestoreToken: firestoreToken,
        backupToken: backupToken,
        lastUpdate: driverData.lastTokenUpdate || driverData.tokenUpdatedAt,
        platform: driverData.tokenPlatform || driverData.platform,
        device: driverData.tokenDevice || driverData.device,
        status: 'active'
      };
      
    } catch (error) {
      console.error('Error checking push token status:', error);
      return { hasUser: false, hasToken: false, token: null, error: error.message };
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