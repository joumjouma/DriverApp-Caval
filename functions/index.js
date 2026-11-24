/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onRequest, onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");
const {getAuth} = require("firebase-admin/auth");
const {getStorage} = require("firebase-admin/storage");

// Initialize Firebase Admin
initializeApp();

// UltraMsg WhatsApp credentials. The token lives in Secret Manager:
//   firebase functions:secrets:set ULTRAMSG_TOKEN
// Every function that can send WhatsApp must list it in `secrets`.
const ULTRAMSG_TOKEN = defineSecret("ULTRAMSG_TOKEN");
const ULTRAMSG_INSTANCE = "instance131940";
const ULTRAMSG_BASE = `https://api.ultramsg.com/${ULTRAMSG_INSTANCE}`;

// Drivers store phoneNumber; customers store number.
const phoneOf = (data) => (data && (data.phoneNumber || data.number || data.phone)) || null;

// Function to send Expo push notification with platform-specific configurations
const sendExpoPushNotification = async (pushToken, title, body, data) => {
  const message = {
    to: pushToken,
    sound: "default",
    title: title,
    body: body,
    data: data,
    priority: "high",
    channelId: "ride-requests",
    
    // Android-specific configuration
    android: {
      priority: "high",
      sound: "default",
      channelId: "ride-requests",
      icon: "ic_launcher",
      color: "#4CAF50",
      largeIcon: "ic_launcher",
      style: {
        type: "bigtext",
        text: body,
        summary: title,
      },
      vibrateTimings: [0, 250, 250, 250],
      defaultSound: true,
      defaultVibrateTimings: true,
      defaultLightSettings: true,
      lightSettings: {
        color: "#4CAF50",
        lightOnDuration: "1s",
        lightOffDuration: "1s",
      },
      priority: "high",
      sticky: false,
      visibility: "public",
      badge: 1,
    },
    
    // iOS-specific configuration
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
          alert: {
            title: title,
            body: body,
          },
          category: "RIDE_OFFER",
          "mutable-content": 1,
          "content-available": 1,
        },
        data: data,
      },
      headers: {
        "apns-priority": "10",
        "apns-expiration": "360000", // 1 hour
        "apns-topic": "com.misscoding.Eco-Share", // Replace with your actual bundle ID
      },
    },
    
    // Web-specific configuration (if needed)
    web: {
      headers: {
        "TTL": "86400", // 24 hours
      },
    },
  };

  try {
    console.log(`Sending push notification to ${pushToken}:`, {
      title,
      body,
      data,
      platform: "cross-platform"
    });
    
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });

    const result = await response.json();
    console.log("Expo push notification result:", result);
    
    if (result.data && result.data.status === "ok") {
      console.log(`✅ Push notification sent successfully to ${pushToken}`);
    } else {
      console.warn(`⚠️ Push notification may have failed:`, result);
    }
    
    return result;
  } catch (error) {
    console.error("Error sending Expo push notification:", error);
    throw error;
  }
};

// Enhanced notification function with fallback and retry logic
const sendEnhancedPushNotification = async (pushToken, title, body, data, driverId) => {
  try {
    // First attempt: Send via Expo
    console.log(`Attempting to send notification to driver ${driverId} via Expo...`);
    
    try {
      const expoResult = await sendExpoPushNotification(pushToken, title, body, data);
      
      // Check if Expo notification was successful
      if (expoResult.data && expoResult.data.status === "ok") {
        console.log(`✅ Expo notification sent successfully to driver ${driverId}`);
        return expoResult;
      }
    } catch (expoError) {
      console.warn(`Expo notification failed for driver ${driverId}:`, expoError);
    }
    
    // Fallback: Try to get FCM token and send via Firebase
    try {
      console.log(`Attempting FCM fallback for driver ${driverId}...`);
      
      // Get driver's FCM token if available
      const driverDoc = await getFirestore().collection("Drivers").doc(driverId).get();
      if (driverDoc.exists()) {
        const driverData = driverDoc.data();
        const fcmToken = driverData.fcmToken || driverData.pushToken;
        
        if (fcmToken && fcmToken !== pushToken) {
          console.log(`Trying FCM token for driver ${driverId}:`, fcmToken);
          
          // Send via Firebase Cloud Messaging
          const messaging = getMessaging();
          const fcmMessage = {
            token: fcmToken,
            notification: {
              title: title,
              body: body,
            },
            data: data,
            android: {
              priority: "high",
              notification: {
                sound: "default",
                channelId: "ride-requests",
                priority: "high",
                defaultSound: true,
                defaultVibrateTimings: true,
                vibrateTimings: [0, 250, 250, 250],
                icon: "ic_launcher",
                color: "#4CAF50",
                largeIcon: "ic_launcher",
                style: {
                  type: "bigtext",
                  text: body,
                  summary: title,
                },
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                  alert: {
                    title: title,
                    body: body,
                  },
                  category: "RIDE_OFFER",
                  "mutable-content": 1,
                },
              },
            },
          };
          
          const fcmResult = await messaging.send(fcmMessage);
          console.log(`✅ FCM notification sent successfully to driver ${driverId}:`, fcmResult);
          return { success: true, method: "FCM", result: fcmResult };
        }
      }
    } catch (fcmError) {
      console.warn(`FCM fallback failed for driver ${driverId}:`, fcmError);
    }
    
    // Final fallback: Log the failure for manual intervention
    console.error(`❌ All notification methods failed for driver ${driverId}`);
    console.error(`Driver ${driverId} will not receive notification for ride offer`);
    
    return { success: false, method: "none", error: "All notification methods failed" };
    
  } catch (error) {
    console.error(`Error in sendEnhancedPushNotification for driver ${driverId}:`, error);
    return { success: false, method: "error", error: error.message };
  }
};

// Alternative function using UltraMsg (Another free service)
const sendWhatsAppMessageUltraMsg = async (phoneNumber, message) => {
  try {
    // Format phone number for WhatsApp (remove + and add country code if needed)
    let formattedPhone = phoneNumber;
    if (phoneNumber.startsWith('+')) {
      formattedPhone = phoneNumber.substring(1); // Remove the + sign
    }
    
    // If it's a Djibouti number (253), make sure it's properly formatted
    if (formattedPhone.startsWith('253')) {
      formattedPhone = formattedPhone; // Keep as is
    } else if (formattedPhone.startsWith('777') || formattedPhone.startsWith('77')) {
      formattedPhone = '253' + formattedPhone; // Add Djibouti country code
    }

    console.log(`Sending WhatsApp message to: ${formattedPhone}`);
    
    // Using UltraMsg free WhatsApp API
    const response = await fetch(
      `${ULTRAMSG_BASE}/messages/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: formattedPhone,
          body: message,
          token: ULTRAMSG_TOKEN.value(),
        }),
      },
    );

    const result = await response.json();
    console.log("UltraMsg WhatsApp result:", result);
    return result;
  } catch (error) {
    console.error("Error sending WhatsApp message via UltraMsg:", error);
    throw error;
  }
};

// Function to send WhatsApp message to driver (Updated with UltraMsg as primary)
const sendWhatsAppMessage = async (phoneNumber, message) => {
  try {
    // Option 1: Using UltraMsg (Primary choice)
    return await sendWhatsAppMessageUltraMsg(phoneNumber, message);

    // Option 2: Using WhatsApp API Gateway (Alternative)
    // return await sendWhatsAppMessageFree(phoneNumber, message);

    // Option 3: WhatsApp Business API (More complex setup)
    /*
    const accessToken = "YOUR_WHATSAPP_ACCESS_TOKEN";
    const phoneNumberId = "YOUR_PHONE_NUMBER_ID";

    const response = await fetch(
      `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phoneNumber,
          type: "text",
          text: {
            body: message,
          },
        }),
      },
    );

    const result = await response.json();
    console.log("WhatsApp message result:", result);
    return result;
    */
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    throw error;
  }
};

// Function to format ride offer message for WhatsApp
const formatRideOfferMessage = (rideData, driverName) => {
  return `🚗 *Nouvelle course disponible!*

Bonjour ${driverName},

Une nouvelle demande de course correspond à votre profil:

📍 *Départ:* ${rideData.pickupAddress}
🎯 *Destination:* ${rideData.destinationAddress}
💰 *Prix:* Fdj${rideData.fare || "0"}

⏰ *Temps estimé:* ~${Math.round((rideData.distance || 5) / 30 * 60)} min

*Pour accepter cette course:*
1. Ouvrez l'application Caval Courrier
2. Allez dans l'onglet "Courses"
3. Cliquez sur "Accepter"

*Cette offre expire dans 15 minutes.*

Merci de votre service!
Caval Team`;
};

// REMOVED: Broken sendNewRideNotification function - This was causing duplicate WhatsApp messages
// Now using only selectBestDriverForNewRideRequest for new rides

// REMOVED: handleDriverSelection function - DriverSelection collection is deprecated
// Using SelectedDriver collection instead for ride offers


// REMOVED: handleOfferAcceptance and handleOfferRejection functions - DriverSelection collection is deprecated
// Using SelectedDriver collection instead for ride offers

// Cloud Function to send approval notification when driver status is updated
exports.sendDriverApprovalNotification = onDocumentUpdated({
  document: "Drivers/{driverId}",
  maxInstances: 10,
}, async (event) => {
    const messaging = getMessaging();

    try {
      const beforeData = event.data && event.data.before ?
        event.data.before.data() : null;
      const afterData = event.data && event.data.after ?
        event.data.after.data() : null;

      // Check if approval status changed
      if ((!beforeData || beforeData.approvalStatus !== "approved") &&
        afterData && afterData.approvalStatus === "approved") {
        console.log("Driver approved:", event.params.driverId);

        const pushToken = afterData.pushToken;

        if (!pushToken) {
          console.log("Driver has no push token");
          return;
        }

        // Prepare approval notification message
        const message = {
          token: pushToken,
          notification: {
            title: "✅ Compte approuvé!",
            body: "Félicitations! Votre compte chauffeur a été approuvé. " +
              "Vous pouvez maintenant commencer à travailler.",
          },
          data: {
            type: "driver_approval",
            driverId: event.params.driverId,
            status: "approved",
          },
          android: {
            notification: {
              sound: "default",
              channelId: "driver-approval",
              priority: "high",
              defaultSound: true,
              defaultVibrateTimings: true,
              vibrateTimings: [0, 250, 250, 250],
              icon: "ic_launcher",
              color: "#4CAF50",
              largeIcon: "ic_launcher",
              style: {
                type: "bigtext",
                text: "Félicitations! Votre compte chauffeur a été approuvé. " +
                  "Vous pouvez maintenant commencer à travailler.",
                summary: "Compte approuvé",
              },
            },
            data: {
              type: "driver_approval",
              driverId: event.params.driverId,
              status: "approved",
            },
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1,
                alert: {
                  title: "✅ Compte approuvé!",
                  body: "Félicitations! Votre compte chauffeur a été approuvé. " +
                    "Vous pouvez maintenant commencer à travailler.",
                },
                category: "DRIVER_APPROVAL",
                "mutable-content": 1,
              },
            },
            data: {
              type: "driver_approval",
              driverId: event.params.driverId,
              status: "approved",
            },
          },
        };
        
        // Send the notification
        const response = await messaging.send(message);
        console.log("Approval notification sent successfully:", response);
      } else if ((!beforeData || beforeData.approvalStatus !== "rejected") &&
        afterData && afterData.approvalStatus === "rejected") {
        console.log("Driver rejected:", event.params.driverId);
      
      const pushToken = afterData.pushToken;
      
      if (!pushToken) {
          console.log("Driver has no push token");
        return;
      }
      
      // Prepare rejection notification message
      const message = {
        token: pushToken,
        notification: {
            title: "❌ Compte non approuvé",
            body: "Votre demande de compte chauffeur n'a pas été approuvée. " +
              "Contactez le support pour plus d'informations.",
        },
        data: {
            type: "driver_approval",
          driverId: event.params.driverId,
            status: "rejected",
        },
        android: {
          notification: {
              sound: "default",
              channelId: "driver-approval",
              priority: "high",
            defaultSound: true,
            defaultVibrateTimings: true,
            vibrateTimings: [0, 250, 250, 250],
              icon: "ic_launcher",
              color: "#F44336",
              largeIcon: "ic_launcher",
            style: {
                type: "bigtext",
                text: "Votre demande de compte chauffeur n'a pas été approuvée. " +
                  "Contactez le support pour plus d'informations.",
                summary: "Compte non approuvé",
              },
          },
          data: {
              type: "driver_approval",
            driverId: event.params.driverId,
              status: "rejected",
            },
        },
        apns: {
          payload: {
            aps: {
                sound: "default",
              badge: 1,
              alert: {
                  title: "❌ Compte non approuvé",
                  body: "Votre demande de compte chauffeur n'a pas été approuvée. " +
                    "Contactez le support pour plus d'informations.",
                },
                category: "DRIVER_APPROVAL",
                "mutable-content": 1,
            },
          },
          data: {
              type: "driver_approval",
            driverId: event.params.driverId,
              status: "rejected",
            },
        },
      };
      
      // Send the notification
      const response = await messaging.send(message);
        console.log("Rejection notification sent successfully:", response);
      }
    } catch (error) {
      console.error("Error sending approval notification:", error);
    }
  });

// Cloud Function to update OnlineDriver document with currently online drivers
exports.updateOnlineDrivers = onDocumentUpdated({
  document: "Drivers/{driverId}",
  maxInstances: 5,
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (event) => {
  const db = getFirestore();
  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    // Check if driver just went online
    if (beforeData && afterData && !beforeData.isOnline && afterData.isOnline) {
      console.log(`🚗 Driver ${event.params.driverId} just went online, starting online timer`);
      
      // Set the online start time when driver goes online
      await db.collection("Drivers").doc(event.params.driverId).update({
        onlineStartTime: new Date(),
        lastOnlineUpdate: new Date()
      });
    }
    
    // Get all currently online drivers
    const driversSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .get();
    const onlineDrivers = [];
    const currentTime = new Date();
    
    driversSnapshot.forEach((doc) => {
      const data = doc.data();
      let onlineDuration = 0;
      
      // Calculate online duration if onlineStartTime exists
      if (data.onlineStartTime) {
        const startTime = data.onlineStartTime.toDate ? data.onlineStartTime.toDate() : new Date(data.onlineStartTime);
        onlineDuration = Math.floor((currentTime - startTime) / 1000); // Duration in seconds
      }
      
      onlineDrivers.push({
        id: doc.id,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phoneNumber: data.phoneNumber || "",
        driverType: data.driverType || "",
        gender: data.gender || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        isAvailable: data.isAvailable || false,
        photo: data.photo || "",
        onlineStartTime: data.onlineStartTime || null,
        onlineDuration: onlineDuration, // Duration in seconds
        lastOnlineUpdate: data.lastOnlineUpdate || null
      });
    });
    
    // Write/update the OnlineDriver document
    await db.collection("OnlineDriver").doc("summary").set({
      count: onlineDrivers.length,
      drivers: onlineDrivers,
      updatedAt: currentTime,
      lastDriverStatusChange: new Date()
    });
    console.log(`OnlineDriver document updated with ${onlineDrivers.length} drivers`);
  } catch (error) {
    console.error("Error updating OnlineDriver document:", error);
  }
});

// Cloud Function to maintain OnlineDriver document with aggregated online driver information
exports.maintainOnlineDriverDocument = onDocumentUpdated({
  document: "Drivers/{driverId}",
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (event) => {
  const db = getFirestore();

  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    if (!beforeData || !afterData) return;

    // Check if driver just went online
    if (!beforeData.isOnline && afterData.isOnline) {
      console.log(`🚗 Driver ${event.params.driverId} just went online, updating OnlineDriver document`);
      
      // Update the OnlineDriver document with new online driver
      const onlineDriverRef = db.collection("OnlineDriver").doc("current");
      await onlineDriverRef.set({
        lastUpdated: new Date(),
        status: 'active',
        lastDriverOnline: new Date(),
        driverId: event.params.driverId
      }, { merge: true });
    }
    
    // Check if driver just went offline
    if (beforeData.isOnline && !afterData.isOnline) {
      console.log(`🚫 Driver ${event.params.driverId} just went offline, updating OnlineDriver document`);
      
      // Update the OnlineDriver document
      const onlineDriverRef = db.collection("OnlineDriver").doc("current");
      await onlineDriverRef.set({
        lastUpdated: new Date(),
        lastDriverOffline: new Date(),
        driverId: event.params.driverId
      }, { merge: true });
    }
    
  } catch (error) {
    console.error('Error in maintainOnlineDriverDocument:', error);
  }
});

// Cloud Function to periodically clean up offline drivers from OnlineDriver document
// Temporarily comment out to reduce resource usage during deployment
// exports.cleanupOfflineDrivers = onDocumentUpdated({
//   document: "OnlineDriver/current",
//   maxInstances: 1,
// }, async (event) => {
//   const db = getFirestore();

