import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

// WhatsApp messages are sent by the `sendWhatsAppNotification` Cloud Function.
// The UltraMsg token never ships in the app; the server picks the recipient
// and message text from Firestore.
const callWhatsApp = (payload) =>
  httpsCallable(getFunctions(getApp()), 'sendWhatsAppNotification')(payload).then((r) => r.data);

class WhatsAppService {
  constructor() {
    // Service status (updated from server responses)
    this.isUltraMsgActive = true;
    this.instanceId = null;

    // Message deduplication - prevent multiple messages for the same ride
    // (the server also deduplicates per ride/type/recipient)
    this.sentMessages = new Map();
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
   * Ask the server to send a WhatsApp message, with client-side dedup.
   */
  async notify(type, rideId = null, driverId = null) {
    const messageKey = rideId ? this.generateMessageKey(rideId, driverId || 'self', type) : null;
    if (messageKey && !this.shouldSendMessage(messageKey)) {
      console.log(`🔄 Skipping duplicate message for ${messageKey}`);
      return { skipped: true, reason: 'duplicate_message' };
    }
    if (messageKey) this.markMessageSent(messageKey);

    try {
      const result = await callWhatsApp({ type, rideId, driverId });
      this.isUltraMsgActive = true;
      return result;
    } catch (error) {
      if (String(error?.message || '').match(/non-payment|Stopped/)) this.isUltraMsgActive = false;
      console.error(`💥 WhatsApp ${type} failed:`, error?.message || error);
      throw error;
    }
  }

  /**
   * Check UltraMsg service status (via the server)
   */
  async checkUltraMsgStatus() {
    try {
      const result = await callWhatsApp({ type: 'status' });
      this.isUltraMsgActive = !!result.active;
      this.instanceId = result.instanceId || this.instanceId;
      return result.active ? { active: true, data: result.data } : { active: false, error: result.data };
    } catch (error) {
      this.isUltraMsgActive = false;
      return { active: false, error: error?.message || String(error) };
    }
  }

  /**
   * Get service status information
   */
  getServiceStatus() {
    return {
      ultraMsg: { active: this.isUltraMsgActive, instanceId: this.instanceId || 'server-side' },
      alternative: { enabled: false },
      deduplication: {
        activeMessages: this.sentMessages.size,
        cooldownPeriod: this.messageCooldown,
        cacheSize: this.sentMessages.size,
      },
    };
  }

  /**
   * Send ride assignment notification to driver
   * @param {Object} driverInfo - Driver information (needs id)
   * @param {Object} rideInfo - Ride information (needs id or rideId)
   */
  async sendRideAssignmentNotification(driverInfo, rideInfo) {
    return this.notify('ride_assignment', rideInfo.id || rideInfo.rideId, driverInfo.id);
  }

  /**
   * Send new ride offer notification to driver
   */
  async sendRideOfferNotification(driverInfo, rideInfo) {
    return this.notify('ride_offer', rideInfo.id || rideInfo.rideId, driverInfo.id);
  }

  /**
   * Test the WhatsApp integration — sends a test message to the signed-in
   * driver's own phone number. (The phoneNumber argument is ignored.)
   */
  async testIntegration(_phoneNumber) {
    const status = await this.checkUltraMsgStatus();
    console.log('📊 Service status:', status);
    return this.notify('test');
  }
}

// Create and export singleton instance
const whatsAppService = new WhatsAppService();
export default whatsAppService;
