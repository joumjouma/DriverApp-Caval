# Debugging Notification Issues

## 🔍 **Current Problem:**
- Test notifications work perfectly
- Real ride notifications don't work
- Drivers don't receive notifications when selected for rides

## 🚀 **What We Fixed:**

1. **Removed Duplicate Functions**: Commented out `sendNewRideNotification` that was conflicting with `selectBestDriverForRide`
2. **Enhanced Debugging**: Added admin WhatsApp notifications to track the entire flow
3. **Better Token Handling**: Now checks for both FCM and Expo tokens
4. **Improved Error Logging**: More detailed logs for troubleshooting

## 📱 **Testing Steps:**

### 1. **Deploy Updated Cloud Functions:**
```bash
cd functions
firebase deploy --only functions
```

### 2. **Test the Flow:**
1. **Create a ride request** (from passenger app or admin panel)
2. **Check admin WhatsApp** - You should receive multiple messages:
   - 🚀 Fonction déclenchée! (Function triggered)
   - 👤 Chauffeur sélectionné! (Driver selected)
   - ✅ Notification envoyée! (Notification sent) OR ❌ Notification échouée! (Failed)

### 3. **Check Firebase Console:**
- Go to Functions > Logs
- Look for logs from `selectBestDriverForRide`
- Check for any errors

### 4. **Verify Driver Tokens:**
- Check Firestore `Drivers` collection
- Look for your driver document
- Verify both `expoPushToken` and `fcmToken` are present

## 🐛 **Common Issues & Solutions:**

### **Issue 1: Function Not Triggered**
**Symptoms:** No admin WhatsApp messages
**Solution:** Check if ride request is created with status "waiting"

### **Issue 2: No Drivers Found**
**Symptoms:** ❌ Pas de chauffeurs! message
**Solution:** Ensure driver is online and has correct `driverType`

### **Issue 3: No Tokens Available**
**Symptoms:** ⚠️ Pas de tokens! message
**Solution:** Check if driver has logged in and tokens were saved

### **Issue 4: Notification Failed**
**Symptoms:** ❌ Notification échouée! message
**Solution:** Check Cloud Function logs for specific error details

## 📊 **Debugging Commands:**

### **Check Cloud Function Logs:**
```bash
firebase functions:log --only selectBestDriverForRide
```

### **Check Android Logs:**
```bash
adb logcat | grep -E "(FCM|Notification|Firebase|MyFirebaseMsgService)"
```

### **Check Firestore Data:**
```javascript
// In Firebase Console > Firestore
// Check these collections:
// 1. rideRequests - for ride data
// 2. Drivers - for driver tokens
// 3. SelectedDriver - for selection data
```

## 🔧 **Manual Testing:**

### **Test 1: Create Ride Request**
```javascript
// In Firebase Console > Firestore
// Add document to rideRequests collection:
{
  status: "waiting",
  rideType: "car", // or whatever type your driver supports
  pickupAddress: "Test Address",
  destinationAddress: "Test Destination",
  fare: 1000,
  customerName: "Test Customer",
  customerPhone: "+25377702036"
}
```

### **Test 2: Check Driver Status**
```javascript
// In Drivers collection, ensure your driver has:
{
  isOnline: true,
  driverType: "car", // same as ride request
  expoPushToken: "ExponentPushToken[...]",
  fcmToken: "fMEP0vNqS6:APA91b[...]",
  platform: "android"
}
```

## 📋 **Expected Flow:**

1. **Ride Request Created** → Admin gets "🚀 Fonction déclenchée!"
2. **Driver Found** → Admin gets "👤 Chauffeur sélectionné!"
3. **Notification Sent** → Admin gets "✅ Notification envoyée!" or error details
4. **Driver Receives** → Push notification on device

## 🆘 **If Still Not Working:**

1. **Check Cloud Function logs** for errors
2. **Verify driver tokens** in Firestore
3. **Test with different driver** (different device)
4. **Check notification permissions** on device
5. **Verify FCM setup** in Firebase console

## 📞 **Support:**

If issues persist, provide:
- Cloud Function logs
- Driver document data from Firestore
- Admin WhatsApp messages received
- Device notification settings 