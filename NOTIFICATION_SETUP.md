# Push Notification Setup for Caval Driver App

This document explains how to set up push notifications for ride requests in the Caval Driver app.

## Overview

The notification system allows drivers to receive push notifications when they are assigned a ride request, even when the app is in the background or closed.

## Components

### 1. Client-Side (React Native App)

- **NotificationService.js**: Handles notification permissions, token management, and local notifications
- **App.js**: Initializes the notification service when user logs in
- **SettingsScreen.js**: Provides notification settings and test functionality

### 2. Server-Side (Firebase Cloud Functions)

- **functions/index.js**: Contains Cloud Functions that send push notifications to drivers when ride requests are assigned

## Setup Instructions

### 1. Install Dependencies

```bash
npm install expo-notifications
```

### 2. Configure Firebase Cloud Messaging

1. Go to your Firebase Console
2. Navigate to Project Settings > Cloud Messaging
3. Generate a new Server Key (if not already done)
4. Note your Sender ID (found in project settings)

### 3. Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

### 4. Update Expo Project ID

In `services/NotificationService.js`, update the `projectId` in the `getExpoPushTokenAsync` call to match your Expo project ID.

### 5. Build and Test

1. Build the app for your target platform:
   ```bash
   expo build:android
   expo build:ios
   ```

2. Test notifications using the "Test Notification" button in Settings

## How It Works

### 1. Token Registration
- When a driver logs in, the app requests notification permissions
- If granted, it gets an Expo push token
- The token is saved to the driver's Firestore document

### 2. Ride Request Assignment
- When a ride request is created, the Cloud Function finds the closest available driver
- It sends a push notification to the assigned driver using their stored token

### 3. Notification Handling
- If the app is in the foreground, the notification is handled by the app
- If the app is in the background or closed, the system displays the notification
- When the user taps the notification, the app opens and can handle the ride request

## Testing

### Local Testing
1. Use the "Test Notification" button in Settings
2. This sends a local notification to verify the setup works

### Real Testing
1. Create a ride request through the passenger app
2. Verify the assigned driver receives a push notification
3. Check that tapping the notification opens the app correctly

## Troubleshooting

### Common Issues

1. **No notifications received**
   - Check that notification permissions are granted
   - Verify the push token is saved in Firestore
   - Check Cloud Function logs for errors

2. **Notifications not showing when app is closed**
   - Ensure the app is built with the correct notification configuration
   - Check that background modes are enabled in app.json

3. **Cloud Functions not deploying**
   - Verify Firebase CLI is installed and logged in
   - Check that the functions directory has the correct dependencies

### Debug Steps

1. Check notification permissions:
   ```javascript
   const { status } = await Notifications.getPermissionsAsync();
   console.log('Notification permission status:', status);
   ```

2. Verify push token:
   ```javascript
   const token = await Notifications.getExpoPushTokenAsync({
     projectId: 'your-project-id'
   });
   console.log('Push token:', token.data);
   ```

3. Check Firestore for saved tokens:
   ```javascript
   const driverDoc = await getDoc(doc(db, 'Drivers', userId));
   console.log('Driver push token:', driverDoc.data()?.pushToken);
   ```

## Security Considerations

- Push tokens are stored securely in Firestore
- Notifications are sent only to authenticated drivers
- Sensitive data in notifications is minimized
- Cloud Functions include proper error handling

## Future Enhancements

- Add notification preferences (sound, vibration, etc.)
- Implement notification history
- Add support for different notification types (ride updates, earnings, etc.)
- Implement notification grouping for multiple ride requests 