//   try {
//     const onlineDriverData = event.data && event.data.after ? event.data.after.data() : null;
    
//     if (!onlineDriverData || !onlineDriverData.onlineDrivers) {
//       return;
//     }

//     const currentTime = new Date();
//     const offlineDrivers = [];
//     const updatedOnlineDrivers = [];

//     // Check each driver's last online update
//     for (const driver of onlineDriverData.onlineDrivers) {
//       if (driver.lastOnlineUpdate) {
//         const lastUpdate = new Date(driver.lastOnlineUpdate);
//         const timeDiff = (currentTime - lastUpdate) / 1000; // seconds
        
//         // If driver hasn't updated in more than 10 minutes, consider them offline
//         if (timeDiff > 600) {
//           offlineDrivers.push(driver.id);
//         } else {
//           updatedOnlineDrivers.push(driver);
//         }
//       } else {
//         // If no lastOnlineUpdate, keep them for now
//         updatedOnlineDrivers.push(driver);
//       }
//     }

//     // If we found offline drivers, update the document
//     if (offlineDrivers.length > 0) {
//       console.log(`Cleaning up ${offlineDrivers.length} offline drivers:`, offlineDrivers);
      
//       // Recalculate totals
//       let totalDrivers = updatedOnlineDrivers.length;
//       let totalAvailableDrivers = 0;
//       let driversByType = {};

//       updatedOnlineDrivers.forEach((driver) => {
//         if (driver.isAvailable !== false) {
//           totalAvailableDrivers++;
//         }

//         const driverType = driver.driverType || 'unknown';
//         if (!driversByType[driverType]) {
//           driversByType[driverType] = {
//             count: 0,
//             available: 0,
//             drivers: []
//           };
//         }
//         driversByType[driverType].count++;
//         if (driver.isAvailable !== false) {
//           driversByType[driverType].available++;
//         }
//       });

//       const updatedData = {
//         totalOnlineDrivers: totalDrivers,
//         totalAvailableDrivers: totalAvailableDrivers,
//         driversByType: driversByType,
//         onlineDrivers: updatedOnlineDrivers,
//         lastUpdated: currentTime,
//         lastCleanup: currentTime,
//         cleanedUpDrivers: offlineDrivers,
//         status: totalDrivers > 0 ? 'active' : 'inactive'
//       };

//       await db.collection("OnlineDriver").doc("current").set(updatedData);
//       console.log(`Cleaned up offline drivers. Remaining: ${totalDrivers} online, ${totalAvailableDrivers} available`);
//     }
//   } catch (error) {
//     console.error("Error cleaning up offline drivers:", error);
//   }
// });

// Test function for WhatsApp integration
const {onSchedule} = require("firebase-functions/v2/scheduler");

// Scheduled function to clean up offline drivers every minute
// Temporarily comment out to reduce resource usage during deployment
// exports.scheduledCleanupOfflineDrivers = onSchedule({
//   schedule: "every 1 minutes",
//   maxInstances: 1,
//   memory: "256MiB",
//   timeoutSeconds: 60,
// }, async (event) => {
//   const db = getFirestore();

//   try {
//     console.log("Running scheduled cleanup of offline drivers...");
    
//     // Get the current OnlineDriver document
//     const onlineDriverDoc = await db.collection("OnlineDriver").doc("current").get();
    
//     if (!onlineDriverDoc.exists) {
//       console.log("No OnlineDriver document found, skipping cleanup");
//       return;
//     }

//     const onlineDriverData = onlineDriverDoc.data();
    
//     if (!onlineDriverData || !onlineDriverData.onlineDrivers) {
//       console.log("No online drivers data found, skipping cleanup");
//       return;
//     }

//     const currentTime = new Date();
//     const offlineDrivers = [];
//     const updatedOnlineDrivers = [];

//     // Check each driver's last online update
//     for (const driver of onlineDriverData.onlineDrivers) {
//       if (driver.lastOnlineUpdate) {
//         const lastUpdate = new Date(driver.lastOnlineUpdate);
//         const timeDiff = (currentTime - lastUpdate) / 1000; // seconds
        
//         // If driver hasn't updated in more than 10 minutes, consider them offline
//         if (timeDiff > 600) {
//           offlineDrivers.push(driver.id);
//           console.log(`Driver ${driver.id} marked as offline (last update: ${lastUpdate}, time diff: ${timeDiff}s)`);
//         } else {
//           updatedOnlineDrivers.push(driver);
//         }
//       } else {
//         // If no lastOnlineUpdate, keep them for now
//         updatedOnlineDrivers.push(driver);
//       }
//     }

//     // If we found offline drivers, update the document
//     if (offlineDrivers.length > 0) {
//       console.log(`Scheduled cleanup: Removing ${offlineDrivers.length} offline drivers:`, offlineDrivers);
      
//       // Recalculate totals
//       let totalDrivers = updatedOnlineDrivers.length;
//       let totalAvailableDrivers = 0;
//       let driversByType = {};

//       updatedOnlineDrivers.forEach((driver) => {
//         if (driver.isAvailable !== false) {
//           totalAvailableDrivers++;
//         }

//         const driverType = driver.driverType || 'unknown';
//         if (!driversByType[driverType]) {
//           driversByType[driverType] = {
//             count: 0,
//             available: 0,
//             drivers: []
//           };
//         }
//         driversByType[driverType].count++;
//         if (driver.isAvailable !== false) {
//           driversByType[driverType].available++;
//         }
//       });

//       const updatedData = {
//         totalOnlineDrivers: totalDrivers,
//         totalAvailableDrivers: totalAvailableDrivers,
//         driversByType: driversByType,
//         onlineDrivers: updatedOnlineDrivers,
//         lastUpdated: currentTime,
//         lastCleanup: currentTime,
//         cleanedUpDrivers: offlineDrivers,
//         status: totalDrivers > 0 ? 'active' : 'inactive'
//       };

//       await db.collection("OnlineDriver").doc("current").set(updatedData);
//       console.log(`Scheduled cleanup completed. Remaining: ${totalDrivers} online, ${totalAvailableDrivers} available`);
//     } else {
//       console.log("Scheduled cleanup: No offline drivers found");
//     }
//   } catch (error) {
//     console.error("Error in scheduled cleanup of offline drivers:", error);
//   }
// });

// Cloud Function to automatically set drivers offline after 1200 seconds (20 minutes)
exports.autoOfflineDrivers = onSchedule({
  schedule: "every 1 minutes", // Check every minute for auto-offline
  maxInstances: 1,
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (event) => {
  const db = getFirestore();
  
  try {
    console.log("🚫 Running auto-offline check for drivers...");
    
    // Get all currently online drivers
    const driversSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .get();
    
    if (driversSnapshot.empty) {
      console.log("No online drivers found, skipping auto-offline check");
      return;
    }
    
    const currentTime = new Date();
    const offlinePromises = [];
    const driversToOffline = [];
    
    driversSnapshot.forEach((doc) => {
      const data = doc.data();
      
      if (data.onlineStartTime) {
        const startTime = data.onlineStartTime.toDate ? data.onlineStartTime.toDate() : new Date(data.onlineStartTime);
        const onlineDuration = Math.floor((currentTime - startTime) / 1000); // Duration in seconds
        
        // Check if driver has been online for 1200 seconds (20 minutes) or more
        if (onlineDuration >= 1200) {
          console.log(`🚫 Driver ${doc.id} has been online for ${onlineDuration}s - setting offline`);
          
          driversToOffline.push({
            id: doc.id,
            duration: onlineDuration,
            startTime: startTime
          });
          
          // Set driver offline
          offlinePromises.push(
            db.collection("Drivers").doc(doc.id).update({
              isOnline: false,
              isAvailable: false,
              lastOfflineUpdate: currentTime,
              autoOfflineReason: "1200_second_timeout",
              autoOfflineAt: currentTime,
              totalOnlineTime: onlineDuration
            })
          );
        }
      }
    });
    
    // Execute all offline updates
    if (offlinePromises.length > 0) {
      await Promise.all(offlinePromises);
      console.log(`✅ Auto-offlined ${offlinePromises.length} drivers after 1200 seconds (20 minutes)`);
      
      // Log details of offlined drivers
      driversToOffline.forEach(driver => {
        console.log(`📊 Driver ${driver.id} was online for ${driver.duration}s from ${driver.startTime.toLocaleTimeString()}`);
      });
    } else {
      console.log("✅ No drivers exceeded 1200-second (20 minute) limit");
    }
    
    // Update OnlineDriver summary to reflect offline drivers
    const remainingOnlineDrivers = [];
    const remainingSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .get();
    
    remainingSnapshot.forEach((doc) => {
      const data = doc.data();
      let onlineDuration = 0;
      
      if (data.onlineStartTime) {
        const startTime = data.onlineStartTime.toDate ? data.onlineStartTime.toDate() : new Date(data.onlineStartTime);
        onlineDuration = Math.floor((currentTime - startTime) / 1000);
      }
      
      remainingOnlineDrivers.push({
        id: doc.id,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phoneNumber: data.phoneNumber || "",
        driverType: data.driverType || "",
        gender: data.gender || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        isAvailable: data.isAvailable || false,
        photo: data.photo || "",
        onlineStartTime: data.onlineStartTime || null,
        onlineDuration: onlineDuration,
        lastOnlineUpdate: data.lastOnlineUpdate || null
      });
    });
    
    await db.collection("OnlineDriver").doc("summary").set({
      count: remainingOnlineDrivers.length,
      drivers: remainingOnlineDrivers,
      updatedAt: currentTime,
      lastAutoOfflineCheck: currentTime,
      lastAutoOfflineCount: driversToOffline.length
    });
    
    console.log(`✅ OnlineDriver summary updated - ${remainingOnlineDrivers.length} drivers remaining online`);
    
  } catch (error) {
    console.error("Error in auto-offline function:", error);
  }
});

// Cloud Function to periodically update online duration for all online drivers
exports.updateOnlineDuration = onSchedule({
  schedule: "every 1 minutes",
  maxInstances: 1,
  memory: "256MiB",
  timeoutSeconds: 60,
}, async (event) => {
  const db = getFirestore();
  
  try {
    console.log("🕐 Running scheduled update of online duration...");
    
    // Get all currently online drivers
    const driversSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .get();
    
    if (driversSnapshot.empty) {
      console.log("No online drivers found, skipping duration update");
      return;
    }
    
    const currentTime = new Date();
    const updatePromises = [];
    
    driversSnapshot.forEach((doc) => {
      const data = doc.data();
      
      if (data.onlineStartTime) {
        const startTime = data.onlineStartTime.toDate ? data.onlineStartTime.toDate() : new Date(data.onlineStartTime);
        const onlineDuration = Math.floor((currentTime - startTime) / 1000); // Duration in seconds
        
        // Update the driver's online duration
        updatePromises.push(
          db.collection("Drivers").doc(doc.id).update({
            onlineDuration: onlineDuration,
            lastOnlineUpdate: currentTime
          })
        );
      }
    });
    
    // Execute all updates
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(`✅ Updated online duration for ${updatePromises.length} drivers`);
    }
    
    // Also update the OnlineDriver summary document
    const onlineDrivers = [];
    driversSnapshot.forEach((doc) => {
      const data = doc.data();
      let onlineDuration = 0;
      
      if (data.onlineStartTime) {
        const startTime = data.onlineStartTime.toDate ? data.onlineStartTime.toDate() : new Date(data.onlineStartTime);
        onlineDuration = Math.floor((currentTime - startTime) / 1000);
      }
      
      onlineDrivers.push({
        id: doc.id,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phoneNumber: data.phoneNumber || "",
        driverType: data.driverType || "",
        gender: data.gender || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        isAvailable: data.isAvailable || false,
        photo: data.photo || "",
        onlineStartTime: data.onlineStartTime || null,
        onlineDuration: onlineDuration,
        lastOnlineUpdate: data.lastOnlineUpdate || null
      });
    });
    
    await db.collection("OnlineDriver").doc("summary").set({
      count: onlineDrivers.length,
      drivers: onlineDrivers,
      updatedAt: currentTime,
      lastDurationUpdate: currentTime
    });
    
    console.log(`✅ OnlineDriver summary updated with duration data for ${onlineDrivers.length} drivers`);
    
  } catch (error) {
    console.error("Error updating online duration:", error);
  }
});

// Very simple test function to verify cloud function setup
exports.simpleTest = onRequest(async (request, response) => {
  console.log('🧪 Simple test function called');
  response.json({
    success: true,
    message: 'Simple test function is working',
    timestamp: new Date().toISOString()
  });
});

