// WhatsApp Integration Test Script
// Run this to test your WhatsApp integration with the new service

// Note: This script is designed to work in both Node.js and React Native environments
// For React Native, use the WhatsApp test button in the app instead

// Test phone number - replace with a real number for testing
const testPhoneNumber = "+25377702036"; // Replace with actual number

// Mock WhatsApp service for testing (since we can't import the actual service here)
const mockWhatsAppService = {
  async sendMessage(phoneNumber, message) {
    console.log('📱 Mock: Sending WhatsApp message to:', phoneNumber);
    console.log('📝 Mock: Message:', message);
    
    // Simulate API call
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('✅ Mock: WhatsApp message sent successfully!');
        resolve({ success: true, messageId: 'mock-123' });
      }, 1000);
    });
  },

  async sendRideAssignmentNotification(driverInfo, rideInfo) {
    console.log('🎯 Mock: Sending ride assignment notification to:', driverInfo.firstName);
    return this.sendMessage(driverInfo.phoneNumber, 'Mock ride assignment message');
  },

  async sendRideOfferNotification(driverInfo, rideInfo) {
    console.log('🚗 Mock: Sending ride offer notification to:', driverInfo.firstName);
    return this.sendMessage(driverInfo.phoneNumber, 'Mock ride offer message');
  },

  isValidPhoneNumber(phoneNumber) {
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    return phoneRegex.test(phoneNumber);
  },

  async testIntegration(phoneNumber) {
    console.log('🧪 Mock: Testing WhatsApp integration...');
    return this.sendMessage(phoneNumber, 'Mock test message');
  }
};

async function testWhatsAppIntegration() {
  try {
    console.log('🧪 Testing WhatsApp Integration (Mock Mode)...');
    console.log('📱 Phone Number:', testPhoneNumber);
    
    // Test 1: Basic message sending
    console.log('\n📝 Test 1: Basic message sending');
    const basicResult = await mockWhatsAppService.sendMessage(
      testPhoneNumber, 
      "🧪 *Test WhatsApp Integration*\n\nCeci est un test de l'intégration WhatsApp pour Caval Driver.\n\nMerci!\nCaval Team"
    );
    console.log('✅ Basic message test passed:', basicResult);
    
    // Test 2: Ride assignment notification
    console.log('\n🎯 Test 2: Ride assignment notification');
    const driverInfo = {
      firstName: "Test Driver",
      phoneNumber: testPhoneNumber
    };
    
    const rideInfo = {
      pickupAddress: "123 Test Street, Test City",
      destinationAddress: "456 Test Avenue, Test City",
      fare: 1500,
      estimatedTime: 20
    };
    
    const assignmentResult = await mockWhatsAppService.sendRideAssignmentNotification(driverInfo, rideInfo);
    console.log('✅ Ride assignment notification test passed:', assignmentResult);
    
    // Test 3: Ride offer notification
    console.log('\n🚗 Test 3: Ride offer notification');
    const offerResult = await mockWhatsAppService.sendRideOfferNotification(driverInfo, rideInfo);
    console.log('✅ Ride offer notification test passed:', offerResult);
    
    // Test 4: Phone number validation
    console.log('\n📱 Test 4: Phone number validation');
    const validNumbers = ["+25377702036", "+1234567890", "+44123456789"];
    const invalidNumbers = ["25377702036", "+253", "invalid", ""];
    
    console.log('Valid numbers:');
    validNumbers.forEach(num => {
      const isValid = mockWhatsAppService.isValidPhoneNumber(num);
      console.log(`  ${num}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
    });
    
    console.log('Invalid numbers:');
    invalidNumbers.forEach(num => {
      const isValid = mockWhatsAppService.isValidPhoneNumber(num);
      console.log(`  ${num}: ${isValid ? '✅ Valid' : '❌ Invalid'}`);
    });
    
    console.log('\n🎉 All WhatsApp integration tests completed successfully!');
    console.log('📱 Note: This was a mock test. For real testing:');
    console.log('   1. Use the WhatsApp test button in the Caval Driver app');
    console.log('   2. Or test with real API calls in the app console');
    
  } catch (error) {
    console.error('❌ WhatsApp integration test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
console.log('🚀 WhatsApp Integration Test Suite (Mock Mode)');
console.log('==============================================');
console.log('');

// Check if running in Node.js environment
if (typeof window === 'undefined' && typeof process !== 'undefined') {
  // Node.js environment
  testWhatsAppIntegration()
    .then(() => {
      console.log('✅ Test suite completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.log('❌ Test suite failed:', error.message);
      process.exit(1);
    });
} else {
  // Browser/React Native environment
  console.log('🌐 Running in browser/React Native environment');
  console.log('📱 Use the WhatsApp test button in the Caval Driver app to test the real integration');
  console.log('🔧 This script is running in mock mode for demonstration purposes');
  
  // Run the test in mock mode
  testWhatsAppIntegration();
} 