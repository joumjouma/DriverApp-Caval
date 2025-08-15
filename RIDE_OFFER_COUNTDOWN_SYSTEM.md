# Ride Offer Countdown System

## Overview

The ride offer countdown system implements a 20-second timer for drivers to accept or reject ride offers. This system ensures timely responses and efficient ride allocation.

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
  offerExpiryTime: "timestamp",       // When the offer expires (20 seconds)
  status: "pending_offer|offer_sent|accepted|rejected|expired",
  countdownSeconds: 20,               // Initial countdown value
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
- Creates a DriverSelection document with 20-second countdown
- Sends push notification and WhatsApp message
- Schedules automatic expiration after 20 seconds

#### handleOfferAcceptance
- Triggers when a DriverSelection status changes to "accepted"
- Updates ride request status to "assigned"
- Updates driver status (rideInProgress, currentRideId, etc.)

#### handleOfferRejection
- Triggers when a DriverSelection status changes to "rejected"
- Updates ride request status to "waiting_for_next_driver"
- Triggers automatic reassignment to next available driver

### 3. Client-Side Implementation

#### RideOfferModal
- Displays ride offer with 20-second countdown
- Visual countdown timer with color changes
- Accept/Reject buttons
- Automatic closure when countdown expires

#### RideOfferService
- Manages ride offer lifecycle
- Handles countdown expiration
- Manages offer acceptance/rejection

## Flow

1. New ride request created
2. Cloud function selects best driver
3. DriverSelection document created (20s countdown)
4. Push notification sent to driver
5. WhatsApp message sent (if phone number available)
6. Driver has 20 seconds to decide
7. If accepted: ride assigned, countdown cancelled
8. If rejected/expired: ride reassigned to next driver
9. Process repeats until driver accepts or no drivers available

## Timeout Configuration

- **Default**: 20 seconds
- **Configurable**: Can be adjusted in cloud functions
- **Consistent**: Same timeout across all components

## Testing

### Manual Testing
1. Create a ride request
2. Verify driver selection
3. Check countdown starts at 20 seconds
4. Wait for expiration
5. Verify automatic reassignment
6. Verify expiration after 20 seconds

### Automated Testing
- Unit tests for countdown logic
- Integration tests for reassignment flow
- Performance tests for timeout handling

## Configuration

- **Default**: 20 seconds
- **Environment**: Production/Development
- **Customization**: Per ride type or driver tier 