// Test function to verify cloud function setup
exports.testCloudFunction = onRequest({
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request, response) => {
  try {
    console.log('🧪 Test cloud function called');
    
    const db = getFirestore();
    
    // Test basic Firestore access
    const testDoc = await db.collection('test').doc('test').get();
    console.log('✅ Firestore access test successful');
    
    // Test driver query
    const driversSnapshot = await db.collection('Drivers').limit(1).get();
    console.log(`✅ Driver query test successful, found ${driversSnapshot.size} drivers`);
    
    response.json({
      success: true,
      message: 'Cloud function is working correctly',
      timestamp: new Date().toISOString(),
      firestore: 'working',
      drivers: driversSnapshot.size
    });
    
  } catch (error) {
    console.error('❌ Test cloud function error:', error);
    response.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================================================
// ENHANCED: Intelligent Driver Selection System - Select Best Closest Driver
// ============================================================================

// Cloud Function to continuously monitor and reassign rides to best available drivers
exports.continuousDriverOptimization = onSchedule({
  schedule: "every 2 minutes", // Check every 2 minutes for optimization opportunities
  maxInstances: 1,
  memory: "256MiB",
  timeoutSeconds: 120,
}, async (event) => {
  console.log('🚀 FUNCTION TRIGGERED: continuousDriverOptimization - START');
  
  const db = getFirestore();
  
  try {
    // Find all rides that are waiting for a driver or have been assigned but driver might not be optimal
    const ridesQuery = db
      .collection('rideRequests')
      .where('status', 'in', ['waiting', 'driver_selected'])
      .limit(50); // Process up to 50 rides at a time
    
    const ridesSnapshot = await ridesQuery.get();
    
    if (ridesSnapshot.empty) {
      console.log('✅ No rides need driver optimization');
      return;
    }
    
    console.log(`🔍 Processing ${ridesSnapshot.size} rides for driver optimization`);
    
    let optimizedCount = 0;
    let reassignedCount = 0;
    
    for (const rideDoc of ridesSnapshot.docs) {
      try {
        const rideData = rideDoc.data();
        const rideId = rideDoc.id;
        
        // Skip rides without pickup coordinates
        if (!rideData.pickupLat || !rideData.pickupLng) {
          console.log(`⏭️ Skipping ride ${rideId} - no pickup coordinates`);
          continue;
        }
        
        // Find the best available driver for this ride
        const bestDriver = await findBestAvailableDriver(rideData, null, db);
        
        if (!bestDriver) {
          console.log(`❌ No suitable drivers found for ride ${rideId}`);
          continue;
        }
        
        // Check if current driver assignment is optimal
        if (rideData.selectedDriverId && rideData.selectedDriverId === bestDriver.id) {
          console.log(`✅ Ride ${rideId} already has optimal driver ${bestDriver.id}`);
          optimizedCount++;
          continue;
        }
        
        // Check if we should reassign to a better driver
        let shouldReassign = false;
        
        if (!rideData.selectedDriverId) {
          // No driver assigned yet
          shouldReassign = true;
          console.log(`🆕 Ride ${rideId} has no driver assigned, assigning best driver ${bestDriver.id}`);
        } else if (rideData.status === 'driver_selected') {
          // Driver was selected but might not be optimal
          const currentDriverScore = rideData.driverScore || 0;
          const currentDriverDistance = rideData.driverDistance || 999;
          
          // Reassign if new driver is significantly better (20% better score or 2km closer)
          if (bestDriver.score > currentDriverScore * 1.2 || 
              bestDriver.distance < currentDriverDistance - 2) {
            shouldReassign = true;
            console.log(`🔄 Ride ${rideId} can be optimized: Current (Score: ${currentDriverScore}, Distance: ${currentDriverDistance}km) vs New (Score: ${bestDriver.score}, Distance: ${bestDriver.distance.toFixed(2)}km)`);
          }
        }
        
        if (shouldReassign) {
          try {
            // Reassign to better driver
            await reassignRideToBetterDriver(rideId, rideData, bestDriver, db);
            reassignedCount++;
            console.log(`✅ Ride ${rideId} reassigned to better driver ${bestDriver.id}`);
          } catch (reassignError) {
            console.error(`❌ Error reassigning ride ${rideId}:`, reassignError);
          }
        }
        
      } catch (rideError) {
        console.error(`❌ Error processing ride ${rideDoc.id}:`, rideError);
      }
    }
    
    console.log(`🎯 Driver optimization completed: ${optimizedCount} rides already optimal, ${reassignedCount} rides reassigned`);
    
    // Update optimization metrics
    await db.collection('SystemMetrics').doc('driverOptimization').set({
      lastOptimizationRun: new Date(),
      ridesProcessed: ridesSnapshot.size,
      ridesOptimized: optimizedCount,
      ridesReassigned: reassignedCount,
      totalRuns: increment(1)
    }, { merge: true });
    
  } catch (error) {
    console.error('❌ Error in continuousDriverOptimization:', error);
  }
});

// Helper function to reassign ride to a better driver
async function reassignRideToBetterDriver(rideId, rideData, newDriver, db) {
  try {
    const now = new Date();
    const countdownExpiryTime = new Date(now.getTime() + 15000); // 15 seconds
    
    // Update ride request with new driver
    await db.collection("rideRequests").doc(rideId).update({
      selectedDriverId: newDriver.id,
      driverSelectedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      driverScore: newDriver.score,
      driverDistance: newDriver.distance,
      lastOptimizationAt: now,
      optimizationReason: 'better_driver_found'
    });
    
    // Update SelectedDriver collection
    await db.collection("SelectedDriver").doc(rideId).set({
      rideId: rideId,
      selectedDriverId: newDriver.id,
      status: 'selected',
      timestamp: now,
      countdownStartedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      countdownSeconds: 15,
      isCountdownActive: true,
      driverScore: newDriver.score,
      driverDistance: newDriver.distance,
      optimizationReason: 'better_driver_found'
    }, { merge: true });
    
    // Send notification to new driver
    if (newDriver.expoPushToken) {
      try {
        const notificationData = {
          type: "ride_reassigned",
          rideId: rideId,
          driverId: newDriver.id,
          fare: (rideData.fare && rideData.fare.toString()) || "0",
          pickupAddress: rideData.pickupAddress || "",
          destinationAddress: rideData.destinationAddress || "",
          rideType: rideData.rideType,
          countdownSeconds: 15,
          priority: "high",
          sound: "default",
          badge: 1,
          driverScore: newDriver.score,
          driverDistance: newDriver.distance
        };
        
        await sendEnhancedPushNotification(
          newDriver.expoPushToken,
          "🎯 Course réassignée!",
          `Une course vous a été réassignée! Départ: ${rideData.pickupAddress || 'Adresse de départ'} (15s pour répondre)`,
          notificationData,
          newDriver.id
        );
        
        console.log(`📱 Notification sent to newly assigned driver ${newDriver.id}`);
      } catch (notificationError) {
        console.error(`❌ Error sending notification to new driver ${newDriver.id}:`, notificationError);
      }
    }
    
    // Set up countdown timer for new driver
    setTimeout(async () => {
      try {
        const currentRideDoc = await db.collection("rideRequests").doc(rideId).get();
        if (!currentRideDoc.exists) return;
        
        const currentRideData = currentRideDoc.data();
        
        if (currentRideData.status === 'driver_selected') {
          console.log(`⏰ Driver ${newDriver.id} didn't accept ride ${rideId} within 15s, finding next best driver...`);
          
          const nextBestDriver = await findBestAvailableDriver(currentRideData, newDriver.id, db);
          
          if (nextBestDriver) {
            await reassignRideToBetterDriver(rideId, currentRideData, nextBestDriver, db);
            console.log(`🔄 Ride ${rideId} reassigned to next best driver ${nextBestDriver.id}`);
          } else {
            await markRideAsNoDriversAvailable(rideId, currentRideData, db);
            console.log(`❌ No other drivers available for ride ${rideId}`);
          }
        }
      } catch (error) {
        console.error(`❌ Error in optimization countdown timer for ride ${rideId}:`, error);
      }
    }, 15000);
    
  } catch (error) {
    console.error(`❌ Error reassigning ride ${rideId} to better driver:`, error);
    throw error;
  }
}

// Utility function to calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Enhanced driver scoring algorithm
function calculateDriverScore(driver, pickupLat, pickupLng, rideType) {
  let score = 0;
  
  // Distance score (closer = higher score) - 60% weight
  if (driver.latitude && driver.longitude) {
    const distance = calculateDistance(pickupLat, pickupLng, driver.latitude, driver.longitude);
    const distanceScore = Math.max(0, 100 - (distance * 10)); // 100 points for 0km, 0 points for 10km+
    score += distanceScore * 0.6;
  }
  
  // Rating score - 20% weight
  if (driver.rating) {
    const ratingScore = (driver.rating / 5) * 100; // Convert 5-star rating to 100 points
    score += ratingScore * 0.2;
  }
  
  // Activity score (more recent = higher score) - 15% weight
  if (driver.lastOnlineUpdate) {
    const timeDiff = Date.now() - driver.lastOnlineUpdate.toDate();
    const hoursSinceOnline = timeDiff / (1000 * 60 * 60);
    const activityScore = Math.max(0, 100 - (hoursSinceOnline * 10)); // 100 points for 0 hours, 0 points for 10+ hours
    score += activityScore * 0.15;
  }
  
  // Fairness score (lower ride count = higher score) - 5% weight
  if (driver.totalRides) {
    const fairnessScore = Math.max(0, 100 - (driver.totalRides * 2)); // 100 points for 0 rides, 0 points for 50+ rides
    score += fairnessScore * 0.05;
  }
  
  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

// Enhanced function to find the best available driver
// ---------------------------------------------------------------------------
// Server-side pricing. The customer app shows an estimate, but the price that
// counts is computed here, so a modified app can't book a ride at any price.
// Same formula as the customer app (RideOptionsScreen.calculateFare).
// ---------------------------------------------------------------------------
const FARE_TABLE = {
  "Caval Privé": {base: 400, includedKm: 3, perKm: 150},
  "Caval moto": {base: 150, includedKm: 3, perKm: 150},
};

const straightLineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Road distance can't be shorter than the straight line, and is rarely more
// than ~2.5x it. The client's route distance is accepted only inside that
// range; otherwise the straight line x1.3 is used.
// ---------------------------------------------------------------------------
// Packages (serviceType: "delivery"). Prices are placeholders for the owner to
// set. Small and medium parcels go to motos first, then cars; large parcels
// need a car. The customer app has the same table in constants/delivery.js.
// ---------------------------------------------------------------------------
const DELIVERY_SIZES = {
  petit: {vehicles: ["Caval moto", "Caval Privé"], table: "Caval moto", surcharge: 0},
  moyen: {vehicles: ["Caval moto", "Caval Privé"], table: "Caval moto", surcharge: 100},
  grand: {vehicles: ["Caval Privé"], table: "Caval Privé", surcharge: 200},
};
const isDelivery = (ride) => ride && ride.serviceType === "delivery";
const deliverySize = (ride) => DELIVERY_SIZES[ride && ride.package && ride.package.size] || null;

// Driver types that may take this ride, in order of preference.
const driverTypesFor = (ride) => {
  if (isDelivery(ride)) return deliverySize(ride) ? deliverySize(ride).vehicles : [];
  return ride && ride.rideType ? [ride.rideType] : [];
};

// Filters online drivers, trying each allowed driver type in order and
// returning the first non-empty group.
const pickEligibleByType = (drivers, ride, isEligible) => {
  for (const type of driverTypesFor(ride)) {
    const group = drivers.filter((d) => d.driverType === type && isEligible(d));
    if (group.length) return group;
  }
  return [];
};

// Prices can be changed in the Console (appConfig/pricing) without a deploy.
// Missing values fall back to these defaults. All placeholders for the owner.
const DEFAULT_PRICING = {
  fares: FARE_TABLE,
  deliverySurcharge: {petit: 0, moyen: 100, grand: 200},
  intercity: {minKm: 25, "Caval Privé": {base: 1000, perKm: 120}, "Caval moto": {base: 500, perKm: 100}},
  hourly: {"Caval Privé": {perHour: 3000}, "Caval moto": {perHour: 1500}, maxHours: 8},
  rewards: {ridesPerReward: 10, rewardCredit: 500, referralCredit: 500},
};
let pricingCache = {at: 0, value: DEFAULT_PRICING};
async function getPricing(db) {
  if (Date.now() - pricingCache.at < 60 * 1000) return pricingCache.value;
  try {
    const snap = await db.collection("appConfig").doc("pricing").get();
    const c = snap.exists ? snap.data() : {};
    pricingCache = {at: Date.now(), value: {
      fares: {...DEFAULT_PRICING.fares, ...(c.fares || {})},
      deliverySurcharge: {...DEFAULT_PRICING.deliverySurcharge, ...(c.deliverySurcharge || {})},
      intercity: {...DEFAULT_PRICING.intercity, ...(c.intercity || {})},
      hourly: {...DEFAULT_PRICING.hourly, ...(c.hourly || {})},
      rewards: {...DEFAULT_PRICING.rewards, ...(c.rewards || {})},
    }};
  } catch (e) {
    console.error("appConfig/pricing unreadable, using defaults", e);
  }
  return pricingCache.value;
}

const MAX_STOPS = 2;
const rideStops = (ride) => (Array.isArray(ride.stops) ? ride.stops.slice(0, MAX_STOPS) : [])
    .map((st) => [Number(st.latitude), Number(st.longitude)]);

const computeServerFare = (ride, pricing = DEFAULT_PRICING) => {
  const fares = pricing.fares || FARE_TABLE;
  // Hourly hire: price per hour, no route
  if (ride.serviceType === "hourly") {
    const rate = pricing.hourly && pricing.hourly[ride.rideType];
    const hours = Math.round(Number(ride.hours));
    const maxH = (pricing.hourly && pricing.hourly.maxHours) || 8;
    if (!rate || !Number.isFinite(hours) || hours < 1 || hours > maxH) return null;
    return {fare: Math.round((rate.perHour * hours) / 50) * 50, km: 0};
  }
  let table = fares[ride.rideType];
  let surcharge = 0;
  if (isDelivery(ride)) {
    const size = deliverySize(ride);
    if (!size) return null;
    table = fares[size.table];
    surcharge = (pricing.deliverySurcharge || {})[ride.package.size] ?? size.surcharge;
  }
  const coords = [ride.pickupLat, ride.pickupLng, ride.destinationLat, ride.destinationLng].map(Number);
  if (!table || coords.some((n) => !Number.isFinite(n))) return null;
  // Straight-line length of pickup → stops → destination
  const points = [[coords[0], coords[1]], ...rideStops(ride), [coords[2], coords[3]]];
  if (points.flat().some((n) => !Number.isFinite(n))) return null;
  let straight = 0;
  for (let i = 1; i < points.length; i++) straight += straightLineKm(...points[i - 1], ...points[i]);
  const clientKm = Number(ride.distance);
  const km = Number.isFinite(clientKm) && clientKm >= straight && clientKm <= Math.max(straight * 2.5, straight + 2) ?
    clientKm : straight * 1.3;
  // Long trips between towns use the intercity rate
  const ic = pricing.intercity || {};
  const icRate = ic[isDelivery(ride) ? deliverySize(ride).table : ride.rideType];
  let fare;
  if (icRate && km >= (ic.minKm || 25)) {
    fare = icRate.base + km * icRate.perKm + surcharge;
  } else {
    fare = table.base + Math.max(0, km - table.includedKm) * table.perKm + surcharge;
  }
  return {fare: Math.round(fare / 50) * 50, km: Math.round(km * 100) / 100, intercity: !!(icRate && km >= (ic.minKm || 25))};
};

async function findBestAvailableDriver(rideData, excludedDriverId = null, db) {
  try {
    const { rideType, pickupLat, pickupLng } = rideData;
    
    if (!pickupLat || !pickupLng) {
      console.log('❌ No pickup coordinates provided for distance calculation');
      return null;
    }
    
    console.log(`🔍 Finding best driver for ride type: ${rideType}`);
    console.log(`📍 Pickup coordinates: ${pickupLat}, ${pickupLng}`);
    
    // Get all online drivers of the specified type from OnlineDriver collection
    const onlineDriverDoc = await db.collection('OnlineDriver').doc('summary').get();
    
    if (!onlineDriverDoc.exists) {
      console.log('❌ No OnlineDriver summary document found');
      return null;
    }
    
    const onlineDriverData = onlineDriverDoc.data();
    if (!onlineDriverData.drivers || onlineDriverData.drivers.length === 0) {
      console.log('❌ No online drivers found in summary document');
      return null;
    }
    
    // Filter drivers by type and availability
    const excluded = new Set([...(rideData.declinedDrivers || []), excludedDriverId].filter(Boolean));
    const eligibleDrivers = pickEligibleByType(onlineDriverData.drivers, rideData, (driver) =>
      driver.isAvailable !== false &&
      !driver.rideInProgress &&
      !excluded.has(driver.id) &&
      driver.latitude &&
      driver.longitude
    );
    
    if (eligibleDrivers.length === 0) {
      console.log(`❌ No eligible drivers found for ride type: ${rideType}`);
      return null;
    }
    
    console.log(`🔍 Found ${eligibleDrivers.length} eligible drivers`);
    
    // Calculate scores for each driver
    const driversWithScores = eligibleDrivers.map(driver => {
      const distance = calculateDistance(pickupLat, pickupLng, driver.latitude, driver.longitude);
      const driverScore = calculateDriverScore(driver, pickupLat, pickupLng, rideType) +
        preferenceBonus(rideData, driver, distance);
      
      return {
        id: driver.id,
        firstName: driver.firstName || "Driver",
        lastName: driver.lastName || "",
        phoneNumber: driver.phoneNumber || "",
        photo: driver.photo || "",
        rating: driver.rating || 0,
        totalRides: driver.totalRides || 0,
        latitude: driver.latitude,
        longitude: driver.longitude,
        expoPushToken: driver.expoPushToken,
        lastOnlineUpdate: driver.lastOnlineUpdate,
          score: driverScore,
        distance: distance
      };
    });
    
    // Sort by score (highest first), then by distance (closest first) as tiebreaker
    driversWithScores.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.distance - b.distance;
    });
    
    // Log top 3 drivers for debugging
    console.log('🏆 Top 3 drivers by score:');
    driversWithScores.slice(0, 3).forEach((driver, index) => {
      console.log(`${index + 1}. ${driver.firstName} (${driver.id}) - Score: ${driver.score}, Distance: ${driver.distance.toFixed(2)}km`);
    });
    
    const bestDriver = driversWithScores[0];
    console.log(`✅ Best driver selected: ${bestDriver.firstName} (${bestDriver.id})`);
    console.log(`📊 Final score: ${bestDriver.score}, Distance: ${bestDriver.distance.toFixed(2)}km`);
    
    return bestDriver;
    
  } catch (error) {
    console.error('❌ Error finding best available driver:', error);
    return null;
  }
}

// Function that triggers when a NEW ride request is created
exports.selectBestDriverForNewRideRequest = onDocumentCreated({
  document: "rideRequests/{rideId}",
  secrets: [ULTRAMSG_TOKEN],
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (event) => {
  console.log('🚨 FUNCTION TRIGGERED: selectBestDriverForNewRideRequest - START');
  
  const db = getFirestore();
  
  try {
    console.log('🚨 FUNCTION TRIGGERED: selectBestDriverForNewRideRequest');
    console.log('📋 Event data:', JSON.stringify(event, null, 2));
    
    const rideData = event.data && event.data.data ? event.data.data() : null;
    console.log('📋 Ride data received:', rideData);
    
    if (!rideData) {
      console.log('❌ No ride data found in event');
      return;
    }
    
    if (rideData.status !== 'waiting') {
      console.log(`⏭️ Skipping ride ${event.params.rideId} - status is ${rideData.status}, not 'waiting'`);
      return;
    }
    
    const rideId = event.params.rideId;
    console.log(`🚨 NEW RIDE REQUEST CREATED: Processing ride ${rideId} for type: ${rideData.rideType}`);

    // Server-side price: overwrite whatever fare the app sent.
    const pricing = await getPricing(db);
    const priced = computeServerFare(rideData, pricing);
    if (!priced) {
      console.log(`❌ Ride ${rideId} has an invalid ride type or coordinates, cancelling`);
      await db.collection("rideRequests").doc(rideId).update({
        status: "cancelled", cancelledBy: "system", cancellationReason: "invalid_ride_request",
      });
      return;
    }
    const pricedUpdate = {
      fare: priced.fare,
      fareSource: "server",
      billedDistanceKm: priced.km,
      clientFare: rideData.fare === undefined ? null : rideData.fare,
    };
    // Promo code and Caval credit
    const discount = await applyDiscounts(db, rideId, rideData, priced.fare);
    Object.assign(pricedUpdate, discount.update);
    if (priced.intercity) pricedUpdate.intercity = true;
    // Packages: the vehicle follows the parcel size, not the customer's choice.
    if (isDelivery(rideData) && !driverTypesFor(rideData).includes(rideData.rideType)) {
      pricedUpdate.rideType = driverTypesFor(rideData)[0];
      rideData.rideType = pricedUpdate.rideType;
    }
    await db.collection("rideRequests").doc(rideId).update(pricedUpdate);
    rideData.fare = pricedUpdate.fare;
    
    // Check if we have a rideType
    if (!rideData.rideType) {
      console.log('❌ No rideType specified in ride data');
      return;
    }
    
    console.log('🔍 Looking for available drivers...');
    
    // Use enhanced driver selection algorithm
    console.log('🔍 Using enhanced driver selection algorithm...');
    
    const bestDriver = await findBestAvailableDriver(rideData, null, db);
    
    if (!bestDriver) {
      console.log(`❌ No suitable drivers found for ride type: ${rideData.rideType}`);
      console.log('🔍 Available driver types in system:');
      
      // Let's check what driver types exist in OnlineDriver collection
      try {
        const onlineDriverDoc = await db.collection('OnlineDriver').doc('summary').get();
        if (onlineDriverDoc.exists) {
          const onlineDriverData = onlineDriverDoc.data();
          if (onlineDriverData.drivers && onlineDriverData.drivers.length > 0) {
        const driverTypes = new Set();
            onlineDriverData.drivers.forEach(driver => {
              if (driver.driverType) {
                driverTypes.add(driver.driverType);
              }
            });
            console.log('🔍 Available driver types in OnlineDriver:', Array.from(driverTypes));
            console.log(`🔍 Total online drivers: ${onlineDriverData.drivers.length}`);
          } else {
            console.log('🔍 No drivers in OnlineDriver summary');
          }
        } else {
          console.log('🔍 No OnlineDriver summary document found');
        }
      } catch (error) {
        console.log('❌ Could not check OnlineDriver collection:', error);
      }
      return;
    }
    
    console.log(`🔍 Driver data:`, {
      id: bestDriver.id,
      firstName: bestDriver.firstName,
      score: bestDriver.score,
      distance: bestDriver.distance,
      rating: bestDriver.rating,
      totalRides: bestDriver.totalRides
    });
    
    // Calculate countdown times
    const now = new Date();
    const countdownExpiryTime = new Date(now.getTime() + 15000); // 15 seconds from now
    
    console.log('📝 Creating SelectedDriver document...');
    
    // Store selection data with countdown
    await db.collection("SelectedDriver").doc(rideId).set({
      rideId: rideId,
      selectedDriverId: bestDriver.id,
      status: 'selected',
      timestamp: now,
      countdownStartedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      countdownSeconds: 15,
      isCountdownActive: true,
      driverScore: bestDriver.score,
      driverDistance: bestDriver.distance
    });
    
    console.log('✅ SelectedDriver document created successfully');
    
    console.log('📝 Updating ride request...');
    
    // Update ride request
    await db.collection("rideRequests").doc(rideId).update({
      selectedDriverId: bestDriver.id,
      status: 'driver_selected',
      driverSelectedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      driverScore: bestDriver.score,
      driverDistance: bestDriver.distance
    });
    
    console.log('✅ Ride request updated successfully');
    
    console.log(`🎯 Ride ${rideId} assigned to driver ${bestDriver.id} with 15s countdown`);
    
    // Send WhatsApp message immediately after driver selection
    if (bestDriver.phoneNumber) {
      try {
        console.log(`📱 Sending WhatsApp message to driver ${bestDriver.id}...`);
        
        const whatsappMessage = `🚗 *Nouvelle course disponible!*

Bonjour ${bestDriver.firstName || "Chauffeur"},

Une nouvelle course vous attend dans l'application Caval Courrier!

📍 *Départ:* ${rideData.pickupAddress || "Adresse de départ"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse de destination"}
💰 *Prix:* Fdj${rideData.fare || "0"}
⏰ *Temps de réponse:* 15 secondes

*Ouvrez l'application maintenant pour accepter la course!*

Caval Team`;
        
        await sendWhatsAppMessage(bestDriver.phoneNumber, whatsappMessage);
        console.log(`✅ WhatsApp message sent successfully to driver ${bestDriver.id}`);
      } catch (whatsappError) {
        console.error(`❌ Error sending WhatsApp message to driver ${bestDriver.id}:`, whatsappError);
        // Don't fail the process if WhatsApp fails
      }
    } else {
      console.log(`⚠️ Driver ${bestDriver.id} has no phone number for WhatsApp message`);
    }
    
    // Send push notification to the selected driver
    try {
      if (bestDriver.expoPushToken) {
        console.log(`📱 Sending push notification to driver ${bestDriver.id}...`);
        
        const notificationData = {
          type: "new_ride_offer",
          rideId: rideId,
          driverId: bestDriver.id,
          fare: (rideData.fare && rideData.fare.toString()) || "0",
          pickupAddress: rideData.pickupAddress || "",
          destinationAddress: rideData.destinationAddress || "",
          rideType: rideData.rideType,
          countdownSeconds: 15,
          priority: "high",
          sound: "default",
          badge: 1,
          driverScore: bestDriver.score,
          driverDistance: bestDriver.distance
        };
        
        // Send push notification with enhanced data
        const notificationResult = await sendEnhancedPushNotification(
          bestDriver.expoPushToken,
          "🎯 Course assignée!",
          `Nouvelle course disponible! Départ: ${rideData.pickupAddress || 'Adresse de départ'} (15s pour répondre)`,
          notificationData,
          bestDriver.id
        );
        
        if (notificationResult.success) {
          console.log(`✅ Push notification sent successfully to driver ${bestDriver.id} via ${notificationResult.method}`);
        } else {
          console.error(`❌ Push notification failed for driver ${bestDriver.id}:`, notificationResult.error);
          
          // Try to send a simple notification as fallback
          try {
            const simpleNotification = await sendExpoPushNotification(
              bestDriver.expoPushToken,
              "🎯 Course assignée!",
              "Nouvelle course disponible! Ouvrez l'app maintenant.",
              { type: "ride_offer", rideId: rideId }
            );
            console.log(`🔄 Fallback notification sent successfully to driver ${bestDriver.id}`);
          } catch (fallbackError) {
            console.error(`❌ Fallback notification also failed for driver ${bestDriver.id}:`, fallbackError);
          }
        }
      } else {
        console.log(`⚠️ Driver ${bestDriver.id} has no Expo push token - they won't receive notifications`);
        
        // Try to get the token from a different field
        const alternativeToken = bestDriver.pushToken || bestDriver.fcmToken || bestDriver.token;
        if (alternativeToken) {
          console.log(`🔄 Found alternative token for driver ${bestDriver.id}, attempting notification...`);
          try {
            await sendEnhancedPushNotification(
              alternativeToken,
              "🎯 Course assignée!",
              "Nouvelle course disponible! Ouvrez l'app maintenant.",
              { type: "ride_offer", rideId: rideId },
              bestDriver.id
            );
          } catch (altError) {
            console.error(`❌ Alternative token notification failed:`, altError);
          }
        }
      }
    } catch (notificationError) {
      console.error(`❌ Critical error sending notification to driver ${bestDriver.id}:`, notificationError);
      // Continue with the process even if notification fails
    }
    
    console.log('⏰ Setting up countdown timer...');
    
    // Start countdown timer for auto-reassignment
    setTimeout(async () => {
      try {
        console.log(`⏰ Countdown expired for ride ${rideId}, checking if driver accepted...`);
        
        // Check if the ride status has changed from 'driver_selected' to 'assigned'
        const rideDoc = await db.collection("rideRequests").doc(rideId).get();
        if (!rideDoc.exists) {
          console.log(`❌ Ride ${rideId} no longer exists, skipping countdown check`);
          return;
        }
        
        const currentRideData = rideDoc.data();
        
        // If status is still 'driver_selected', driver didn't accept - reassign
        if (currentRideData.status === 'driver_selected') {
          console.log(`⏰ Driver ${bestDriver.id} didn't accept ride ${rideId} within 15s, reassigning...`);
          
          // Find next available driver using enhanced algorithm
          const nextDriver = await findBestAvailableDriver(currentRideData, bestDriver.id, db);
          
          if (nextDriver) {
            // Reassign to next driver
            await reassignRideToNextDriver(rideId, nextDriver, currentRideData, db);
            console.log(`🔄 Ride ${rideId} reassigned to next driver ${nextDriver.id} (Score: ${nextDriver.score}, Distance: ${nextDriver.distance.toFixed(2)}km)`);
          } else {
            // No other drivers available
            await markRideAsNoDriversAvailable(rideId, currentRideData, db);
            console.log(`❌ No other drivers available for ride ${rideId}`);
          }
        } else {
          console.log(`✅ Ride ${rideId} status changed to ${currentRideData.status}, countdown no longer needed`);
        }
        
      } catch (error) {
        console.error(`❌ Error in countdown timer for ride ${rideId}:`, error);
      }
    }, 15000);
    
    console.log('✅ Function completed successfully');
    
  } catch (error) {
    console.error(`❌ Error in selectBestDriverForNewRideRequest:`, error);
    console.error('Error details:', error.stack);
  }
});





// ============================================================================
// NEW: Ride Status Change Handler - Minimal Version
// ============================================================================

exports.handleRideStatusChange = onDocumentUpdated({
  document: "rideRequests/{rideId}",
  secrets: [ULTRAMSG_TOKEN],
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (event) => {
  const db = getFirestore();
  
  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    if (!beforeData || !afterData) return;
    
    const rideId = event.params.rideId;
    const previousStatus = beforeData.status;
    const newStatus = afterData.status;
    
    console.log(`Ride ${rideId} status changed from ${previousStatus} to ${newStatus}`);
    
    // Handle ride assignment when driver accepts
    if (newStatus === 'assigned') {
      console.log(`Driver accepted ride ${rideId}, updating SelectedDriver collection and canceling countdown`);
      try {
        await db.collection("SelectedDriver").doc(rideId).update({
          status: "assigned",
          assignedAt: new Date(),
          driverId: afterData.driverId || afterData.selectedDriverId,
          isCountdownActive: false, // Cancel the countdown
          countdownCancelledAt: new Date()
        });
        console.log(`SelectedDriver collection updated to assigned status for ride ${rideId}`);
      } catch (error) {
        console.error(`Error updating SelectedDriver for assigned ride ${rideId}:`, error);
      }
    }
    
    // Handle driver arrival
    if (newStatus === 'driver_arrived') {
      console.log(`Driver arrived for ride ${rideId}, sending notifications to passenger`);
      try {
        // Get passenger information
        const passengerId = afterData.passengerId || afterData.userId;
        if (passengerId) {
          // Send notifications to passenger using the dedicated function
          const notificationResult = await sendPassengerNotification(passengerId, rideId, "driver_arrived", db);
          
          if (notificationResult.success) {
            console.log(`✅ Passenger notifications sent successfully for ride ${rideId}`);
          } else {
            console.log(`⚠️ Some passenger notifications failed for ride ${rideId}:`, notificationResult.error);
          }
          
          // Update SelectedDriver collection
          await db.collection("SelectedDriver").doc(rideId).update({
            status: "driver_arrived",
            driverArrivedAt: new Date(),
            passengerNotifiedAt: new Date(),
            notificationStatus: notificationResult
          });
          console.log(`SelectedDriver collection updated to driver_arrived status for ride ${rideId}`);
          
        } else {
          console.log(`⚠️ No passenger ID found in ride data for ride ${rideId}`);
        }
      } catch (error) {
        console.error(`Error handling driver_arrived status for ride ${rideId}:`, error);
      }
    }
    
    // Handle ride started
    if (newStatus === 'ride_started' || newStatus === 'picked_up') {
      console.log(`Ride ${rideId} started, sending notifications to passenger`);
      try {
        // Get passenger information
        const passengerId = afterData.passengerId || afterData.userId;
        if (passengerId) {
          // Send notifications to passenger using the dedicated function
          const notificationResult = await sendPassengerNotification(passengerId, rideId, "ride_started", db);
          
          if (notificationResult.success) {
            console.log(`✅ Ride started notifications sent successfully for ride ${rideId}`);
          } else {
            console.log(`⚠️ Some ride started notifications failed for ride ${rideId}:`, notificationResult.error);
          }
          
          // Update SelectedDriver collection
          await db.collection("SelectedDriver").doc(rideId).update({
            status: "ride_started",
            rideStartedAt: new Date(),
            passengerNotifiedAt: new Date(),
            notificationStatus: notificationResult
          });
          console.log(`SelectedDriver collection updated to ride_started status for ride ${rideId}`);
          
        } else {
          console.log(`⚠️ No passenger ID found in ride data for ride ${rideId}`);
        }
      } catch (error) {
        console.error(`Error handling ride_started status for ride ${rideId}:`, error);
      }
    }
    
    // Handle passenger ready
    if (newStatus === 'passenger_ready') {
      console.log(`Passenger ready for ride ${rideId}, sending notifications to driver`);
      try {
        // Get driver information
        const driverId = afterData.selectedDriverId || afterData.driverId;
        if (driverId) {
          // Send notifications to driver using the dedicated function
          const notificationResult = await sendDriverNotification(driverId, rideId, "passenger_ready", db);
          
          if (notificationResult.success) {
            console.log(`✅ Driver notifications sent successfully for ride ${rideId}`);
          } else {
            console.log(`⚠️ Some driver notifications failed for ride ${rideId}:`, notificationResult.error);
          }
          
          // Update SelectedDriver collection
          await db.collection("SelectedDriver").doc(rideId).update({
            status: "passenger_ready",
            passengerReadyAt: new Date(),
            driverNotifiedAt: new Date(),
            notificationStatus: notificationResult
          });
          console.log(`SelectedDriver collection updated to passenger_ready status for ride ${rideId}`);
          
        } else {
          console.log(`⚠️ No driver ID found in ride data for ride ${rideId}`);
        }
      } catch (error) {
        console.error(`Error handling passenger_ready status for ride ${rideId}:`, error);
      }
    }
    
    // Handle ride completion
    if (newStatus === 'completed' && previousStatus !== 'completed') {
      try {
        await recordDriverEarnings(db, rideId);
      } catch (error) {
        console.error(`Error recording earnings for ride ${rideId}:`, error);
      }
    }

    if (newStatus === 'completed') {
      console.log(`Ride ${rideId} completed, updating SelectedDriver collection`);
      try {
        await db.collection("SelectedDriver").doc(rideId).update({
          status: "completed",
          completedAt: new Date()
        });
        console.log(`SelectedDriver collection updated to completed status for ride ${rideId}`);
      } catch (error) {
        console.error(`Error updating SelectedDriver for completed ride ${rideId}:`, error);
      }
    }
    
    // Handle ride cancellation
    if (newStatus === 'cancelled') {
      console.log(`Ride ${rideId} cancelled, sending notifications to driver`);
      try {
        // Get driver information
        const driverId = afterData.selectedDriverId || afterData.driverId;
        if (driverId) {
          // Send notifications to driver using the dedicated function
          const notificationResult = await sendDriverNotification(driverId, rideId, "ride_cancelled", db);
          
          if (notificationResult.success) {
            console.log(`✅ Driver cancellation notifications sent successfully for ride ${rideId}`);
          } else {
            console.log(`⚠️ Some driver cancellation notifications failed for ride ${rideId}:`, notificationResult.error);
          }
          
          // Update SelectedDriver collection
          await db.collection("SelectedDriver").doc(rideId).update({
            status: "cancelled",
            cancelledAt: new Date(),
            driverNotifiedAt: new Date(),
            cancellationReason: afterData.cancellationReason || "Cancelled by passenger",
            notificationStatus: notificationResult
          });
          console.log(`SelectedDriver collection updated to cancelled status for ride ${rideId}`);
          
        } else {
          console.log(`⚠️ No driver ID found in ride data for ride ${rideId}`);
        }
      } catch (error) {
        console.error(`Error handling cancelled status for ride ${rideId}:`, error);
      }
    }
    
  } catch (error) {
    console.error(`Error in handleRideStatusChange:`, error);
  }
});

// ============================================================================
// Helper Functions for Countdown and Reassignment System
// ============================================================================

async function findNextAvailableDriver(rideData, excludedDriverId, db) {
  try {
    const { rideType } = rideData;
    
    // Get all online drivers of the specified type from OnlineDriver collection, excluding the declined driver
    const onlineDriverDoc = await db.collection('OnlineDriver').doc('summary').get();
    
    if (!onlineDriverDoc.exists) {
      console.log('No OnlineDriver summary document found');
      return null;
    }
    
    const onlineDriverData = onlineDriverDoc.data();
    if (!onlineDriverData.drivers || onlineDriverData.drivers.length === 0) {
      console.log('No online drivers found in summary document');
      return null;
    }
    
    // Filter drivers by type and availability, excluding the declined driver
    const eligibleDrivers = pickEligibleByType(onlineDriverData.drivers, rideData, (driver) =>
      driver.isAvailable !== false &&
      !driver.rideInProgress &&
      driver.id !== excludedDriverId
    );
    
    if (eligibleDrivers.length === 0) {
      console.log('No other eligible drivers found');
      return null;
    }
    
    // Simple selection - just pick the first available
    const nextDriver = eligibleDrivers[0];
    console.log(`Next driver selected: ${nextDriver.id}`);
    
    return nextDriver;
    
  } catch (error) {
    console.error('Error finding next available driver:', error);
    return null;
  }
}

async function reassignRideToNextDriver(rideId, nextDriver, rideData, db) {
  try {
    // Calculate new countdown times
    const now = new Date();
    const countdownExpiryTime = new Date(now.getTime() + 15000); // 15 seconds from now
    
    // Update the ride request with the new driver
    await db.collection("rideRequests").doc(rideId).update({
      selectedDriverId: nextDriver.id,
      status: "driver_selected",
      driverSelectedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      reassignmentAttempts: FieldValue.increment(1),
      lastReassignmentTime: now
    });
    
    // Update the SelectedDriver collection
    await db.collection("SelectedDriver").doc(rideId).update({
      status: "reassigned",
      selectedDriverId: nextDriver.id,
      reassignedAt: now,
      reassignedToDriver: nextDriver.id,
      reassignmentAttempt: FieldValue.increment(1),
      countdownStartedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      countdownSeconds: 15,
      isCountdownActive: true
    });
    
    console.log(`Ride ${rideId} successfully reassigned to driver ${nextDriver.id}`);
    
    // Send push notification to the reassigned driver
    try {
      // Get the driver's push token
      const driverDoc = await db.collection("Drivers").doc(nextDriver.id).get();
      if (driverDoc.exists()) {
        const driverData = driverDoc.data();
        
        if (driverData.expoPushToken) {
          const notificationData = {
            type: "ride_reassigned",
            rideId: rideId,
            driverId: nextDriver.id,
            fare: (rideData.fare && rideData.fare.toString()) || "0",
            pickupAddress: rideData.pickupAddress || "",
            destinationAddress: rideData.destinationAddress || "",
            rideType: rideData.rideType,
            countdownSeconds: 15,
            isReassigned: true
          };
          
          await sendEnhancedPushNotification(
            driverData.expoPushToken,
            "🔄 Course réassignée!",
            "Une course a été réassignée à vous! Ouvrez l'app pour voir l'offre. (15s pour répondre)",
            notificationData,
            nextDriver.id
          );
          
          console.log(`Reassignment notification sent to driver ${nextDriver.id} for ride ${rideId}`);
        } else {
          console.log(`Reassigned driver ${nextDriver.id} has no Expo push token`);
        }
      }
    } catch (notificationError) {
      console.error(`Error sending reassignment notification to driver ${nextDriver.id}:`, notificationError);
      // Continue with the process even if notification fails
    }
    
    // Start new countdown timer for the reassigned driver
    setTimeout(async () => {
      try {
        console.log(`Reassignment countdown expired for ride ${rideId}, checking if driver accepted...`);
        
        const rideDoc = await db.collection("rideRequests").doc(rideId).get();
        if (!rideDoc.exists) return;
        
        const currentRideData = rideDoc.data();
        
        // If status is still 'driver_selected', driver didn't accept - mark as no drivers available
        if (currentRideData.status === 'driver_selected') {
          console.log(`Driver ${nextDriver.id} didn't accept ride ${rideId}, marking as no drivers available`);
              await markRideAsNoDriversAvailable(rideId, currentRideData, db);
        }
        
      } catch (error) {
        console.error(`Error in reassignment countdown timer for ride ${rideId}:`, error);
      }
    }, 15000);
    
  } catch (error) {
    console.error('Error reassigning ride to next driver:', error);
  }
}

async function markRideAsNoDriversAvailable(rideId, rideData, db) {
  try {
    // Update the ride request status
    await db.collection("rideRequests").doc(rideId).update({
      status: "no_drivers_available",
      noDriversAvailableAt: new Date()
    });
    
    // Update the SelectedDriver collection
    await db.collection("SelectedDriver").doc(rideId).update({
      status: "no_drivers_available",
      noDriversAvailableAt: new Date(),
      reason: "All eligible drivers have declined or are unavailable"
    });
    
    console.log(`Ride ${rideId} marked as no drivers available`);
    
    // Send notification to admin (optional - you can customize this)
    try {
      // You can add admin notification logic here if needed
      // For example, send WhatsApp message to admin or update admin dashboard
      console.log(`Admin should be notified that ride ${rideId} has no available drivers`);
    } catch (adminNotificationError) {
      console.error(`Error notifying admin about no drivers for ride ${rideId}:`, adminNotificationError);
    }
    
  } catch (error) {
    console.error('Error marking ride as no drivers available:', error);
  }
}


// ---------------------------------------------------------------------------
// Driver earnings are written only here, once per completed ride, using the
// server-computed fare. The driver app can read them but not write them.
//   moneyByRider/{driverId}_{YYYYMMDD}  (Djibouti date, read by EarningsScreen)
//   Earnings/{driverId}.dailyBreakdown[YYYY-MM-DD].total  (read by PaymentScreen)
// ---------------------------------------------------------------------------
const djiboutiDate = (d) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Djibouti", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d); // YYYY-MM-DD
  return parts;
};

async function recordDriverEarnings(db, rideId) {
  const rideRef = db.collection("rideRequests").doc(rideId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) return;
    const ride = snap.data();
    if (ride.earningsRecordedAt) return; // already counted
    const driverId = ride.driverId;
    const fare = Number(ride.fare);
    if (!driverId || !Number.isFinite(fare) || fare <= 0) return;

    const now = new Date();
    const day = djiboutiDate(now);
    const moneyRef = db.collection("moneyByRider").doc(`${driverId}_${day.replace(/-/g, "")}`);
    const earningsRef = db.collection("Earnings").doc(driverId);

    tx.set(moneyRef, {
      driverId,
      total: FieldValue.increment(fare),
      trips: FieldValue.arrayUnion({rideId, fare, timestamp: now.toISOString()}),
    }, {merge: true});
    tx.set(earningsRef, {
      totalEarnings: FieldValue.increment(fare),
      dailyBreakdown: {[day]: {total: FieldValue.increment(fare), trips: FieldValue.increment(1)}},
      updatedAt: now,
    }, {merge: true});
    tx.update(rideRef, {earningsRecordedAt: now});
  });
}

