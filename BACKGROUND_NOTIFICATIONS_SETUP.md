# Background Notifications Setup for Android Development Builds

This guide explains how to set up background notifications for drivers when they're not in the app.

## What Was Fixed

1. **Added Firebase Cloud Messaging Service** - Handles background notifications on Android
2. **Created Native FCM Token Module** - Gets FCM tokens from Android system
3. **Updated Notification Service** - Now handles both Expo and FCM tokens
4. **Enhanced Cloud Functions** - Prioritizes FCM for Android devices
5. **Updated Android Configuration** - Proper notification channels and permissions

## Files Modified/Created

### New Files:
- `android/app/src/main/java/com/misscoding/ecoshare/MyFirebaseMessagingService.java`
- `android/app/src/main/java/com/misscoding/ecoshare/FCMTokenModule.java`
- `android/app/src/main/java/com/misscoding/ecoshare/FCMTokenPackage.java`

### Modified Files:
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/misscoding/ecoshare/MainApplication.kt`
- `services/NotificationService.js`
- `functions/index.js`
- `app.json`

## Building the App

### 1. Clean Build (Recommended)
```bash
# Clean previous builds
cd android
./gradlew clean
cd ..

# Remove node_modules and reinstall
rm -rf node_modules
yarn install

# Build for Android
eas build --platform android --profile development
```

### 2. Quick Build (If clean build fails)
```bash
# Build directly
eas build --platform android --profile development
```

## Testing Background Notifications

### 1. Install the Development Build
- Install the APK on your Android device
- Grant all necessary permissions (notifications, location, etc.)

### 2. Test Notification Flow
1. **Login as a driver** - This will register FCM and Expo tokens
2. **Put the app in background** - Press home button or switch to another app
3. **Create a ride request** - From passenger app or admin panel
4. **Check notification delivery** - Driver should receive notification even when app is closed

### 3. Verify Token Registration
Check Firestore `Drivers` collection for your driver document:
```json
{
  "expoPushToken": "ExponentPushToken[...]",
  "fcmToken": "fMEP0vNqS6:APA91b[...]",
  "platform": "android",
  "tokenUpdatedAt": "2025-01-13T20:26:22.000Z"
}
```

## Troubleshooting

### Common Issues:

1. **No notifications received**
   - Check notification permissions in device settings
   - Verify tokens are saved in Firestore
   - Check Cloud Function logs for errors

2. **Build errors**
   - Ensure all Java files are in correct package structure
   - Check that MainApplication.kt includes FCMTokenPackage
   - Verify google-services.json is in android/app/

3. **FCM token not generated**
   - Check Firebase console for proper configuration
   - Verify google-services.json has correct package name
   - Check device has Google Play Services

### Debug Steps:

1. **Check logs:**
   ```bash
   # View Android logs
   adb logcat | grep -E "(FCM|Notification|Firebase)"
   
   # View Cloud Function logs
   firebase functions:log
   ```

2. **Verify FCM setup:**
   - Check Firebase console > Project Settings > Cloud Messaging
   - Ensure Server key is generated
   - Verify package name matches your app

3. **Test notification manually:**
   - Use Firebase console to send test message
   - Use Expo push notification tool for Expo tokens

## How It Works Now

### 1. **Token Registration**
- App starts → Requests notification permissions
- Native FCM module gets FCM token from Android system
- Expo module gets Expo push token
- Both tokens saved to Firestore

### 2. **Notification Delivery**
- **Android + FCM token available**: Uses FCM (best for background)
- **Fallback**: Uses Expo push notifications
- **Final fallback**: WhatsApp message (if configured)

### 3. **Background Handling**
- FCM service runs in background on Android
- Receives notifications even when app is closed
- Shows system notification with proper channel settings
- Tapping notification opens app with ride details

## Performance Notes

- **FCM is prioritized** for Android devices (better background delivery)
- **Expo notifications** work as fallback for all platforms
- **WhatsApp messages** provide additional reliability
- **Token refresh** happens automatically when FCM token changes

## Security Considerations

- FCM tokens are stored securely in Firestore
- Only authenticated drivers receive notifications
- Sensitive data is minimized in notification payloads
- Proper error handling prevents token exposure

## Next Steps

1. **Test thoroughly** with different app states (foreground, background, closed)
2. **Monitor Cloud Function logs** for any errors
3. **Verify notification delivery** in various network conditions
4. **Consider adding** notification preferences and history features

## Support

If you encounter issues:
1. Check this guide first
2. Review Firebase console logs
3. Check Android device logs
4. Verify all files are properly configured 