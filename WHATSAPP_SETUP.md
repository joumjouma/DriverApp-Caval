# WhatsApp API Gateway Setup for Ride Notifications

## Quick Setup Guide

### Option 1: UltraMsg (Recommended - Free)

1. **Sign up at ultramsg.com**
   - Go to https://www.ultramsg.com/
   - Create a free account
   - Get your Instance ID and Token

2. **Update your Cloud Functions**
   - Replace `YOUR_INSTANCE_ID` and `YOUR_ULTRA_MSG_TOKEN` in `functions/index.js` with your actual credentials
   - Deploy your functions

3. **Test the integration**
   - The system will automatically send WhatsApp messages to drivers when:
     - New ride requests are created
     - Rides are assigned to drivers

### Option 2: waapi.app (Alternative - Free)

1. **Sign up at waapi.app**
   - Go to https://waapi.app/
   - Create a free account
   - Get your API key

2. **Update your Cloud Functions**
   - Replace `YOUR_FREE_API_KEY` in `functions/index.js` with your actual API key
   - Uncomment the waapi.app option in `sendWhatsAppMessage` function
   - Deploy your functions

### Option 3: WhatsApp Business API (Advanced)

1. **Set up WhatsApp Business API**
   - Requires Facebook Developer account
   - More complex setup but official solution
   - Follow Facebook's official documentation

## Message Templates

The system sends two types of WhatsApp messages:

### 1. New Ride Offer Message
```
🚗 *Nouvelle course disponible!*

Bonjour [Driver Name],

Une nouvelle demande de course correspond à votre profil:

📍 *Départ:* [Pickup Address]
🎯 *Destination:* [Destination Address]
💰 *Prix:* Fdj[Fare]

⏰ *Temps estimé:* ~[Time] min

*Pour accepter cette course:*
1. Ouvrez l'application Eco-share
2. Allez dans l'onglet "Courses"
3. Cliquez sur "Accepter"

*Cette offre expire dans 15 minutes.*

Merci de votre service!
Eco-share Team
```

### 2. Ride Assignment Message
```
🎯 *Course assignée!*

Bonjour [Driver Name],

Vous avez été sélectionné pour une nouvelle course!

📍 *Départ:* [Pickup Address]
🎯 *Destination:* [Destination Address]
💰 *Prix:* Fdj[Fare]

*Actions requises:*
1. Ouvrez l'application Eco-share
2. Allez dans l'onglet "Courses en cours"
3. Suivez les instructions pour récupérer le client

*Merci de votre service!*
Eco-share Team
```

## Implementation Details

### Phone Number Format
- Make sure driver phone numbers are in international format
- Example: +261340000000 (for Madagascar)

### Error Handling
- WhatsApp failures won't break the main notification system
- Push notifications will still work even if WhatsApp fails
- All errors are logged for debugging

### Deployment
After updating the API keys, deploy your functions:
```bash
firebase deploy --only functions
```

## Testing

1. **Test with a real driver phone number**
2. **Create a test ride request**
3. **Check Firebase Functions logs for any errors**
4. **Verify WhatsApp message delivery**

## Troubleshooting

### Common Issues:
1. **Invalid phone number format** - Ensure international format
2. **API key issues** - Check your API key is correct
3. **Rate limiting** - Free tiers have limits
4. **Network issues** - Check Firebase Functions connectivity

### Debug Steps:
1. Check Firebase Functions logs
2. Verify phone number format
3. Test API key separately
4. Check WhatsApp service status

## Cost Considerations

- **waapi.app**: Free tier available, paid plans for higher volume
- **UltraMsg**: Free tier available, paid plans for higher volume
- **WhatsApp Business API**: Pay per message after free tier

## Security Notes

- Never commit API keys to version control
- Use environment variables for production
- Monitor usage to avoid unexpected charges
- Implement rate limiting if needed 