// Helper function to increment values
function increment(value) {
  return (value || 0) + 1;
}

// Cloud Function to ensure driver availability when going online
exports.ensureDriverAvailability = onDocumentUpdated({
  document: "Drivers/{driverId}",
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (event) => {
  const db = getFirestore();

  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    if (!beforeData || !afterData) return;

    // Check if driver just went online
    if (!beforeData.isOnline && afterData.isOnline) {
      console.log(`🚗 Driver ${event.params.driverId} just went online, ensuring availability`);
      
      // Ensure driver is marked as available when going online
      await db.collection("Drivers").doc(event.params.driverId).update({
        isAvailable: true,
        lastOnlineUpdate: new Date(),
        lastAvailabilityUpdate: new Date()
      });
      
      console.log(`✅ Driver ${event.params.driverId} marked as available`);
    }
    
    // Check if driver just went offline
    if (beforeData.isOnline && !afterData.isOnline) {
      console.log(`🚫 Driver ${event.params.driverId} just went offline, updating status`);
      
      // Mark driver as unavailable when going offline
      await db.collection("Drivers").doc(event.params.driverId).update({
        isAvailable: false,
        lastOfflineUpdate: new Date(),
        lastAvailabilityUpdate: new Date()
      });
      
      console.log(`✅ Driver ${event.params.driverId} marked as unavailable`);
    }
    
  } catch (error) {
    console.error('Error in ensureDriverAvailability:', error);
  }
});

