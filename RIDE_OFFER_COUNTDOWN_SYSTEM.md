# Ride Offer Countdown System

## Overview

The ride offer countdown system implements a 15-second timer for drivers to accept or reject ride offers. This system ensures timely responses and efficient ride allocation.

## Architecture

### 1. Firebase Collections

#### DriverSelection Collection
```javascript
{
  rideId: "string",                    // ID of the ride request
  selectedDriverId: "string",          // Driver who received the offer
  selectedDriverName: "string",        // Driver's name
  selectedDriverPhone: "string",       // Driver's phone number
  createdAt: "timestamp",             // When the selection was created
  offerSentAt: "timestamp",           // When the offer was sent
  offerExpiryTime: "timestamp",       // When the offer expires (15 seconds)
  status: "pending_offer|offer_sent|accepted|rejected|expired",
  countdownSeconds: 15,               // Initial countdown value
  rideData: {                         // Ride details
    fare: number,
    pickupAddress: "string",
    destinationAddress: "string",
    rideType: "string",
    distance: number,
    customerName: "string",
    customerPhone: "string"
  }
}
```

#### rideRequests Collection
The ride request status changes based on offer responses:
- `waiting` → Initial state
- `waiting_for_next_driver` → When offer expires or is rejected
- `assigned` → When offer is accepted

### 2. Cloud Functions

#### handleDriverSelection
- Triggers when a new ride request is created
- Selects the best available driver
- Creates a DriverSelection document with 15-second countdown
- Sends push notification and WhatsApp message
- Schedules automatic expiration after 15 seconds

#### handleOfferAcceptance
- Triggers when a DriverSelection status changes to "accepted"
- Updates ride request status to "assigned"
- Updates driver status (rideInProgress, currentRideId, etc.)

#### handleOfferRejection
- Triggers when a DriverSelection status changes to "rejected"
- Updates ride request status to "waiting_for_next_driver"

### 3. Client-Side Services

#### RideOfferService
- Listens for ride offers in real-time
- Manages countdown timer
- Handles offer acceptance/rejection
- Provides countdown formatting utilities

#### NotificationService
- Enhanced with Android notification channels
- Supports different notification types
- Handles permission requests

### 4. UI Components

#### RideOfferModal
- Displays ride offer details with countdown
- Shows pickup/destination addresses
- Displays fare and distance
- Accept/Reject buttons
- Animated countdown timer with color changes

## Flow Diagram

```
1. Customer creates ride request
   ↓
2. Cloud Function selects driver
   ↓
3. DriverSelection document created (15s countdown)
   ↓
4. Push notification + WhatsApp sent
   ↓
5. Driver receives offer modal
   ↓
6. Driver has 15 seconds to decide
   ↓
7a. ACCEPT → Ride assigned, navigate to ride screen
   ↓
7b. REJECT → Look for next driver
   ↓
7c. EXPIRE → Look for next driver
```

## Key Features

### 1. Real-time Countdown
- Live countdown timer in the modal
- Color changes: Green (15-10s) → Orange (10-5s) → Red (5-0s)
- Pulsing animation for urgency

### 2. Automatic Expiration
- Server-side timeout after 15 seconds
- Client-side cleanup when expired
- Automatic ride status updates

### 3. Multiple Notification Channels
- Push notifications via Expo
- WhatsApp messages
- In-app modal with sound/vibration

### 4. Android Optimization
- Notification channels for different types
- High priority for ride offers
- Bypass Do Not Disturb mode
- Custom vibration patterns

## Testing

### Test Ride Offer with Countdown
1. Go to Profile → Test Notifications
2. Tap "Test Ride Offer with Countdown"
3. Check the ride offer modal appears
4. Verify 15-second countdown works
5. Test accept/reject functionality

### Manual Testing Steps
1. Ensure driver is online and available
2. Create a test ride request
3. Verify driver receives offer within 3 seconds
4. Check countdown starts at 15 seconds
5. Test accept/reject buttons
6. Verify expiration after 15 seconds

## Configuration

### Countdown Duration
- Default: 15 seconds
- Configurable in `handleDriverSelection` function
- Update both server and client timers

### Notification Settings
- Android channels configured in `NotificationService`
- High importance for ride offers
- Custom vibration patterns
- Sound and light effects

### Firebase Rules
Ensure proper security rules for DriverSelection collection:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /DriverSelection/{document} {
      allow read, write: if request.auth != null && 
        (resource.data.selectedDriverId == request.auth.uid || 
         request.auth.token.driver == true);
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Countdown not starting**
   - Check Firebase connection
   - Verify DriverSelection document created
   - Check notification permissions

2. **Modal not appearing**
   - Ensure driver is online
   - Check rideOfferService is listening
   - Verify offer status is "offer_sent"

3. **Expiration not working**
   - Check cloud function logs
   - Verify setTimeout in handleDriverSelection
   - Check Firebase rules

### Debug Steps
1. Check Firebase console for DriverSelection documents
2. Monitor cloud function logs
3. Check client-side console logs
4. Verify notification permissions
5. Test with different Android versions

## Future Enhancements

1. **Smart Driver Selection**
   - Distance-based selection
   - Rating-based priority
   - Driver availability history

2. **Dynamic Countdown**
   - Adjustable based on ride type
   - Time of day considerations
   - Driver response history

3. **Batch Offers**
   - Send to multiple drivers
   - First to respond gets the ride
   - Reduce wait times

4. **Analytics**
   - Track acceptance rates
   - Monitor response times
   - Optimize countdown duration 