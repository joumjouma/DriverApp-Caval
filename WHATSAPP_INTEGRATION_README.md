# WhatsApp Integration for Caval Driver App

## Overview

This integration automatically sends WhatsApp notifications to drivers when they are selected for rides. It uses the UltraMsg API service to send messages directly to drivers' WhatsApp numbers.

**Note**: This service is designed specifically for React Native and uses the `fetch` API for HTTP requests, making it compatible with mobile applications.

## Features

- ✅ **Automatic Notifications**: Drivers receive WhatsApp messages when assigned to rides
- ✅ **Rich Message Format**: Messages include ride details, pickup/destination, fare, and estimated time
- ✅ **Error Handling**: WhatsApp failures don't break the main ride assignment system
- ✅ **Phone Validation**: Ensures phone numbers are in correct international format
- ✅ **Test Integration**: Built-in testing functionality for debugging

## How It Works

### 1. Ride Assignment Flow
When a ride is assigned to a driver (either automatically or manually):

1. **Driver Selection**: System selects the best available driver
2. **WhatsApp Notification**: Sends formatted message to driver's phone number
3. **App Notification**: Also sends push notification to the app
4. **Ride Offer**: Shows ride offer modal in the app

### 2. Message Types

#### Ride Assignment Message
```
🎯 *Course assignée!*

Bonjour [Driver Name],

Vous avez été sélectionné pour une nouvelle course!

💰 *Prix:* Fdj[Fare]

⚡ *URGENT - Ouvrez l'application maintenant!*
Vous n'avez que 15 secondes pour accepter cette course!

*Actions requises:*
1. Ouvrez IMMÉDIATEMENT l'application Caval Driver
2. Allez dans l'onglet "Courses en cours"
3. Suivez les instructions pour récupérer le client

*Merci de votre service!*
Caval Team
```

#### Ride Offer Message
```
🚗 *Nouvelle course disponible!*

Bonjour [Driver Name],

Une nouvelle demande de course correspond à votre profil:

💰 *Prix:* Fdj[Fare]

⚡ *URGENT - Ouvrez l'application maintenant!*
Vous n'avez que 15 secondes pour accepter cette course!

*Pour accepter cette course:*
1. Ouvrez IMMÉDIATEMENT l'application Caval Driver
2. Allez dans l'onglet "Courses"
3. Cliquez sur "Accepter"

*Cette offre expire dans 15 secondes!*

Merci de votre service!
Caval Team
```

## Setup Instructions

### 1. UltraMsg Configuration

The service is already configured with your UltraMsg credentials:
- **Instance ID**: `instance131940`
- **Token**: `8eoza1gyk2md4sic`
- **API URL**: `api.ultramsg.com`

### 2. Driver Phone Numbers

Ensure all drivers have phone numbers stored in their profile with:
- **Field names**: `phoneNumber`, `phone`, or `number`
- **Format**: International format (e.g., `+25377702036`)
- **Required**: Must start with `+` and have 10-15 digits

## Testing the Integration

#### Option 1: In-App Test Button (Recommended)
1. Open the Caval Driver app
2. Look for the WhatsApp icon (green) in the top-right area
3. Tap it to send a test message to your registered phone number

#### Option 2: Console Testing in App
```javascript
// Test basic message
await whatsAppService.sendMessage("+25377702036", "Test message");

// Test ride assignment
await whatsAppService.sendRideAssignmentNotification(driverInfo, rideInfo);

// Test ride offer
await whatsAppService.sendRideOfferNotification(driverInfo, rideInfo);
```

#### Option 3: Standalone Test Script (Mock Mode)
```bash
node test-whatsapp-integration.js
```

## Integration Points

### 1. Automatic Ride Assignment
- **Location**: `assignRideToBestDriver()` function
- **Trigger**: New ride requests automatically assigned to best driver
- **Action**: Sends WhatsApp notification to selected driver

### 2. Manual Ride Selection
- **Location**: Ride subscription listener in `HomeScreenWithMap.js`
- **Trigger**: Driver selected through backend system
- **Action**: Sends WhatsApp notification to selected driver

### 3. New Ride Requests
- **Location**: `handleNewRideRequest()` function
- **Trigger**: New ride requests received
- **Action**: Sends WhatsApp notification after automatic assignment

## Error Handling

### WhatsApp Failures
- ✅ **Non-blocking**: Ride assignment continues even if WhatsApp fails
- ✅ **Logging**: All errors are logged for debugging
- ✅ **Fallback**: Push notifications still work as backup