// Function to send passenger notification (push + WhatsApp)
const sendPassengerNotification = async (passengerId, rideId, notificationType, db) => {
  try {
    // Customers are stored in Customers (the customer app); Users is legacy.
    let passengerDoc = await db.collection("Customers").doc(passengerId).get();
    if (!passengerDoc.exists) passengerDoc = await db.collection("Users").doc(passengerId).get();
    if (!passengerDoc.exists) {
      console.log(`⚠️ Passenger document not found for ID: ${passengerId}`);
      return { success: false, error: 'Passenger not found' };
    }
    
    const passengerData = passengerDoc.data();
    const passengerPhone = phoneOf(passengerData);
    const passengerName = passengerData.firstName || passengerData.name || "Passager";
    
    // Get ride details
    const rideDoc = await db.collection("rideRequests").doc(rideId).get();
    if (!rideDoc.exists) {
      console.log(`⚠️ Ride document not found for ID: ${rideId}`);
      return { success: false, error: 'Ride not found' };
    }
    
    const rideData = rideDoc.data();
    
    // Get driver information
    const driverId = rideData.selectedDriverId || rideData.driverId;
    let driverName = "Chauffeur";
    if (driverId) {
      const driverDoc = await db.collection("Drivers").doc(driverId).get();
      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        driverName = driverData.firstName || driverData.name || "Chauffeur";
      }
    }
    
    let notificationSent = false;
    let whatsappSent = false;
    
    // Send push notification to passenger if they have a push token
    if (passengerData.expoPushToken || passengerData.pushToken) {
      const pushToken = passengerData.expoPushToken || passengerData.pushToken;
      console.log(`📱 Sending push notification to passenger ${passengerId}...`);
      
      const notificationData = {
        type: notificationType,
        rideId: rideId,
        driverId: driverId,
        driverName: driverName,
        pickupAddress: rideData.pickupAddress || "",
        destinationAddress: rideData.destinationAddress || "",
        priority: "high",
        sound: "default",
        badge: 1
      };
      
      try {
        await sendEnhancedPushNotification(
          pushToken,
          "🚗 Chauffeur arrivé!",
          `Votre chauffeur ${driverName} est arrivé au point de départ.`,
          notificationData,
          passengerId
        );
        console.log(`✅ Push notification sent successfully to passenger ${passengerId}`);
        notificationSent = true;
      } catch (pushError) {
        console.error(`❌ Error sending push notification to passenger ${passengerId}:`, pushError);
      }
    } else {
      console.log(`⚠️ Passenger ${passengerId} has no push token`);
    }
    
    // Send WhatsApp message to passenger
    if (passengerPhone) {
      console.log(`📱 Sending WhatsApp message to passenger ${passengerId} at ${passengerPhone}...`);
      
      let whatsappMessage = "";
      
      if (notificationType === "driver_arrived") {
        whatsappMessage = `🚗 *Chauffeur arrivé!*

Bonjour ${passengerName},

Votre chauffeur ${driverName} est arrivé au point de départ!

📍 *Point de départ:* ${rideData.pickupAddress || "Adresse de départ"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse de destination"}
💰 *Prix:* Fdj${rideData.fare || "0"}

⏰ *Temps de trajet estimé:* ~${Math.round((rideData.distance || 5) / 30 * 60)} min

*Veuillez vous diriger vers le point de départ pour commencer votre trajet.*

Caval Team`;
      } else if (notificationType === "ride_started") {
        whatsappMessage = `🚗 *Trajet commencé!*

Bonjour ${passengerName},

Votre trajet avec ${driverName} a commencé!

📍 *Point de départ:* ${rideData.pickupAddress || "Adresse de départ"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse de destination"}
💰 *Prix:* Fdj${rideData.fare || "0"}

*Bon voyage! 🚗✨*

Caval Team`;
      }
      
      if (whatsappMessage) {
        try {
          await sendWhatsAppMessage(passengerPhone, whatsappMessage);
          console.log(`✅ WhatsApp message sent successfully to passenger ${passengerId}`);
          whatsappSent = true;
        } catch (whatsappError) {
          console.error(`❌ Error sending WhatsApp message to passenger ${passengerId}:`, whatsappError);
        }
      }
    } else {
      console.log(`⚠️ Passenger ${passengerId} has no phone number for WhatsApp message`);
    }
    
    // Log notification status
    const status = {
      success: notificationSent || whatsappSent,
      pushNotification: notificationSent,
      whatsappMessage: whatsappSent,
      passengerId: passengerId,
      rideId: rideId,
      notificationType: notificationType
    };
    
    console.log(`📊 Passenger notification status:`, status);
    return status;
    
  } catch (error) {
    console.error(`❌ Error in sendPassengerNotification for passenger ${passengerId}:`, error);
    return { success: false, error: error.message };
  }
};

// Function to send driver notification (push + WhatsApp)
const sendDriverNotification = async (driverId, rideId, notificationType, db) => {
  try {
    // Get driver details from Drivers collection
    const driverDoc = await db.collection("Drivers").doc(driverId).get();
    if (!driverDoc.exists) {
      console.log(`⚠️ Driver document not found for ID: ${driverId}`);
      return { success: false, error: 'Driver not found' };
    }
    
    const driverData = driverDoc.data();
    const driverPhone = driverData.phoneNumber;
    const driverName = driverData.firstName || driverData.name || "Chauffeur";
    
    // Get ride details
    const rideDoc = await db.collection("rideRequests").doc(rideId).get();
    if (!rideDoc.exists) {
      console.log(`⚠️ Ride document not found for ID: ${rideId}`);
      return { success: false, error: 'Ride not found' };
    }
    
    const rideData = rideDoc.data();
    
    // Get passenger information
    const passengerId = rideData.passengerId || rideData.userId;
    let passengerName = "Passager";
    if (passengerId) {
      let passengerDoc = await db.collection("Customers").doc(passengerId).get();
      if (!passengerDoc.exists) passengerDoc = await db.collection("Users").doc(passengerId).get();
      if (passengerDoc.exists) {
        const passengerData = passengerDoc.data();
        passengerName = passengerData.firstName || passengerData.name || "Passager";
      }
    }
    
    let notificationSent = false;
    let whatsappSent = false;
    
    // Send push notification to driver if they have a push token
    if (driverData.expoPushToken || driverData.pushToken) {
      const pushToken = driverData.expoPushToken || driverData.pushToken;
      console.log(`📱 Sending push notification to driver ${driverId}...`);
      
      let notificationTitle = "";
      let notificationBody = "";
      
      if (notificationType === "passenger_ready") {
        notificationTitle = "👤 Passager prêt!";
        notificationBody = `Le passager ${passengerName} est prêt à partir.`;
      } else if (notificationType === "ride_cancelled") {
        notificationTitle = "❌ Course annulée";
        notificationBody = `La course a été annulée par le passager.`;
      }
      
      const notificationData = {
        type: notificationType,
        rideId: rideId,
        driverId: driverId,
        passengerId: passengerId,
        passengerName: passengerName,
        pickupAddress: rideData.pickupAddress || "",
        destinationAddress: rideData.destinationAddress || "",
        priority: "high",
        sound: "default",
        badge: 1
      };
      
      try {
        await sendEnhancedPushNotification(
          pushToken,
          notificationTitle,
          notificationBody,
          notificationData,
          driverId
        );
        console.log(`✅ Push notification sent successfully to driver ${driverId}`);
        notificationSent = true;
      } catch (pushError) {
        console.error(`❌ Error sending push notification to driver ${driverId}:`, pushError);
      }
    } else {
      console.log(`⚠️ Driver ${driverId} has no push token`);
    }
    
    // Send WhatsApp message to driver
    if (driverPhone) {
      console.log(`📱 Sending WhatsApp message to driver ${driverId} at ${driverPhone}...`);
      
      let whatsappMessage = "";
      
      if (notificationType === "passenger_ready") {
        whatsappMessage = `👤 *Passager prêt!*

Bonjour ${driverName},

Le passager ${passengerName} est prêt à partir!

📍 *Point de départ:* ${rideData.pickupAddress || "Adresse de départ"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse de destination"}
💰 *Prix:* Fdj${rideData.fare || "0"}

*Vous pouvez maintenant commencer le trajet.*

Caval Team`;
      } else if (notificationType === "ride_cancelled") {
        whatsappMessage = `❌ *Course annulée*

Bonjour ${driverName},

La course ${rideId} a été annulée par le passager.

📍 *Point de départ:* ${rideData.pickupAddress || "Adresse de départ"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse de destination"}

*Vous pouvez maintenant accepter d'autres courses.*

Caval Team`;
      }
      
      if (whatsappMessage) {
        try {
          await sendWhatsAppMessage(driverPhone, whatsappMessage);
          console.log(`✅ WhatsApp message sent successfully to driver ${driverId}`);
          whatsappSent = true;
        } catch (whatsappError) {
          console.error(`❌ Error sending WhatsApp message to driver ${driverId}:`, whatsappError);
        }
      }
    } else {
      console.log(`⚠️ Driver ${driverId} has no phone number for WhatsApp message`);
    }
    
    // Log notification status
    const status = {
      success: notificationSent || whatsappSent,
      pushNotification: notificationSent,
      whatsappMessage: whatsappSent,
      driverId: driverId,
      rideId: rideId,
      notificationType: notificationType
    };
    
    console.log(`📊 Driver notification status:`, status);
    return status;
    
  } catch (error) {
    console.error(`❌ Error in sendDriverNotification for driver ${driverId}:`, error);
    return { success: false, error: error.message };
  }
};

