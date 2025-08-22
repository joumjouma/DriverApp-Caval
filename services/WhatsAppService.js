class WhatsAppService {
  constructor() {
    // UltraMsg credentials - these should be moved to environment variables in production
    this.INSTANCE_ID = "instance131940";
    this.TOKEN = "8eoza1gyk2md4sic";
    this.BASE_URL = 'https://api.ultramsg.com';
    
    // Alternative service credentials (you can add these)
    this.ALTERNATIVE_SERVICE = {
      enabled: false, // Set to true to enable alternative service
      url: 'https://your-alternative-service.com/api',
      apiKey: 'your-api-key'
    };
    
    // Service status
    this.isUltraMsgActive = true; // Will be updated based on API responses
    
    // Message deduplication - prevent multiple messages for the same ride
    this.sentMessages = new Map(); // Track sent messages by rideId + driverId
    this.messageCooldown = 5000; // 5 second cooldown between messages
  }

  /**
   * Generate a unique key for message deduplication
   * @param {string} rideId - Ride ID
   * @param {string} driverId - Driver ID
   * @param {string} messageType - Type of message (assignment, offer, etc.)
   * @returns {string} - Unique key
   */
  generateMessageKey(rideId, driverId, messageType) {
    return `${rideId}_${driverId}_${messageType}`;
  }

  /**
   * Check if message was recently sent to prevent duplicates
   * @param {string} messageKey - Unique message key
   * @returns {boolean} - True if message should be sent
   */
  shouldSendMessage(messageKey) {
    const now = Date.now();
    const lastSent = this.sentMessages.get(messageKey);
    
    if (!lastSent) {
      return true; // First time sending this message
    }
    
    if (now - lastSent < this.messageCooldown) {
      console.log(`⚠️ Message ${messageKey} was sent recently, skipping to prevent duplicates`);
      return false; // Message sent too recently
    }
    
    return true; // Enough time has passed
  }

  /**
   * Mark message as sent
   * @param {string} messageKey - Unique message key
   */
  markMessageSent(messageKey) {
    this.sentMessages.set(messageKey, Date.now());
    
    // Clean up old entries to prevent memory leaks
    const now = Date.now();
    for (const [key, timestamp] of this.sentMessages.entries()) {
      if (now - timestamp > 60000) { // Remove entries older than 1 minute
        this.sentMessages.delete(key);
      }
    }
  }

  /**
   * Send a WhatsApp message using UltraMsg API
   * @param {string} phoneNumber - Phone number in international format (e.g., +25377702036)
   * @param {string} message - Message content (supports markdown)
   * @param {string} rideId - Optional ride ID for deduplication
   * @param {string} driverId - Optional driver ID for deduplication
   * @param {string} messageType - Optional message type for deduplication
   * @returns {Promise<Object>} - API response
   */
  async sendMessage(phoneNumber, message, rideId = null, driverId = null, messageType = null) {
    try {
      console.log('📱 Sending WhatsApp message to:', phoneNumber);
      console.log('📝 Message:', message);

      // Validate phone number format
      if (!this.isValidPhoneNumber(phoneNumber)) {
        throw new Error(`Invalid phone number format: ${phoneNumber}. Expected format: +25377702036`);
      }

      // Check deduplication if we have ride and driver info
      if (rideId && driverId && messageType) {
        const messageKey = this.generateMessageKey(rideId, driverId, messageType);
        
        if (!this.shouldSendMessage(messageKey)) {
          console.log(`🔄 Skipping duplicate message for ${messageKey}`);
          return { skipped: true, reason: 'duplicate_message' };
        }
        
        // Mark as about to be sent
        this.markMessageSent(messageKey);
      }

      // Try UltraMsg first
      try {
        const result = await this.sendViaUltraMsg(phoneNumber, message);
        
        // Mark as successfully sent if we have deduplication info
        if (rideId && driverId && messageType) {
          const messageKey = this.generateMessageKey(rideId, driverId, messageType);
          console.log(`✅ Message ${messageKey} sent successfully`);
        }
        
        return result;
      } catch (ultraMsgError) {
        console.log('❌ UltraMsg failed, trying alternative service...');
        
        // Check if it's a payment issue
        if (ultraMsgError.message.includes('non-payment') || ultraMsgError.message.includes('Stopped')) {
          this.isUltraMsgActive = false;
          console.log('⚠️ UltraMsg instance is inactive due to payment issues');
        }
        
        // Try alternative service if enabled
        if (this.ALTERNATIVE_SERVICE.enabled) {
          try {
            return await this.sendViaAlternativeService(phoneNumber, message);
          } catch (altError) {
            console.error('❌ Alternative service also failed:', altError);
            throw new Error(`All WhatsApp services failed. UltraMsg: ${ultraMsgError.message}, Alternative: ${altError.message}`);
          }
        } else {
          // If no alternative service, throw the UltraMsg error
          throw ultraMsgError;
        }
      }
    } catch (error) {
      console.error('💥 Error in WhatsApp sendMessage:', error);
      throw error;
    }
  }

  /**
   * Send message via UltraMsg
   */
  async sendViaUltraMsg(phoneNumber, message) {
    const postData = {
      to: phoneNumber,
      body: message,
      token: this.TOKEN,
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.BASE_URL}/${this.INSTANCE_ID}/messages/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postData),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const result = await response.json();
      console.log('✅ WhatsApp API Response Status:', response.status);
      console.log('📊 WhatsApp API Result:', JSON.stringify(result, null, 2));
      
      if (response.ok) {
        console.log('🎉 WhatsApp message sent successfully via UltraMsg!');
        this.isUltraMsgActive = true; // Mark as active on success
        return result;
      } else {
        console.log('❌ WhatsApp API returned error status:', response.status);
        throw new Error(`WhatsApp API error: ${response.status} - ${JSON.stringify(result)}`);
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError.name === 'AbortError') {
        throw new Error('WhatsApp API request timed out after 30 seconds');
      }
      
      if (fetchError.message.includes('Network request failed')) {
        throw new Error('Network error: Unable to connect to WhatsApp API. Check your internet connection.');
      }
      
      throw fetchError;
    }
  }

  /**
   * Send message via alternative service (placeholder)
   */
  async sendViaAlternativeService(phoneNumber, message) {
    console.log('🔄 Attempting to send via alternative service...');
    
    // This is a placeholder - you can implement alternative services here
    // Examples: waapi.app, WhatsApp Business API, etc.
    
    throw new Error('Alternative WhatsApp service not configured. Please set up an alternative service or reactivate UltraMsg.');
  }

  /**
   * Check UltraMsg service status
   */
  async checkUltraMsgStatus() {
    try {
      const response = await fetch(`${this.BASE_URL}/${this.INSTANCE_ID}/instance/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      
      if (response.ok) {
        this.isUltraMsgActive = true;
        console.log('✅ UltraMsg service is active');
        return { active: true, data: result };
      } else {
        this.isUltraMsgActive = false;
        console.log('❌ UltraMsg service is inactive:', result);
        return { active: false, error: result };
      }
    } catch (error) {
      this.isUltraMsgActive = false;
      console.log('❌ Unable to check UltraMsg status:', error.message);
      return { active: false, error: error.message };
    }
  }

  /**
   * Get service status information
   */
  getServiceStatus() {
    return {
      ultraMsg: {
        active: this.isUltraMsgActive,
        instanceId: this.INSTANCE_ID,
        baseUrl: this.BASE_URL
      },
      alternative: {
        enabled: this.ALTERNATIVE_SERVICE.enabled,
        url: this.ALTERNATIVE_SERVICE.url
      },
      deduplication: {
        activeMessages: this.sentMessages.size,
        cooldownPeriod: this.messageCooldown,
        cacheSize: this.sentMessages.size
      }
    };
  }

  /**
   * Clear the message cache (useful for debugging or resetting)
   */
  clearMessageCache() {
    const cacheSize = this.sentMessages.size;
    this.sentMessages.clear();
    console.log(`🧹 Message cache cleared. Removed ${cacheSize} entries.`);
    return { cleared: true, removedCount: cacheSize };
  }

  /**
   * Get deduplication statistics
   */
  getDeduplicationStats() {
    const now = Date.now();
    const activeEntries = [];
    const expiredEntries = [];
    
    for (const [key, timestamp] of this.sentMessages.entries()) {
      if (now - timestamp < 60000) {
        activeEntries.push({ key, timestamp, age: now - timestamp });
      } else {
        expiredEntries.push({ key, timestamp, age: now - timestamp });
      }
    }
    
    return {
      totalEntries: this.sentMessages.size,
      activeEntries: activeEntries.length,
      expiredEntries: expiredEntries.length,
      cooldownPeriod: this.messageCooldown,
      activeEntriesList: activeEntries
    };
  }

  /**
   * Send ride assignment notification to driver
   * @param {Object} driverInfo - Driver information
   * @param {Object} rideInfo - Ride information
   * @returns {Promise<Object>} - API response
   */
  async sendRideAssignmentNotification(driverInfo, rideInfo) {
    try {
      console.log('🎯 Sending ride assignment WhatsApp notification to driver:', driverInfo.firstName || driverInfo.name);
      
      const message = this.formatRideAssignmentMessage(driverInfo, rideInfo);
      
      // Get driver's phone number
      const phoneNumber = driverInfo.phoneNumber || driverInfo.phone || driverInfo.number;
      
      if (!phoneNumber) {
        throw new Error('Driver phone number not available for WhatsApp notification');
      }

      // Pass deduplication parameters to prevent multiple messages
      return await this.sendMessage(
        phoneNumber, 
        message, 
        rideInfo.id || rideInfo.rideId, 
        driverInfo.id, 
        'assignment'
      );
    } catch (error) {
      console.error('💥 Error sending ride assignment WhatsApp notification:', error);
      throw error;
    }
  }

  /**
   * Send new ride offer notification to driver
   * @param {Object} driverInfo - Driver information
   * @param {Object} rideInfo - Ride information
   * @returns {Promise<Object>} - API response
   */
  async sendRideOfferNotification(driverInfo, rideInfo) {
    try {
      console.log('🚗 Sending ride offer WhatsApp notification to driver:', driverInfo.firstName || driverInfo.name);
      
      const message = this.formatRideOfferMessage(driverInfo, rideInfo);
      
      // Get driver's phone number
      const phoneNumber = driverInfo.phoneNumber || driverInfo.phone || driverInfo.number;
      
      if (!phoneNumber) {
        throw new Error('Driver phone number not available for WhatsApp notification');
      }

      // Pass deduplication parameters to prevent multiple messages
      return await this.sendMessage(
        phoneNumber, 
        message, 
        rideInfo.id || rideInfo.rideId, 
        driverInfo.id, 
        'offer'
      );
    } catch (error) {
      console.error('💥 Error sending ride offer WhatsApp notification:', error);
      throw error;
    }
  }

  /**
   * Format ride assignment message
   * @param {Object} driverInfo - Driver information
   * @param {Object} rideInfo - Ride information
   * @returns {string} - Formatted message
   */
  formatRideAssignmentMessage(driverInfo, rideInfo) {
    const driverName = driverInfo.firstName || driverInfo.name || 'Chauffeur';
    const fare = rideInfo.fare || 0;

    return `🎯 *Course assignée!*

Bonjour ${driverName},

Vous avez été sélectionné pour une nouvelle course!

💰 *Prix:* Fdj${fare.toFixed(2)}

⚡ *URGENT - Ouvrez l'application maintenant!*
Vous n'avez que 15 secondes pour accepter cette course!

*Actions requises:*
1. Ouvrez IMMÉDIATEMENT l'application Caval Driver
2. Allez dans l'onglet "Courses en cours"
3. Suivez les instructions pour récupérer le client

*Merci de votre service!*
Caval Team`;
  }

  /**
   * Format ride offer message
   * @param {Object} driverInfo - Driver information
   * @param {Object} rideInfo - Ride information
   * @returns {string} - Formatted message
   */
  formatRideOfferMessage(driverInfo, rideInfo) {
    const driverName = driverInfo.firstName || driverInfo.name || 'Chauffeur';
    const fare = rideInfo.fare || 0;

    return `🚗 *Nouvelle course disponible!*

Bonjour ${driverName},

Une nouvelle demande de course correspond à votre profil:

💰 *Prix:* Fdj${fare.toFixed(2)}

⚡ *URGENT - Ouvrez l'application maintenant!*
Vous n'avez que 15 secondes pour accepter cette course!

*Pour accepter cette course:*
1. Ouvrez IMMÉDIATEMENT l'application Caval Driver
2. Allez dans l'onglet "Courses"
3. Cliquez sur "Accepter"

*Cette offre expire dans 15 secondes!*

Merci de votre service!
Caval Team`;
  }

  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} - True if valid
   */
  isValidPhoneNumber(phoneNumber) {
    // Check if it starts with + and has 10-15 digits
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    return phoneRegex.test(phoneNumber);
  }

  /**
   * Test the WhatsApp integration
   * @param {string} phoneNumber - Phone number to test with
   * @returns {Promise<Object>} - Test result
   */
  async testIntegration(phoneNumber) {
    try {
      console.log('🧪 Testing WhatsApp Integration...');
      
      // First check service status
      const status = await this.checkUltraMsgStatus();
      console.log('📊 Service status:', status);
      
      const testMessage = `🧪 *Test WhatsApp Integration*

Bonjour Test Driver,

Ceci est un test de l'intégration WhatsApp pour Caval Driver.

💰 *Prix:* Fdj1000

⚡ *URGENT - Ouvrez l'application maintenant!*
Vous n'avez que 15 secondes pour accepter cette course!

*Test réussi si vous recevez ce message!*

Merci!
Caval Team`;

      return await this.sendMessage(phoneNumber, testMessage);
    } catch (error) {
      console.error('💥 WhatsApp integration test failed:', error);
      throw error;
    }
  }
}

// Create and export singleton instance
const whatsAppService = new WhatsAppService();
export default whatsAppService; 