# Driver Arrival Notifications System

This document explains the comprehensive notification system implemented for the Caval Driver app, including the new driver arrival notifications and WhatsApp integration using UltraMsg.

## Overview

The system now sends both **push notifications** and **WhatsApp messages** for various ride status changes, ensuring reliable communication between drivers and passengers.

## New Notification Types

### 1. Driver Arrived Notifications (`driver_arrived`)

**Triggered when:** Ride status changes to "driver_arrived"
**Recipients:** Passenger
**Channels:** Push notification + WhatsApp message

**Push Notification:**
- Title: "🚗 Chauffeur arrivé!"
- Body: "Votre chauffeur [DriverName] est arrivé au point de départ."

**WhatsApp Message:**
```
🚗 *Chauffeur arrivé!*

Bonjour [PassengerName],

Votre chauffeur [DriverName] est arrivé au point de départ!

📍 *Point de départ:* [PickupAddress]
🎯 *Destination:* [DestinationAddress]
💰 *Prix:* Fdj[Fare]

⏰ *Temps de trajet estimé:* ~[EstimatedTime] min

*Veuillez vous diriger vers le point de départ pour commencer votre trajet.*

Caval Team
```

### 2. Ride Started Notifications (`ride_started`)

**Triggered when:** Ride status changes to "ride_started"
**Recipients:** Passenger
**Channels:** Push notification + WhatsApp message

**Push Notification:**
- Title: "🚗 Trajet commencé!"
- Body: "Votre trajet avec [DriverName] a commencé!"

**WhatsApp Message:**
```
🚗 *Trajet commencé!*

Bonjour [PassengerName],

Votre trajet avec [DriverName] a commencé!

📍 *Point de départ:* [PickupAddress]
🎯 *Destination:* [DestinationAddress]
💰 *Prix:* Fdj[Fare]

*Bon voyage! 🚗✨*

Caval Team
```

### 3. Passenger Ready Notifications (`passenger_ready`)

**Triggered when:** Ride status changes to "passenger_ready"
**Recipients:** Driver
**Channels:** Push notification + WhatsApp message

**Push Notification:**
- Title: "👤 Passager prêt!"
- Body: "Le passager [PassengerName] est prêt à partir."

**WhatsApp Message:**
```
👤 *Passager prêt!*

Bonjour [DriverName],

Le passager [PassengerName] est prêt à partir!

📍 *Point de départ:* [PickupAddress]
🎯 *Destination:* [DestinationAddress]
💰 *Prix:* Fdj[Fare]

*Vous pouvez maintenant commencer le trajet.*

Caval Team
```

### 4. Ride Cancelled Notifications (`cancelled`)

**Triggered when:** Ride status changes to "cancelled"
**Recipients:** Driver
**Channels:** Push notification + WhatsApp message

**Push Notification:**
- Title: "❌ Course annulée"
- Body: "La course a été annulée par le passager."

**WhatsApp Message:**
```
❌ *Course annulée*

Bonjour [DriverName],

La course [RideId] a été annulée par le passager.

📍 *Point de départ:* [PickupAddress]
🎯 *Destination:* [DestinationAddress]

*Vous pouvez maintenant accepter d'autres courses.*

Caval Team
```

## Implementation Details

### Core Functions

#### `sendPassengerNotification(passengerId, rideId, notificationType, db)`
- Sends notifications to passengers
- Handles both push notifications and WhatsApp messages
- Returns detailed status of notification delivery

#### `sendDriverNotification(driverId, rideId, notificationType, db)`
- Sends notifications to drivers
- Handles both push notifications and WhatsApp messages
- Returns detailed status of notification delivery

### WhatsApp Integration (UltraMsg)

**API Endpoint:** `https://api.ultramsg.com/instance131940/messages/chat`
**Token:** `<stored in Firebase Secret Manager as ULTRAMSG_TOKEN>`
**Instance ID:** `instance131940`

**Features:**
- Automatic phone number formatting for Djibouti (+253)
- Fallback handling if WhatsApp fails
- Comprehensive error logging

### Database Updates

The system updates the `SelectedDriver` collection with:
- Status change timestamps
- Notification delivery status
- Error information if notifications fail

## How It Works

### 1. Status Change Detection
```javascript
// Firebase Cloud Function triggers on document updates
exports.handleRideStatusChange = onDocumentUpdated({
  document: "rideRequests/{rideId}",
  // ... configuration
}, async (event) => {
  // Detects status changes and triggers appropriate notifications
});
```

### 2. Notification Routing
- **Passenger notifications:** Sent when driver arrives or ride starts
- **Driver notifications:** Sent when passenger is ready or ride is cancelled
- **Dual channel delivery:** Both push notifications and WhatsApp messages

### 3. Fallback Handling
- If push notification fails, WhatsApp message still attempts delivery
- If WhatsApp fails, push notification still attempts delivery
- Comprehensive error logging for debugging

## Testing

### Test Ride Status Changes
1. Create a ride request
2. Change status to "driver_arrived" → Should trigger passenger notifications
3. Change status to "passenger_ready" → Should trigger driver notifications
4. Change status to "ride_started" → Should trigger passenger notifications
5. Change status to "cancelled" → Should trigger driver notifications

### Monitor Logs
```bash
# View function logs
npx firebase functions:log --only handleRideStatusChange

# Check for notification delivery
grep "✅" firebase-debug.log
grep "❌" firebase-debug.log
```

## Configuration

### UltraMsg Settings
- **Instance:** #131940
- **API URL:** `https://api.ultramsg.com/instance131940`
- **Token:** `<stored in Firebase Secret Manager as ULTRAMSG_TOKEN>`
- **Daily Limit:** 100 messages (demo version)

### Push Notification Settings
- **Primary:** Expo Push Notifications
- **Fallback:** Firebase Cloud Messaging
- **Channels:** ride-requests, driver-approval, general

## Error Handling

### Common Issues
1. **Missing phone numbers:** Logged with warning, process continues
2. **Missing push tokens:** Logged with warning, WhatsApp still attempted
3. **API failures:** Comprehensive error logging and fallback attempts
4. **Database errors:** Graceful degradation, notifications still attempted

### Debug Information
Each notification attempt returns detailed status:
```javascript
{
  success: true/false,
  pushNotification: true/false,
  whatsappMessage: true/false,
  error: "error message if any"
}
```

## Future Enhancements

### Planned Features
1. **SMS fallback:** For passengers without WhatsApp
2. **Email notifications:** Alternative communication channel
3. **Notification preferences:** User-configurable notification types
4. **Delivery receipts:** Track notification delivery status
5. **Retry logic:** Automatic retry for failed notifications

### Performance Optimizations
1. **Batch notifications:** Send multiple notifications together
2. **Rate limiting:** Prevent API abuse
3. **Caching:** Cache user preferences and tokens
4. **Async processing:** Non-blocking notification delivery

## Security Considerations

- **Token validation:** All API calls require valid tokens
- **User authentication:** Notifications only sent to authenticated users
- **Data privacy:** Personal information handled securely
- **Rate limiting:** Prevents notification spam

## Support

For issues with the notification system:
1. Check Firebase function logs
2. Verify UltraMsg instance status
3. Confirm user has valid phone numbers and push tokens
4. Check notification permissions on client devices