// ---------------------------------------------------------------------------
// sendWhatsAppNotification — the only way the apps can send WhatsApp.
// The apps never see the UltraMsg token. The server picks the recipient and
// the message text from Firestore, so a caller can't message arbitrary
// numbers or send arbitrary text through our UltraMsg account.
//
// data: { type, rideId?, driverId? }
//   Customer app: ride_received | driver_found | driver_arrived  (own ride)
//   Driver app:   ride_assignment | ride_offer (to driverId)  | test (own phone)
//                 status (UltraMsg instance status)
// ---------------------------------------------------------------------------
const CUSTOMER_MESSAGES = {
  ride_received: "Votre commande de course a été reçue ! Nous cherchons un chauffeur pour vous.",
  driver_found: "Un chauffeur a été trouvé pour votre course !",
  driver_arrived: "Votre chauffeur est arrivé à votre point de départ.",
};

const driverRideMessage = (type, driverName, fare) => {
  const price = `💰 *Prix:* Fdj${Number(fare || 0).toFixed(2)}`;
  if (type === "ride_assignment") {
    return `🎯 *Course assignée!*\n\nBonjour ${driverName},\n\n` +
      `Vous avez été sélectionné pour une nouvelle course!\n\n${price}\n\n` +
      "⚡ *URGENT - Ouvrez l'application maintenant!*\n" +
      "Vous n'avez que 15 secondes pour accepter cette course!\n\n" +
      "*Actions requises:*\n1. Ouvrez IMMÉDIATEMENT l'application Caval Driver\n" +
      "2. Allez dans l'onglet \"Courses en cours\"\n" +
      "3. Suivez les instructions pour récupérer le client\n\n" +
      "*Merci de votre service!*\nCaval Team";
  }
  return `🚗 *Nouvelle course disponible!*\n\nBonjour ${driverName},\n\n` +
    `Une nouvelle demande de course correspond à votre profil:\n\n${price}\n\n` +
    "⚡ *URGENT - Ouvrez l'application maintenant!*\n" +
    "Vous n'avez que 15 secondes pour accepter cette course!\n\n" +
    "*Pour accepter cette course:*\n1. Ouvrez IMMÉDIATEMENT l'application Caval Driver\n" +
    "2. Allez dans l'onglet \"Courses\"\n3. Cliquez sur \"Accepter\"\n\n" +
    "*Cette offre expire dans 15 secondes!*\n\nMerci de votre service!\nCaval Team";
};


exports.sendWhatsAppNotification = onCall({
  secrets: [ULTRAMSG_TOKEN],
  maxInstances: 5,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");

  const {type, rideId, driverId} = request.data || {};
  const db = getFirestore();

  const callerIsDriver = async () => (await db.collection("Drivers").doc(uid).get()).exists;
  const getRide = async () => {
    if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");
    const snap = await db.collection("rideRequests").doc(rideId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Ride not found.");
    return snap.data();
  };

  let to; let body; let targetUid;

  if (CUSTOMER_MESSAGES[type]) {
    const ride = await getRide();
    if (ride.userId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
    if (type !== "ride_received" && !ride.driverId) {
      throw new HttpsError("failed-precondition", "No driver assigned yet.");
    }
    const customer = await db.collection("Customers").doc(uid).get();
    to = phoneOf(customer.data());
    body = CUSTOMER_MESSAGES[type];
    targetUid = uid;
  } else if (type === "ride_assignment" || type === "ride_offer") {
    if (!(await callerIsDriver())) throw new HttpsError("permission-denied", "Drivers only.");
    if (typeof driverId !== "string" || !driverId) throw new HttpsError("invalid-argument", "driverId required.");
    const ride = await getRide();
    if (type === "ride_assignment" && ride.driverId !== driverId) {
      throw new HttpsError("failed-precondition", "Ride is not assigned to that driver.");
    }
    const driver = await db.collection("Drivers").doc(driverId).get();
    if (!driver.exists) throw new HttpsError("not-found", "Driver not found.");
    const d = driver.data();
    to = phoneOf(d);
    body = driverRideMessage(type, d.firstName || d.name || "Chauffeur", ride.fare);
    targetUid = driverId;
  } else if (type === "test") {
    if (!(await callerIsDriver())) throw new HttpsError("permission-denied", "Drivers only.");
    const me = await db.collection("Drivers").doc(uid).get();
    to = phoneOf(me.data());
    body = "🧪 *Test WhatsApp Integration*\n\nCeci est un test de l'intégration WhatsApp pour Caval Driver.\n\n" +
      "*Test réussi si vous recevez ce message!*\n\nCaval Team";
  } else if (type === "status") {
    if (!(await callerIsDriver())) throw new HttpsError("permission-denied", "Drivers only.");
    const res = await fetch(`${ULTRAMSG_BASE}/instance/me?token=${encodeURIComponent(ULTRAMSG_TOKEN.value())}`);
    const result = await res.json().catch(() => ({}));
    return {active: res.ok && !result.error, instanceId: ULTRAMSG_INSTANCE, data: result};
  } else {
    throw new HttpsError("invalid-argument", `Unknown type: ${type}`);
  }

  if (!to) throw new HttpsError("failed-precondition", "Recipient has no phone number.");

  // One message per ride/type/recipient, so retries and duplicate listeners
  // don't spam people. create() fails if the log entry already exists.
  if (targetUid) {
    try {
      await db.collection("whatsappLog").doc(`${rideId}_${type}_${targetUid}`)
          .create({type, rideId, targetUid, sentBy: uid, sentAt: new Date()});
    } catch (e) {
      if (e.code === 6) return {skipped: true, reason: "already_sent"}; // ALREADY_EXISTS
      throw e;
    }
  }

  const result = await sendWhatsAppMessage(to, body);
  return {sent: true, result};
});

// ---------------------------------------------------------------------------
// declineRide — the selected driver turns down a ride offer. The server picks
// the next driver (drivers can no longer assign rides from the app).
// data: { rideId }
// ---------------------------------------------------------------------------
exports.declineRide = onCall({maxInstances: 5, memory: "256MiB", timeoutSeconds: 30}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");

  const db = getFirestore();
  const rideRef = db.collection("rideRequests").doc(rideId);

  const rideData = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rideRef);
    if (!snap.exists) throw new HttpsError("not-found", "Ride not found.");
    const ride = snap.data();
    if (ride.selectedDriverId !== uid || ride.status !== "driver_selected") {
      throw new HttpsError("failed-precondition", "This ride is not currently offered to you.");
    }
    const declinedDrivers = [...new Set([...(ride.declinedDrivers || []), uid])];
    tx.update(rideRef, {
      declinedDrivers,
      status: "waiting",
      selectedDriverId: null,
      driverId: null,
      lastDeclinedBy: uid,
      lastDeclinedAt: new Date(),
    });
    return {...ride, declinedDrivers};
  });

  try {
    await db.collection("SelectedDriver").doc(rideId).set({
      status: "declined", declinedBy: uid, declinedAt: new Date(),
    }, {merge: true});
  } catch (e) {
    console.error(`SelectedDriver update failed for ${rideId}:`, e);
  }

  const nextDriver = await findBestAvailableDriver(rideData, uid, db);
  if (nextDriver) {
    await reassignRideToNextDriver(rideId, nextDriver, rideData, db);
    return {reassigned: true};
  }
  await markRideAsNoDriversAvailable(rideId, rideData, db);
  return {reassigned: false};
});

// ===========================================================================
// Customer app callables
// ===========================================================================

// Fields copied when a ride is re-requested. Everything else (driver,
// status, fare) is recomputed by selectBestDriverForNewRideRequest.
const RIDE_COPY_FIELDS = [
  "userId", "rideType", "pickupLat", "pickupLng", "destinationLat", "destinationLng",
  "pickupAddress", "destinationAddress", "distance", "duration", "paymentMethod",
  "serviceType", "package", "stops", "pickupNote", "passenger", "promoCode",
  "preferFemaleDriver", "favoriteDriverIds", "hours", "businessId",
];
const RETRYABLE = new Set(["no_drivers_available", "cancelled_by_driver"]);

// retryRide — the customer asks to search again after "no drivers" or the
// driver cancelled. Creates a fresh ride request (which triggers pricing and
// assignment) and links the old one to it.  data: { rideId } → { rideId }
exports.retryRide = onCall({maxInstances: 5, memory: "256MiB", timeoutSeconds: 30}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");

  const db = getFirestore();
  const oldRef = db.collection("rideRequests").doc(rideId);
  const snap = await oldRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Ride not found.");
  const old = snap.data();
  if (old.userId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
  const retryable = RETRYABLE.has(old.status) || (old.status === "cancelled" && old.cancelledBy !== "customer");
  if (!retryable) throw new HttpsError("failed-precondition", `Ride can't be retried from status ${old.status}.`);
  if (old.replacedBy) return {rideId: old.replacedBy};

  const fresh = {};
  for (const f of RIDE_COPY_FIELDS) if (old[f] !== undefined) fresh[f] = old[f];
  Object.assign(fresh, {
    status: "waiting", driverId: null, selectedDriverId: null,
    retryOf: rideId, createdAt: FieldValue.serverTimestamp(),
  });
  const newRef = db.collection("rideRequests").doc();

  // Customer contact card that the assigned driver reads
  const contact = await db.collection("rideRequestsDriver").where("rideRequestId", "==", rideId).limit(1).get();

  const batch = db.batch();
  batch.set(newRef, fresh);
  if (!contact.empty) {
    batch.set(db.collection("rideRequestsDriver").doc(), {
      ...contact.docs[0].data(), rideRequestId: newRef.id, createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(oldRef, {replacedBy: newRef.id});
  await batch.commit();
  return {rideId: newRef.id};
});

// rateDriver — one rating per completed ride, averaged on the server.
// data: { rideId, rating: 1..5, comments?: string[] }
exports.rateDriver = onCall({maxInstances: 5, memory: "256MiB", timeoutSeconds: 30}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId, rating, comments} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpsError("invalid-argument", "rating must be an integer from 1 to 5.");
  }
  const cleanComments = Array.isArray(comments) ?
    comments.filter((c) => typeof c === "string").slice(0, 10).map((c) => c.slice(0, 200)) : [];

  const db = getFirestore();
  const rideRef = db.collection("rideRequests").doc(rideId);
  const ratingRef = db.collection("driverRatings").doc(`${rideId}_${uid}`);

  return db.runTransaction(async (tx) => {
    const [rideSnap, existing] = await Promise.all([tx.get(rideRef), tx.get(ratingRef)]);
    if (!rideSnap.exists) throw new HttpsError("not-found", "Ride not found.");
    const ride = rideSnap.data();
    if (ride.userId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
    if (ride.status !== "completed") throw new HttpsError("failed-precondition", "Only completed rides can be rated.");
    if (!ride.driverId) throw new HttpsError("failed-precondition", "Ride has no driver.");
    if (existing.exists) return {alreadyRated: true};

    const driverRef = db.collection("Drivers").doc(ride.driverId);
    const driverSnap = await tx.get(driverRef);
    if (!driverSnap.exists) throw new HttpsError("not-found", "Driver not found.");
    const ratings = [...(driverSnap.data().ratings || []), rating];
    const averageRating = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 100) / 100;

    tx.set(ratingRef, {
      rideId, driverId: ride.driverId, customerId: uid, rating,
      comments: cleanComments, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(driverRef, {ratings, averageRating, totalRatings: ratings.length});
    return {averageRating};
  });
});

// deleteMyAccount — customer account deletion (App Store guideline 5.1.1(v)).
// Deletes the profile, photos, conversations and ratings; anonymizes past
// rides (drivers' earnings history keeps the fare); deletes the login.
exports.deleteMyAccount = onCall({maxInstances: 5, memory: "512MiB", timeoutSeconds: 120}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();

  // Drivers delete their account in the driver app; this is for customers.
  if ((await db.collection("Drivers").doc(uid).get()).exists) {
    throw new HttpsError("failed-precondition", "Driver accounts are deleted from the driver app.");
  }

  const writer = db.bulkWriter();

  // Rides: keep the record for the driver, remove personal data
  const rides = await db.collection("rideRequests").where("userId", "==", uid).get();
  for (const r of rides.docs) {
    writer.update(r.ref, {
      userId: "deleted-user", customerName: FieldValue.delete(), customerPhone: FieldValue.delete(),
      customerPhoto: FieldValue.delete(), customerDeletedAt: new Date(),
    });
    const contacts = await db.collection("rideRequestsDriver").where("rideRequestId", "==", r.id).get();
    contacts.docs.forEach((c) => writer.delete(c.ref));
  }

  // Conversations and their messages
  const convs = await db.collection("conversations").where("customerId", "==", uid).get();
  for (const c of convs.docs) {
    const msgs = await c.ref.collection("messages").get();
    msgs.docs.forEach((m) => writer.delete(m.ref));
    writer.delete(c.ref);
  }

  // Ratings they left (the driver's average is kept)
  const ratings = await db.collection("driverRatings").where("customerId", "==", uid).get();
  ratings.docs.forEach((d) => writer.delete(d.ref));

  // Saved payment methods and profile
  const pms = await db.collection("paymentMethods").where("userId", "==", uid).get();
  pms.docs.forEach((d) => writer.delete(d.ref));
  writer.delete(db.collection("Customers").doc(uid));
  writer.delete(db.collection("Users").doc(uid));
  await writer.close();

  // Profile photos: profile_photos/{uid}_*
  try {
    await getStorage().bucket().deleteFiles({prefix: `profile_photos/${uid}_`});
  } catch (e) {
    console.error(`Photo cleanup failed for ${uid}:`, e);
  }

  await getAuth().deleteUser(uid);
  return {deleted: true};
});


// ===========================================================================
// Packages — delivery code and proof of delivery
// ===========================================================================
// When a delivery is created, the server picks a 4-digit code, keeps it where
// only the sender can read it (rideRequests/{id}/private/delivery), and sends
// it to the recipient on WhatsApp. The driver can't read it: they get it from
// the recipient at the door and submit it with confirmDelivery, which is the
// only way a delivery can be marked completed (see firestore.rules).

const djiboutiPhone = (v) => {
  const digits = String(v || "").replace(/\D/g, "");
  if (digits.length === 8) return `+253${digits}`;
  if (digits.startsWith("253") && digits.length === 11) return `+${digits}`;
  return null;
};

const MAX_CODE_ATTEMPTS = 5;

exports.onDeliveryCreated = onDocumentCreated({
  document: "rideRequests/{rideId}",
  secrets: [ULTRAMSG_TOKEN],
  maxInstances: 5,
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (event) => {
  const ride = event.data && event.data.data();
  if (!isDelivery(ride)) return;
  const db = getFirestore();
  const rideId = event.params.rideId;
  const privateRef = db.collection("rideRequests").doc(rideId).collection("private").doc("delivery");

  // A retried or dispatched (scheduled) delivery keeps the code the recipient already has.
  const sourceId = ride.retryOf || ride.scheduledRideId;
  if (sourceId) {
    const prev = await db.collection("rideRequests").doc(sourceId).collection("private").doc("delivery").get();
    if (prev.exists && prev.data().code) {
      await privateRef.set({code: prev.data().code, createdAt: FieldValue.serverTimestamp(), copiedFrom: sourceId});
      return;
    }
  }

  const code = String(require("node:crypto").randomInt(0, 10000)).padStart(4, "0");
  await privateRef.set({code, createdAt: FieldValue.serverTimestamp()});

  const to = djiboutiPhone(ride.package && ride.package.recipientPhone);
  if (!to) {
    console.log(`Delivery ${rideId}: recipient phone invalid, code not sent by WhatsApp`);
    return;
  }
  let sender = "Un client Caval";
  try {
    const c = await db.collection("Customers").doc(ride.userId).get();
    if (c.exists && c.data().firstName) sender = c.data().firstName;
  } catch (e) { /* keep default */ }
  const name = (ride.package.recipientName || "").trim();
  const body = `📦 *Caval — un colis pour vous*\n\n` +
    `Bonjour${name ? ` ${name}` : ""}, ${sender} vous envoie un colis avec Caval.\n\n` +
    `🔑 *Code de livraison : ${code}*\n\n` +
    "Donnez ce code au livreur seulement quand vous avez reçu le colis.";
  let trackLine = "";
  try {
    trackLine = `\n\n📍 Suivre la livraison : ${await makeShareLink(db, rideId, ride.userId, "recipient")}`;
  } catch (e) { /* link is optional */ }
  try {
    await sendWhatsAppMessage(to, body + trackLine);
    await privateRef.update({sentToRecipientAt: FieldValue.serverTimestamp()});
  } catch (e) {
    console.error(`Delivery ${rideId}: WhatsApp to recipient failed`, e);
  }
});

// confirmDelivery — the assigned driver submits the code the recipient gave
// them. data: { rideId, code } → { delivered: true } | error
exports.confirmDelivery = onCall({maxInstances: 5, memory: "256MiB", timeoutSeconds: 30}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId, code} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");
  if (typeof code !== "string" || !/^\d{4}$/.test(code)) throw new HttpsError("invalid-argument", "4-digit code required.");

  const db = getFirestore();
  const rideRef = db.collection("rideRequests").doc(rideId);
  const privateRef = rideRef.collection("private").doc("delivery");

  return db.runTransaction(async (tx) => {
    const [rideSnap, privSnap] = await Promise.all([tx.get(rideRef), tx.get(privateRef)]);
    if (!rideSnap.exists) throw new HttpsError("not-found", "Ride not found.");
    const ride = rideSnap.data();
    if (!isDelivery(ride)) throw new HttpsError("failed-precondition", "Not a delivery.");
    if (ride.driverId !== uid) throw new HttpsError("permission-denied", "Not your delivery.");
    if (ride.status === "completed") return {delivered: true, alreadyDone: true};
    if (!["picked_up", "ride_started", "in_progress", "active"].includes(ride.status) && !ride.customerPickedUp) {
      throw new HttpsError("failed-precondition", "Pick up the parcel first.");
    }
    const attempts = ride.deliveryCodeAttempts || 0;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      throw new HttpsError("resource-exhausted", "Too many wrong codes. Contact Caval support.");
    }
    if (!privSnap.exists || privSnap.data().code !== code) {
      tx.update(rideRef, {deliveryCodeAttempts: attempts + 1});
      return {delivered: false, attemptsLeft: MAX_CODE_ATTEMPTS - attempts - 1};
    }
    tx.update(rideRef, {
      status: "completed",
      deliveryVerified: true,
      deliveredAt: FieldValue.serverTimestamp(),
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {delivered: true};
  });
});

// ===========================================================================
// Wave 2 — preferences, discounts, rewards, PIN, scheduled rides, push,
// receipts. See docs/CUSTOMER_FEATURES.md.
// ===========================================================================

// Matching preferences: favourite drivers and "conductrice si possible".
// A bonus on top of calculateDriverScore (which tops out around 100).
function preferenceBonus(ride, driver, distanceKm) {
  let bonus = 0;
  const favs = Array.isArray(ride.favoriteDriverIds) ? ride.favoriteDriverIds : [];
  if (favs.includes(driver.id) && distanceKm <= 3) bonus += 40;
  if (ride.preferFemaleDriver === true && driver.gender === "female") bonus += 50;
  return bonus;
}

const rewardsRef = (db, uid) => db.collection("customerRewards").doc(uid);
const normCode = (c) => String(c || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

// Promo: promoCodes/{CODE} = { active, type: "percent" | "amount", value,
//   maxUses?, usedCount, perUser? (default 1), expiresAt?, firstRideOnly?,
//   maxDiscount? (percent only), label? }  — created in the Console.
function promoDiscount(promo, fare) {
  if (!promo || promo.active === false) return 0;
  if (promo.expiresAt && promo.expiresAt.toDate && promo.expiresAt.toDate() < new Date()) return 0;
  if (promo.maxUses && (promo.usedCount || 0) >= promo.maxUses) return 0;
  let d = promo.type === "percent" ? fare * (Number(promo.value) || 0) / 100 : Number(promo.value) || 0;
  if (promo.type === "percent" && promo.maxDiscount) d = Math.min(d, promo.maxDiscount);
  return Math.max(0, Math.min(fare, Math.round(d / 50) * 50));
}

// Applies a promo code, then the customer's Caval credit. Consumes them in a
// transaction and returns the fields to write on the ride.
async function applyDiscounts(db, rideId, ride, fare) {
  if (ride.businessId) return {update: {fare}}; // business rides are invoiced at full price
  const code = normCode(ride.promoCode);
  try {
    return await db.runTransaction(async (tx) => {
      const rRef = rewardsRef(db, ride.userId);
      const rSnap = await tx.get(rRef);
      const rewards = rSnap.exists ? rSnap.data() : {};
      let promo = null; let promoRef = null; let redemptionRef = null; let promoAmount = 0;
      if (code) {
        promoRef = db.collection("promoCodes").doc(code);
        redemptionRef = db.collection("promoRedemptions").doc(`${code}_${ride.userId}`);
        const [pSnap, redSnap] = await Promise.all([tx.get(promoRef), tx.get(redemptionRef)]);
        promo = pSnap.exists ? pSnap.data() : null;
        const usedByMe = redSnap.exists ? (redSnap.data().count || 1) : 0;
        const firstRideOk = !promo || !promo.firstRideOnly || !(rewards.completedRides > 0);
        if (promo && usedByMe < (promo.perUser || 1) && firstRideOk) promoAmount = promoDiscount(promo, fare);
      }
      const afterPromo = fare - promoAmount;
      const creditUsed = Math.max(0, Math.min(afterPromo, Math.floor((rewards.credit || 0) / 50) * 50));
      const final = afterPromo - creditUsed;
      const update = {fare: final};
      if (promoAmount || creditUsed) {
        Object.assign(update, {fareBeforeDiscount: fare, discount: promoAmount + creditUsed});
      }
      if (promoAmount) {
        update.promo = {code, amount: promoAmount};
        tx.update(promoRef, {usedCount: FieldValue.increment(1)});
        tx.set(redemptionRef, {code, uid: ride.userId, count: FieldValue.increment(1), lastRideId: rideId,
          at: FieldValue.serverTimestamp()}, {merge: true});
      } else if (code) {
        update.promo = {code, amount: 0, rejected: true};
      }
      if (creditUsed) {
        update.creditUsed = creditUsed;
        tx.set(rRef, {credit: FieldValue.increment(-creditUsed)}, {merge: true});
      }
      return {update};
    });
  } catch (e) {
    console.error(`Discounts for ${rideId} failed, charging full fare`, e);
    return {update: {fare}};
  }
}

// Customer push notifications (Expo). Token on Customers/{uid}.expoPushToken.
async function pushToCustomer(db, uid, title, body, data = {}) {
  try {
    const c = await db.collection("Customers").doc(uid).get();
    const token = c.exists && c.data().expoPushToken;
    if (!token || !String(token).startsWith("ExponentPushToken")) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({to: token, title, body, data, sound: "default", priority: "high", channelId: "rides"}),
    });
  } catch (e) {
    console.error("Customer push failed", e);
  }
}

