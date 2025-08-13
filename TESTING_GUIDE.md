# Testing Guide for Deployed Cloud Functions

## 🚀 **System Status: DEPLOYED AND READY**

### **Deployed Functions:**
- ✅ `sendNewRideNotification` - New ride requests
- ✅ `handleDriverSelection` - 15-second countdown offers
- ✅ `handleOfferAcceptance` - Accept offers
- ✅ `handleOfferRejection` - Reject offers
- ✅ `sendDriverApprovalNotification` - Driver approvals
- ✅ `updateOnlineDrivers` - Online driver tracking
- ✅ `maintainOnlineDriverDocument` - Real-time updates
- ✅ `cleanupOfflineDrivers` - Cleanup tasks
- ✅ `scheduledCleanupOfflineDrivers` - Scheduled cleanup
- ✅ `testWhatsAppIntegration` - WhatsApp testing

## 📋 **Pre-Testing Checklist**

### **1. Create Missing Firestore Index**
**IMPORTANT**: Before testing, create this index in Firebase Console:

**Direct Link:**
```
https://console.firebase.google.com/v1/r/project/eco-share-92ef1/firestore/indexes?create_composite=Ck9wcm9qZWN0cy9lY28tc2hhcmUtOTJlZjEvZGF0YWJhc2VzLyhkZWZhdWx0KS9jb2xsZWN0aW9uR3JvdXBzL0RyaXZlcnMvaW5kZXhlcy9fEAEaDgoKZHJpdmVyVHlwZRABGgwKCGlzT25saW5lEAEaEgoOcmlkZUluUHJvZ3Jlc3MQARoPCgtpc0F2YWlsYWJsZRABGgwKCF9fbmFtZV9fEAE
```

**Manual Steps:**
1. Go to Firebase Console → Firestore Database → Indexes
2. Click "Create Index"
3. Collection ID: `Drivers`
4. Add fields:
   - `driverType` (Ascending)
   - `isOnline` (Ascending)
   - `rideInProgress` (Ascending)
   - `isAvailable` (Ascending)
   - `__name__` (Ascending)
5. Click "Create"

### **2. Verify Driver Data**
Ensure you have at least one driver with:
- `isOnline: true`
- `isAvailable: true`
- `rideInProgress: false`
- `driverType: "car"` (or your ride type)
- `expoPushToken` (for notifications)
- `phoneNumber` (for WhatsApp)

## 🧪 **Testing Steps**

### **Test 1: WhatsApp Integration**
```bash
# Test WhatsApp function directly
curl -X POST https://us-central1-eco-share-92ef1.cloudfunctions.net/testWhatsAppIntegration
```

**Expected Result:** WhatsApp message sent to test number

### **Test 2: Ride Offer with Countdown**
1. **In your app**: Go to Profile → Test Notifications
2. **Tap**: "Test Ride Offer with Countdown"
3. **Expected Result**: 
   - Ride offer modal appears
   - 15-second countdown starts
   - Accept/Reject buttons work

### **Test 3: Real Ride Request Flow**
1. **Create a ride request** in Firestore:
   ```javascript
   {
     status: "waiting",
     rideType: "car",
     fare: 25.00,
     pickupAddress: "Test Pickup",
     destinationAddress: "Test Destination",
     customerName: "Test Customer",
     customerPhone: "+1234567890",
     createdAt: new Date()
   }
   ```

2. **Expected Flow**:
   - Cloud function triggers
   - Driver selected
   - DriverSelection document created
   - Push notification sent
   - WhatsApp message sent
   - 15-second countdown starts
   - Offer modal appears in app

### **Test 4: Accept/Reject Flow**
1. **Accept Offer**:
   - Tap "Accepter" in modal
   - Expected: Ride status → "assigned"
   - Driver status → rideInProgress: true

2. **Reject Offer**:
   - Tap "Refuser" in modal
   - Expected: Ride status → "waiting_for_next_driver"

3. **Let Expire**:
   - Wait 15 seconds
   - Expected: Ride status → "waiting_for_next_driver"

## 🔍 **Monitoring & Debugging**

### **View Function Logs**
```bash
# All functions
npx firebase functions:log

# Specific function
npx firebase functions:log --only handleDriverSelection

# Real-time logs
npx firebase functions:log --follow
```

### **Check Firestore Data**
1. **Firebase Console** → Firestore Database
2. **Collections to monitor**:
   - `rideRequests` - Ride status changes
   - `DriverSelection` - Offer lifecycle
   - `Drivers` - Driver status updates
   - `OnlineDriver` - Online driver tracking

### **Test Function URLs**
- **WhatsApp Test**: `https://us-central1-eco-share-92ef1.cloudfunctions.net/testWhatsAppIntegration`

## 🐛 **Common Issues & Solutions**

### **Issue 1: "The query requires an index"**
**Solution**: Create the missing index (see step 1 above)

### **Issue 2: "No eligible drivers found"**
**Solution**: 
- Check driver data in Firestore
- Ensure `isOnline: true`, `isAvailable: true`
- Verify `driverType` matches ride request

### **Issue 3: Notifications not received**
**Solution**:
- Check `expoPushToken` in driver document
- Verify notification permissions in app
- Check device notification settings

### **Issue 4: WhatsApp not working**
**Solution**:
- Verify phone number format (+253...)
- Check UltraMsg API status
- Test with WhatsApp test function

## 📊 **Expected Data Flow**

```
1. Ride Request Created
   ↓
2. handleDriverSelection triggers
   ↓
3. Driver selected & DriverSelection created
   ↓
4. Push notification + WhatsApp sent
   ↓
5. App shows offer modal (15s countdown)
   ↓
6. Driver accepts/rejects OR expires
   ↓
7. Ride status updated accordingly
```

## ✅ **Success Criteria**

- ✅ Cloud functions deployed without errors
- ✅ Firestore indexes created
- ✅ WhatsApp test function works
- ✅ Ride offer modal appears with countdown
- ✅ Accept/Reject functionality works
- ✅ Real-time status updates work
- ✅ Notifications received on device

## 🚀 **Production Readiness**

Once testing is complete:
1. **Remove test functions** if not needed
2. **Update phone numbers** to real ones
3. **Configure proper error handling**
4. **Set up monitoring alerts**
5. **Test with real users**

---

**Need Help?** Check the logs: `npx firebase functions:log` 