### Common Issues
1. **Invalid phone numbers**: Check format (must start with `+`)
2. **API rate limits**: UltraMsg free tier has limits
3. **Network issues**: Check Firebase Functions connectivity
4. **Missing phone numbers**: Ensure drivers have phone numbers in profile

## Message Customization

### 1. Message Templates
Edit the message templates in `WhatsAppService.js`:

```javascript
formatRideAssignmentMessage(driverInfo, rideInfo) {
  // Customize your message format here
  return `🎯 *Course assignée!*...`;
}
```

### 2. Language Support
Messages are currently in French. To add other languages:

```javascript
formatRideAssignmentMessage(driverInfo, rideInfo, language = 'fr') {
  const messages = {
    fr: '🎯 *Course assignée!*...',
    en: '🎯 *Ride Assigned!*...',
    // Add more languages
  };
  return messages[language] || messages.fr;
}
```

## Monitoring and Debugging

### 1. Console Logs
Look for these log messages:
- `📱 Sending WhatsApp notification to selected driver...`
- `✅ WhatsApp notification sent successfully to driver: [Name]`
- `❌ Error sending WhatsApp notification: [Error]`

### 2. UltraMsg Dashboard
- Check message delivery status in UltraMsg dashboard
- Monitor API usage and rate limits
- View message history and analytics

### 3. Testing Checklist
- [ ] Driver has valid phone number in profile
- [ ] Phone number is in international format
- [ ] UltraMsg credentials are correct
- [ ] Network connectivity is stable
- [ ] Test message is received in WhatsApp

## Security Considerations

### 1. API Keys
- ✅ **Current**: Credentials are hardcoded (for development)
- ⚠️ **Production**: Move to environment variables
- 🔒 **Security**: Never commit API keys to version control

### 2. Phone Number Privacy
- ✅ **Validation**: Phone numbers are validated before sending
- ✅ **Logging**: Phone numbers are logged for debugging
- ⚠️ **Production**: Consider reducing phone number logging

### 3. Rate Limiting
- ⚠️ **Free Tier**: UltraMsg free tier has message limits
- 📊 **Monitoring**: Monitor usage to avoid unexpected charges
- 🔄 **Fallback**: Push notifications work if WhatsApp fails

## Troubleshooting

### 1. No WhatsApp Messages Received
1. Check driver phone number format
2. Verify UltraMsg credentials
3. Test with standalone script
4. Check UltraMsg dashboard for errors

### 2. API Errors
1. Verify network connectivity
2. Check UltraMsg service status
3. Validate API credentials
4. Check rate limits

### 3. Message Format Issues
1. Review message templates in service
2. Check for special characters
3. Validate markdown formatting
4. Test with simple messages first

## Future Enhancements

### 1. Message Templates
- [ ] Dynamic message templates
- [ ] Multi-language support
- [ ] Customizable branding

### 2. Advanced Features
- [ ] Message scheduling
- [ ] Delivery confirmations
- [ ] Read receipts
- [ ] Message history

### 3. Integration Options
- [ ] WhatsApp Business API
- [ ] Alternative WhatsApp services
- [ ] SMS fallback
- [ ] Email notifications

## Support

For issues with the WhatsApp integration:

1. **Check console logs** for error details
2. **Test with standalone script** to isolate issues
3. **Verify UltraMsg credentials** and service status
4. **Check driver phone numbers** are properly formatted
5. **Review this documentation** for common solutions

## API Reference

### WhatsAppService Methods

```javascript
// Send basic message
await whatsAppService.sendMessage(phoneNumber, message);

// Send ride assignment notification
await whatsAppService.sendRideAssignmentNotification(driverInfo, rideInfo);

// Send ride offer notification
await whatsAppService.sendRideOfferNotification(driverInfo, rideInfo);

// Test integration
await whatsAppService.testIntegration(phoneNumber);

// Validate phone number
const isValid = whatsAppService.isValidPhoneNumber(phoneNumber);
```

### Parameters

#### driverInfo
```javascript
{
  firstName: "Driver Name",
  phoneNumber: "+25377702036",
  // ... other driver fields
}
```

#### rideInfo
```javascript
{
  pickupAddress: "Pickup Address",
  destinationAddress: "Destination Address",
  fare: 1500,
  estimatedTime: 20
}
```

---

**Note**: This integration is designed to be robust and non-blocking. WhatsApp failures will not prevent drivers from receiving ride assignments through the app's push notification system. 