const customerStatusMessage = (ride) => {
  const del = ride.serviceType === "delivery";
  const driver = ride.driverName || (del ? "Votre livreur" : "Votre chauffeur");
  switch (ride.status) {
    case "assigned": return [del ? "Livreur trouvé" : "Chauffeur trouvé", `${driver} est en route.`];
    case "driver_arrived": case "arrived_at_pickup":
      return [del ? "Livreur arrivé" : "Votre chauffeur est arrivé", del ? "Remettez-lui le colis." : `${driver} vous attend.`];
    case "picked_up": return del ? ["Colis récupéré", "Votre colis est en route."] : null;
    case "completed": return del ? ["Colis livré", "Le destinataire a reçu votre colis."] :
      ["Course terminée", `Montant : ${ride.fare || 0} Fdj. Merci d'avoir choisi Caval !`];
    case "no_drivers_available": return ["Aucun chauffeur disponible", "Ouvrez l'app pour relancer la recherche."];
    case "cancelled_by_driver": return [del ? "Le livreur a annulé" : "Le chauffeur a annulé", "Ouvrez l'app pour chercher quelqu'un d'autre."];
    default: return null;
  }
};

const CANCELLED = ["declined", "cancelled", "cancelled_by_driver", "no_drivers_available"];

exports.customerRideUpdates = onDocumentUpdated({
  document: "rideRequests/{rideId}", maxInstances: 10, memory: "256MiB", timeoutSeconds: 30,
}, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (before.status === after.status) return;
  const db = getFirestore();
  const rideRef = event.data.after.ref;
  const rideId = event.params.rideId;

  const msg = customerStatusMessage(after);
  if (msg && after.userId) await pushToCustomer(db, after.userId, msg[0], msg[1], {rideId, status: after.status});

  // Give back promo/credit if the ride never happened
  if (CANCELLED.includes(after.status) && (after.creditUsed || (after.promo && after.promo.amount)) && !after.discountRefundedAt) {
    const batch = db.batch();
    if (after.creditUsed) batch.set(rewardsRef(db, after.userId), {credit: FieldValue.increment(after.creditUsed)}, {merge: true});
    if (after.promo && after.promo.amount) {
      batch.update(db.collection("promoCodes").doc(after.promo.code), {usedCount: FieldValue.increment(-1)});
      batch.set(db.collection("promoRedemptions").doc(`${after.promo.code}_${after.userId}`),
          {count: FieldValue.increment(-1)}, {merge: true});
    }
    batch.update(rideRef, {discountRefundedAt: FieldValue.serverTimestamp()});
    await batch.commit().catch((e) => console.error(`Refund for ${rideId} failed`, e));
  }

  // Loyalty points and referral reward on completion
  if (after.status === "completed" && !after.pointsAwardedAt && after.userId) {
    const pricing = await getPricing(db);
    const {ridesPerReward, rewardCredit, referralCredit} = pricing.rewards;
    await db.runTransaction(async (tx) => {
      const ride = await tx.get(rideRef);
      if (ride.data().pointsAwardedAt) return;
      const rRef = rewardsRef(db, after.userId);
      const r = (await tx.get(rRef)).data() || {};
      const completed = (r.completedRides || 0) + 1;
      const upd = {completedRides: completed, points: FieldValue.increment(1)};
      let credit = 0;
      if (ridesPerReward && completed % ridesPerReward === 0) credit += rewardCredit;
      if (completed === 1 && r.referredBy && !r.referralRewardedAt) {
        credit += referralCredit;
        upd.referralRewardedAt = FieldValue.serverTimestamp();
        tx.set(rewardsRef(db, r.referredBy), {credit: FieldValue.increment(referralCredit),
          referralsRewarded: FieldValue.increment(1)}, {merge: true});
      }
      if (credit) upd.credit = FieldValue.increment(credit);
      tx.set(rRef, upd, {merge: true});
      tx.update(rideRef, {pointsAwardedAt: FieldValue.serverTimestamp()});
    }).catch((e) => console.error(`Rewards for ${rideId} failed`, e));
  }
});

// Pickup PIN: shown to the customer, entered by the driver at pickup
// (verifyPickupPin), so riders get into the right car.
exports.createPickupPin = onDocumentCreated({
  document: "rideRequests/{rideId}", maxInstances: 10, memory: "128MiB", timeoutSeconds: 20,
}, async (event) => {
  const ride = event.data && event.data.data();
  if (!ride || ride.status === "scheduled") return; // the dispatched copy gets its own
  const pin = String(require("node:crypto").randomInt(0, 10000)).padStart(4, "0");
  await event.data.ref.collection("private").doc("pickup").set({pin, createdAt: FieldValue.serverTimestamp()});
});

exports.verifyPickupPin = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId, pin} = request.data || {};
  if (typeof rideId !== "string" || typeof pin !== "string") throw new HttpsError("invalid-argument", "rideId and pin required.");
  const db = getFirestore();
  const rideRef = db.collection("rideRequests").doc(rideId);
  return db.runTransaction(async (tx) => {
    const [ride, priv] = await Promise.all([tx.get(rideRef), tx.get(rideRef.collection("private").doc("pickup"))]);
    if (!ride.exists) throw new HttpsError("not-found", "Ride not found.");
    if (ride.data().driverId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
    const attempts = ride.data().pickupPinAttempts || 0;
    if (attempts >= 5) throw new HttpsError("resource-exhausted", "Too many wrong PINs.");
    if (!priv.exists || priv.data().pin !== pin) {
      tx.update(rideRef, {pickupPinAttempts: attempts + 1});
      return {ok: false, attemptsLeft: 4 - attempts};
    }
    tx.update(rideRef, {pickupPinVerified: true});
    return {ok: true};
  });
});

// Scheduled rides: status "scheduled" + scheduledFor. Fifteen minutes before,
// a normal ride is created from it (which triggers pricing and matching).
const SCHEDULE_LEAD_MIN = 15;
exports.dispatchScheduledRides = onSchedule({schedule: "every 5 minutes", maxInstances: 1, memory: "256MiB"}, async () => {
  const db = getFirestore();
  const due = await db.collection("rideRequests")
      .where("status", "==", "scheduled")
      .where("scheduledFor", "<=", new Date(Date.now() + SCHEDULE_LEAD_MIN * 60 * 1000))
      .limit(50).get();
  for (const doc of due.docs) {
    const old = doc.data();
    const fresh = {};
    for (const f of RIDE_COPY_FIELDS) if (old[f] !== undefined) fresh[f] = old[f];
    Object.assign(fresh, {status: "waiting", driverId: null, selectedDriverId: null,
      scheduledFor: old.scheduledFor, scheduledRideId: doc.id, createdAt: FieldValue.serverTimestamp()});
    const newRef = db.collection("rideRequests").doc();
    const contact = await db.collection("rideRequestsDriver").where("rideRequestId", "==", doc.id).limit(1).get();
    const batch = db.batch();
    batch.set(newRef, fresh);
    if (!contact.empty) {
      batch.set(db.collection("rideRequestsDriver").doc(), {...contact.docs[0].data(), rideRequestId: newRef.id,
        createdAt: FieldValue.serverTimestamp()});
    }
    batch.update(doc.ref, {status: "dispatched", dispatchedRideId: newRef.id, dispatchedAt: FieldValue.serverTimestamp()});
    await batch.commit();
    await pushToCustomer(db, old.userId, "Votre course programmée", "Nous cherchons votre chauffeur.", {rideId: newRef.id});
  }
});

// Rewards: points, credit, referral code (created on first call).
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
exports.getMyRewards = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const db = getFirestore();
  const ref = rewardsRef(db, uid);
  let r = (await ref.get()).data() || {};
  if (!r.referralCode) {
    const crypto = require("node:crypto");
    for (let i = 0; i < 5 && !r.referralCode; i++) {
      const code = "CAV" + Array.from({length: 5}, () => REF_ALPHABET[crypto.randomInt(0, REF_ALPHABET.length)]).join("");
      try {
        await db.collection("referralCodes").doc(code).create({uid, createdAt: FieldValue.serverTimestamp()});
        await ref.set({referralCode: code}, {merge: true});
        r = {...r, referralCode: code};
      } catch (e) {
        if (e.code !== 6) throw e; // 6 = ALREADY_EXISTS: try another code
      }
    }
  }
  const {rewards} = await getPricing(db);
  const done = r.completedRides || 0;
  return {
    points: r.points || 0, credit: r.credit || 0, completedRides: done, referralCode: r.referralCode || null,
    referredBy: !!r.referredBy, ridesPerReward: rewards.ridesPerReward, rewardCredit: rewards.rewardCredit,
    referralCredit: rewards.referralCredit,
    ridesToNextReward: rewards.ridesPerReward ? rewards.ridesPerReward - (done % rewards.ridesPerReward) : null,
  };
});

exports.redeemReferral = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const code = normCode(request.data && request.data.code);
  if (!code) throw new HttpsError("invalid-argument", "Code required.");
  const db = getFirestore();
  const owner = await db.collection("referralCodes").doc(code).get();
  if (!owner.exists) throw new HttpsError("not-found", "Code inconnu.");
  if (owner.data().uid === uid) throw new HttpsError("failed-precondition", "C'est votre propre code.");
  return db.runTransaction(async (tx) => {
    const ref = rewardsRef(db, uid);
    const r = (await tx.get(ref)).data() || {};
    if (r.referredBy) throw new HttpsError("already-exists", "Vous avez déjà utilisé un code.");
    if ((r.completedRides || 0) > 0) throw new HttpsError("failed-precondition", "Réservé aux nouveaux clients.");
    tx.set(ref, {referredBy: owner.data().uid, referredWith: code, referredAt: FieldValue.serverTimestamp()}, {merge: true});
    return {ok: true};
  });
});

// Promo preview for the customer app (the real check happens at pricing).
exports.checkPromo = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const code = normCode(request.data && request.data.code);
  const fare = Number(request.data && request.data.fare) || 0;
  if (!code) return {valid: false, reason: "empty"};
  const db = getFirestore();
  const [p, red, rw] = await Promise.all([
    db.collection("promoCodes").doc(code).get(),
    db.collection("promoRedemptions").doc(`${code}_${uid}`).get(),
    rewardsRef(db, uid).get(),
  ]);
  if (!p.exists) return {valid: false, reason: "unknown"};
  const promo = p.data();
  if ((red.exists ? red.data().count || 0 : 0) >= (promo.perUser || 1)) return {valid: false, reason: "used"};
  if (promo.firstRideOnly && ((rw.data() || {}).completedRides || 0) > 0) return {valid: false, reason: "first_ride_only"};
  const amount = promoDiscount(promo, fare);
  if (!amount && fare) return {valid: false, reason: "expired"};
  return {valid: true, code, amount, label: promo.label || null, type: promo.type, value: promo.value};
});

// Receipt on WhatsApp for a completed ride.
exports.sendReceipt = onCall({secrets: [ULTRAMSG_TOKEN], maxInstances: 5, memory: "128MiB", timeoutSeconds: 30}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");
  const db = getFirestore();
  const ride = (await db.collection("rideRequests").doc(rideId).get()).data();
  if (!ride || ride.userId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
  if (ride.status !== "completed") throw new HttpsError("failed-precondition", "Ride not completed.");
  const to = phoneOf((await db.collection("Customers").doc(uid).get()).data());
  if (!to) throw new HttpsError("failed-precondition", "Ajoutez votre numéro dans votre profil.");
  const when = ride.completedAt && ride.completedAt.toDate ? ride.completedAt.toDate() : new Date();
  const date = when.toLocaleString("fr-FR", {timeZone: "Africa/Djibouti", dateStyle: "medium", timeStyle: "short"});
  const lines = [
    "🧾 *Reçu Caval*", "",
    `Date : ${date}`,
    `Service : ${ride.serviceType === "delivery" ? "Colis" : ride.serviceType === "hourly" ? "Mise à disposition" : ride.rideType}`,
    `De : ${ride.pickupAddress || "—"}`,
    ride.serviceType === "hourly" ? `Durée : ${ride.hours} h` : `À : ${ride.destinationAddress || "—"}`,
    ride.billedDistanceKm ? `Distance : ${String(ride.billedDistanceKm).replace(".", ",")} km` : null,
    ride.driverName ? `Chauffeur : ${ride.driverName}` : null,
    ride.discount ? `Réduction : -${ride.discount} Fdj` : null,
    `*Total : ${ride.fare} Fdj* (espèces)`, "",
    `Réf. ${rideId.slice(0, 8).toUpperCase()}`,
  ].filter((l) => l !== null);
  try {
    await db.collection("whatsappLog").doc(`${rideId}_receipt_${uid}`).create({type: "receipt", rideId, sentAt: new Date()});
  } catch (e) {
    if (e.code === 6) return {sent: false, reason: "already_sent"};
    throw e;
  }
  await sendWhatsAppMessage(to, lines.join("\n"));
  return {sent: true};
});

// ===========================================================================
// Wave 3 — share/tracking links, WhatsApp bot, business accounts, support,
// admin. See docs/WAVE3.md.
// ===========================================================================
const crypto = require("node:crypto");
const TRACK_BASE_URL = "https://eco-share-92ef1.web.app/t/";
const SHARE_TTL_HOURS = 24;
const isAdminCaller = (request) => !!(request.auth && request.auth.token && request.auth.token.admin === true);
const randomToken = (n = 22) => crypto.randomBytes(32).toString("base64url").replace(/[-_]/g, "").slice(0, n);

async function makeShareLink(db, rideId, uid, purpose) {
  const token = randomToken();
  await db.collection("shareLinks").doc(token).set({
    rideId, uid, purpose, createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + SHARE_TTL_HOURS * 3600 * 1000),
  });
  return `${TRACK_BASE_URL}${token}`;
}

// createShareLink — the customer shares a live link to their ride.
exports.createShareLink = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {rideId} = request.data || {};
  if (typeof rideId !== "string" || !rideId) throw new HttpsError("invalid-argument", "rideId required.");
  const db = getFirestore();
  const ride = (await db.collection("rideRequests").doc(rideId).get()).data();
  if (!ride || ride.userId !== uid) throw new HttpsError("permission-denied", "Not your ride.");
  return {url: await makeShareLink(db, rideId, uid, "share")};
});

// track — public, read-only status for a share link (used by /t/{token}).
// Returns only what someone following the trip needs.
exports.track = onRequest({maxInstances: 10, memory: "128MiB", timeoutSeconds: 20, cors: true}, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const token = String(req.query.t || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  if (!token) return res.status(400).json({error: "missing"});
  const db = getFirestore();
  const link = (await db.collection("shareLinks").doc(token).get()).data();
  if (!link || (link.expiresAt && link.expiresAt.toDate() < new Date())) return res.status(404).json({error: "expired"});
  let rideId = link.rideId;
  let ride = (await db.collection("rideRequests").doc(rideId).get()).data();
  // Follow retries / scheduled dispatch to the live ride
  for (let i = 0; i < 3 && ride && (ride.replacedBy || ride.dispatchedRideId); i++) {
    rideId = ride.replacedBy || ride.dispatchedRideId;
    ride = (await db.collection("rideRequests").doc(rideId).get()).data();
  }
  if (!ride) return res.status(404).json({error: "not_found"});
  const active = ["assigned", "driver_arrived", "arrived_at_pickup", "picked_up", "ride_started", "in_progress", "active"].includes(ride.status);
  let driver = null;
  if (ride.driverId) {
    const d = (await db.collection("Drivers").doc(ride.driverId).get()).data() || {};
    driver = {
      firstName: (ride.driverName || d.firstName || "").split(" ")[0] || null,
      car: [d.carMake, d.carModel].filter(Boolean).join(" ") || null, color: d.carColor || null,
      plate: d.plaqueImmatriculation || null, photo: d.photo || null,
      position: active && d.latitude && d.longitude ? {lat: d.latitude, lng: d.longitude} : null,
    };
  }
  return res.json({
    status: ride.status, serviceType: ride.serviceType || "ride",
    pickup: {lat: ride.pickupLat, lng: ride.pickupLng, address: ride.pickupAddress || null},
    destination: {lat: ride.destinationLat, lng: ride.destinationLng, address: ride.destinationAddress || null},
    stops: (ride.stops || []).map((s) => ({lat: s.latitude, lng: s.longitude})),
    recipientName: link.purpose === "recipient" && ride.package ? ride.package.recipientName : null,
    driver, updatedAt: Date.now(),
  });
});

// ---------------------------------------------------------------------------
// WhatsApp bot (UltraMsg webhook). Set the webhook URL in UltraMsg to
//   https://<region>-eco-share-92ef1.cloudfunctions.net/whatsappWebhook?key=<WHATSAPP_WEBHOOK_KEY>
// ---------------------------------------------------------------------------
const WHATSAPP_WEBHOOK_KEY = defineSecret("WHATSAPP_WEBHOOK_KEY");
const APP_LINK = "https://www.caval.tech";
const BOT_MENU = "Bonjour 👋 Bienvenue chez *Caval*.\n\nRépondez avec un chiffre :\n" +
  "*1* Commander une course\n*2* Suivre ma course\n*3* Nos prix\n*4* Parler à quelqu'un";
const ACTIVE_STATUSES = ["waiting", "driver_selected", "assigned", "driver_arrived", "arrived_at_pickup", "picked_up", "ride_started", "in_progress", "active"];
const STATUS_FR = {
  waiting: "Recherche d'un chauffeur", driver_selected: "Recherche d'un chauffeur", assigned: "Chauffeur en route",
  driver_arrived: "Chauffeur arrivé", arrived_at_pickup: "Chauffeur arrivé", picked_up: "En route vers la destination",
};

exports.whatsappWebhook = onRequest({secrets: [ULTRAMSG_TOKEN, WHATSAPP_WEBHOOK_KEY], maxInstances: 5, memory: "256MiB", timeoutSeconds: 30},
    async (req, res) => {
      if (req.method !== "POST" || req.query.key !== WHATSAPP_WEBHOOK_KEY.value()) return res.status(403).send("forbidden");
      res.status(200).send("ok"); // answer UltraMsg right away
      try {
        const body = req.body || {};
        const m = body.data || {};
        if (body.event_type && body.event_type !== "message_received") return;
        if (m.fromMe || !m.from || String(m.from).endsWith("@g.us")) return; // no groups, no echoes
        const digits = String(m.from).replace(/@.*/, "").replace(/\D/g, "");
        const phone = `+${digits}`;
        const db = getFirestore();
        const stateRef = db.collection("whatsappBot").doc(digits);
        const state = (await stateRef.get()).data() || {};
        const text = String(m.body || "").trim().toLowerCase();
        const lat = Number(m.lat ?? (m.location && m.location.latitude));
        const lng = Number(m.lng ?? (m.location && m.location.longitude));
        const reply = (msg) => sendWhatsAppMessage(phone, msg);

        if (m.type === "location" && Number.isFinite(lat) && Number.isFinite(lng)) {
          await db.collection("whatsappLeads").add({phone, type: "ride", lat, lng, name: m.pushname || null,
            status: "new", createdAt: FieldValue.serverTimestamp()});
          await stateRef.set({step: "idle", lastAt: FieldValue.serverTimestamp()}, {merge: true});
          return reply("Merci ! 📍 Position reçue. Un opérateur Caval vous rappelle dans quelques minutes pour confirmer la course.\n\n" +
            `Plus rapide la prochaine fois : l'application ${APP_LINK}`);
        }
        if (text === "1" || text.includes("command")) {
          await stateRef.set({step: "await_location", lastAt: FieldValue.serverTimestamp()}, {merge: true});
          return reply("Envoyez votre *position* : 📎 → Position → Envoyer ma position actuelle.\n\n" +
            `Ou commandez directement dans l'application : ${APP_LINK}`);
        }
        if (text === "2" || text.includes("suivre")) {
          const cust = await db.collection("Customers").where("number", "==", phone).limit(1).get();
          if (cust.empty) return reply("Nous n'avons pas trouvé de compte Caval avec ce numéro. Répondez *4* pour parler à quelqu'un.");
          const rides = await db.collection("rideRequests").where("userId", "==", cust.docs[0].id)
              .orderBy("createdAt", "desc").limit(1).get();
          const r = rides.empty ? null : rides.docs[0].data();
          if (!r || !ACTIVE_STATUSES.includes(r.status)) return reply("Vous n'avez pas de course en cours.");
          return reply(`🚗 *${STATUS_FR[r.status] || "Course en cours"}*` + (r.driverName ? `\nChauffeur : ${r.driverName}` : "") +
            `\nMontant : ${r.fare || "—"} Fdj (espèces)`);
        }
        if (text === "3" || text.includes("prix") || text.includes("tarif")) {
          const {fares} = await getPricing(db);
          const line = (name, t) => `• ${name} : ${t.base} Fdj jusqu'à ${t.includedKm} km, puis ${t.perKm} Fdj/km`;
          return reply("💰 *Nos prix*\n" + line("Voiture", fares["Caval Privé"]) + "\n" + line("Moto", fares["Caval moto"]) +
            "\n\nLe prix exact s'affiche dans l'application avant de commander.");
        }
        if (text === "4" || text.includes("aide") || text.includes("help")) {
          await db.collection("whatsappLeads").add({phone, type: "support", text: m.body || "", name: m.pushname || null,
            status: "new", createdAt: FieldValue.serverTimestamp()});
          return reply("D'accord, un membre de l'équipe Caval vous répond ici dès que possible. Décrivez votre demande en un message.");
        }
        // Free text after "4" or unknown: log for the team, show the menu at most once an hour
        await db.collection("whatsappLeads").add({phone, type: "message", text: m.body || "", name: m.pushname || null,
          status: "new", createdAt: FieldValue.serverTimestamp()});
        const lastMenu = state.lastMenuAt && state.lastMenuAt.toDate ? state.lastMenuAt.toDate().getTime() : 0;
        if (Date.now() - lastMenu > 3600 * 1000) {
          await stateRef.set({lastMenuAt: FieldValue.serverTimestamp()}, {merge: true});
          return reply(BOT_MENU);
        }
      } catch (e) {
        console.error("whatsappWebhook failed", e);
      }
    });

// ---------------------------------------------------------------------------
// Business accounts: businesses/{id} { name, inviteCode, adminUids, memberUids,
// active } — created in the admin dashboard. Members can charge rides to the
// business (paymentMethod "business"); the business is invoiced monthly.
// ---------------------------------------------------------------------------
exports.joinBusiness = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const code = normCode(request.data && request.data.code);
  if (!code) throw new HttpsError("invalid-argument", "Code required.");
  const db = getFirestore();
  const q = await db.collection("businesses").where("inviteCode", "==", code).where("active", "==", true).limit(1).get();
  if (q.empty) throw new HttpsError("not-found", "Code entreprise inconnu.");
  const biz = {id: q.docs[0].id, name: q.docs[0].data().name};
  await q.docs[0].ref.update({memberUids: FieldValue.arrayUnion(uid)});
  // The app lists the customer's businesses from their own profile
  await db.collection("Customers").doc(uid).set({businesses: FieldValue.arrayUnion(biz)}, {merge: true});
  return {businessId: biz.id, name: biz.name};
});

exports.leaveBusiness = onCall({maxInstances: 5, memory: "128MiB", timeoutSeconds: 20}, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const {businessId} = request.data || {};
  if (typeof businessId !== "string") throw new HttpsError("invalid-argument", "businessId required.");
  const db = getFirestore();
  await db.collection("businesses").doc(businessId).update({memberUids: FieldValue.arrayRemove(uid)});
  const me = (await db.collection("Customers").doc(uid).get()).data() || {};
  await db.collection("Customers").doc(uid).update({businesses: (me.businesses || []).filter((b) => b.id !== businessId)});
  return {ok: true};
});

// Business rides: check membership at creation; no promo/credit on them.
exports.checkBusinessRide = onDocumentCreated({document: "rideRequests/{rideId}", maxInstances: 5, memory: "128MiB"}, async (event) => {
  const ride = event.data && event.data.data();
  if (!ride || !ride.businessId) return;
  const biz = (await getFirestore().collection("businesses").doc(ride.businessId).get()).data();
  const ok = biz && biz.active && (biz.memberUids || []).includes(ride.userId);
  if (!ok) await event.data.ref.update({businessId: null, paymentMethod: "cash", businessRejected: true});
  else await event.data.ref.update({businessName: biz.name, businessVerified: true});
});

// ---------------------------------------------------------------------------
// Support chat: supportTickets/{id} + messages. A reply from the team pushes
// a notification to the customer.
// ---------------------------------------------------------------------------
exports.onSupportMessage = onDocumentCreated({document: "supportTickets/{ticketId}/messages/{msgId}", maxInstances: 5, memory: "128MiB"},
    async (event) => {
      const msg = event.data && event.data.data();
      if (!msg) return;
      const db = getFirestore();
      const ticketRef = db.collection("supportTickets").doc(event.params.ticketId);
      const ticket = (await ticketRef.get()).data();
      if (!ticket) return;
      await ticketRef.update({
        lastMessage: String(msg.text || "").slice(0, 200), lastFrom: msg.from, updatedAt: FieldValue.serverTimestamp(),
        ...(msg.from === "support" ? {unreadByUser: true, status: "answered"} : {unreadBySupport: true, status: "open"}),
      });
      if (msg.from === "support") {
        await pushToCustomer(db, ticket.uid, "Support Caval", String(msg.text || "Nouvelle réponse").slice(0, 120), {ticketId: event.params.ticketId});
      }
    });

// ---------------------------------------------------------------------------
// Admin: custom claim { admin: true } (functions/scripts/set-admin.js).
// ---------------------------------------------------------------------------
exports.adminMonthlyReport = onCall({maxInstances: 2, memory: "256MiB", timeoutSeconds: 60}, async (request) => {
  if (!isAdminCaller(request)) throw new HttpsError("permission-denied", "Admins only.");
  const {businessId, month} = request.data || {}; // month "2026-11"
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new HttpsError("invalid-argument", "month YYYY-MM required.");
  const [y, mo] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1)); const to = new Date(Date.UTC(y, mo, 1));
  let q = getFirestore().collection("rideRequests").where("status", "==", "completed")
      .where("createdAt", ">=", from).where("createdAt", "<", to);
  if (businessId) q = q.where("businessId", "==", businessId);
  const snap = await q.get();
  const rows = snap.docs.map((d) => {
    const r = d.data();
    return {id: d.id, date: r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toISOString() : "", userId: r.userId,
      passenger: r.passenger ? r.passenger.name : "", from: r.pickupAddress || "", to: r.destinationAddress || "",
      km: r.billedDistanceKm || "", fare: r.fare || 0, driver: r.driverName || "", service: r.serviceType || "ride"};
  });
  return {count: rows.length, total: rows.reduce((s, r) => s + (Number(r.fare) || 0), 0), rows};
});
