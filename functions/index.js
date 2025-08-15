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
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

// Initialize Firebase Admin
initializeApp();

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
      "https://api.ultramsg.com/instance131940/messages/chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: formattedPhone,
          body: message,
          token: "8eoza1gyk2md4sic",
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

// Cloud Function to send push notification when a new ride request is created
exports.sendNewRideNotification = onDocumentUpdated({
  document: "rideRequests/{rideId}",
  maxInstances: 10,
}, async (event) => {
    const db = getFirestore();

    try {
      const beforeData = event.data && event.data.before ?
        event.data.before.data() : null;
      const afterData = event.data && event.data.after ?
        event.data.after.data() : null;

      // Check if a new ride request was created (status changed to "waiting")
      if ((!beforeData || beforeData.status !== "waiting") &&
        afterData && afterData.status === "waiting") {
        console.log("New ride request created, selecting best driver");

        // Send WhatsApp notification to admin/dispatcher
        try {
          const adminPhone = "+25377702036";
          const rideId = event.params.rideId;
          const customerName = afterData.customerName || "Unknown";
          const customerPhone = afterData.customerPhone || "Unknown";
          const origin = afterData.origin && afterData.origin.address ? afterData.origin.address : "Unknown";
          const destination = afterData.destination && afterData.destination.address ? afterData.destination.address : "Unknown";
          const adminMessage = `🆕 Nouvelle demande de course !\n\nID: ${rideId}\nClient: ${customerName}\nTéléphone: ${customerPhone}\nDépart: ${origin}\nDestination: ${destination}`;
          await sendWhatsAppMessage(adminPhone, adminMessage);
        } catch (err) {
          console.error("Error sending admin WhatsApp notification:", err);
        }

        const rideType = afterData.rideType;
        if (!rideType) {
          console.log("No ride type specified");
          return;
        }

        // Get all online drivers of the same type
        const driversSnapshot = await db.collection("Drivers")
          .where("isOnline", "==", true)
          .where("isAvailable", "!=", false)
          .where("driverType", "==", rideType)
          .where("rideInProgress", "==", false)
          .get();

        const eligibleDrivers = [];
        driversSnapshot.forEach((doc) => {
          const driverData = doc.data();
          if (driverData.latitude && driverData.longitude && !driverData.currentRideId) {
            eligibleDrivers.push({
              id: doc.id,
              expoPushToken: driverData.expoPushToken,
              latitude: driverData.latitude,
              longitude: driverData.longitude,
              firstName: driverData.firstName || "Driver",
              phoneNumber: driverData.phoneNumber || null,
            });
          }
        });

        console.log(`Found ${eligibleDrivers.length} eligible drivers`);
        if (eligibleDrivers.length === 0) {
          console.log("No eligible drivers found");
          return;
        }

        // Select the best driver (for now, pick the first; replace with your algorithm)
        const bestDriver = eligibleDrivers[0];
        console.log("Selected driver:", bestDriver.id);

        // Add to SelectedDriver collection
        await db.collection("SelectedDriver").add({
          rideId: event.params.rideId,
          selectedDriverId: bestDriver.id,
          selectedDriverName: bestDriver.firstName,
          selectedDriverPhone: bestDriver.phoneNumber,
          createdAt: new Date(),
        });

        // 1. Send WhatsApp message FIRST if phone number exists
        if (bestDriver.phoneNumber) {
          const whatsappMessage =
            `🚗 *Nouvelle course possible!*

Bonjour ${bestDriver.firstName},

Ouvrez l'application Caval Courrier, vous pourriez recevoir une nouvelle course à accepter.

Merci de votre service!
Caval Team`;
          await sendWhatsAppMessage(bestDriver.phoneNumber, whatsappMessage);
        } else {
          console.log("Selected driver has no phone number");
        }

        // 2. Update the ride request with selected driver info
        await db.collection("rideRequests").doc(event.params.rideId).update({
          selectedDriverId: bestDriver.id,
          selectedDriverName: bestDriver.firstName,
          selectedDriverPhone: bestDriver.phoneNumber,
        });

        // 3. Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 4. Prepare notification data
        const notificationData = {
          type: "new_ride_offer",
          rideId: event.params.rideId,
          driverId: bestDriver.id,
          fare: (afterData.fare && afterData.fare.toString()) || "0",
          pickupAddress: afterData.pickupAddress || "",
          destinationAddress: afterData.destinationAddress || "",
          rideType: rideType,
        };

        // 5. Send push notification if Expo token exists
        if (bestDriver.expoPushToken) {
          await sendEnhancedPushNotification(
            bestDriver.expoPushToken,
            "🚗 Nouvelle course disponible!",
            "Une nouvelle demande de course correspond à votre profil. Ouvrez l'app pour voir les détails.",
            notificationData,
            bestDriver.id
          );
        } else {
          console.log("Selected driver has no Expo push token");
        }

        // 6. (Optional) Send WhatsApp ride details as before (if you want both messages)
        // If you want to keep the detailed WhatsApp message, uncomment below:
        /*
        if (bestDriver.phoneNumber) {
          const whatsappMessage = formatRideOfferMessage({
            pickupAddress: afterData.pickupAddress || "Adresse non disponible",
            destinationAddress: afterData.destinationAddress || "Adresse non disponible",
            fare: afterData.fare || 0,
            distance: afterData.distance || 5,
          }, bestDriver.firstName || "Chauffeur");

          await sendWhatsAppMessage(bestDriver.phoneNumber, whatsappMessage);
        } else {
          console.log("Selected driver has no phone number");
        }
        */

        console.log("Ride offer sent to selected driver only");
      } else if ((!beforeData || beforeData.status !== "assigned") &&
        afterData && afterData.status === "assigned" &&
        afterData.driverId) {
        console.log("Ride assigned to driver:", afterData.driverId);

        // Get driver's Firestore document
        const driverDoc = await db.collection("Drivers").doc(afterData.driverId).get();
        if (!driverDoc.exists) {
          console.log("Driver document not found");
          return;
        }

        const driverData = driverDoc.data();
        const expoPushToken = driverData.expoPushToken;

        // Send push notification if Expo token exists
        if (expoPushToken) {
          const notificationData = {
            type: "ride_assigned",
            rideId: event.params.rideId,
            driverId: afterData.driverId,
            fare: (afterData.fare && afterData.fare.toString()) || "0",
            pickupAddress: afterData.pickupAddress || "",
            destinationAddress: afterData.destinationAddress || "",
          };

          await sendEnhancedPushNotification(
            expoPushToken,
            "🎯 Course assignée!",
            "Vous avez été sélectionné pour une nouvelle course. " +
            "Ouvrez l'app pour voir les détails.",
            notificationData,
            afterData.driverId
          );
        } else {
          console.log("Driver has no Expo push token");
        }

        // Always send WhatsApp message if phone number exists
        try {
          console.log(`Assignment - Driver ${afterData.driverId} phone number:`, driverData.phoneNumber);
          if (driverData.phoneNumber) {
            console.log(`Attempting to send assignment WhatsApp message to driver ${afterData.driverId} at ${driverData.phoneNumber}`);
            const assignmentMessage = `🎯 *Course assignée!*

Bonjour ${driverData.firstName || "Chauffeur"},

Vous avez été sélectionné pour une nouvelle course!

📍 *Départ:* ${afterData.pickupAddress}
🎯 *Destination:* ${afterData.destinationAddress}
💰 *Prix:* Fdj${afterData.fare || "0"}

*Actions requises:*
1. Ouvrez l'application Caval Courrier
2. Allez dans l'onglet "Courses en cours"
3. Suivez les instructions pour récupérer le client

*Merci de votre service!*
Caval Team`;

            const assignmentResult = await sendWhatsAppMessage(driverData.phoneNumber, assignmentMessage);
            console.log(`Assignment WhatsApp message sent successfully to driver ${driverData.firstName} (${afterData.driverId}):`, assignmentResult);
          } else {
            console.log(`Driver ${afterData.driverId} has no phone number, skipping assignment WhatsApp message`);
          }
        } catch (whatsappError) {
          console.error(`Error sending WhatsApp assignment message to driver ${afterData.driverId}:`, whatsappError);
          // Don't fail the entire process if WhatsApp fails
        }

        console.log("Assignment notification sent successfully");
      }
    } catch (error) {
      console.error("Error in sendNewRideNotification:", error);
    }
  });

// Cloud Function to handle driver selection and delayed ride offer

exports.handleDriverSelection = onDocumentCreated({
  document: "rideRequests/{rideId}",
  maxInstances: 10,
}, async (event) => {
  const db = getFirestore();
  try {
    const rideData = event.data && event.data.data ? event.data.data() : null;
    if (!rideData || rideData.status !== "waiting") {
      console.log("Ride request is not in waiting status, skipping driver selection");
      return;
    }
    const rideType = rideData.rideType;
    if (!rideType) {
      console.log("No ride type specified");
      return;
    }
    // Get all online drivers of the same type
    const driversSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .where("isAvailable", "!=", false)
      .where("driverType", "==", rideType)
      .where("rideInProgress", "==", false)
      .get();
    const eligibleDrivers = [];
    driversSnapshot.forEach((doc) => {
      const driverData = doc.data();
      if (driverData.latitude && driverData.longitude && !driverData.currentRideId) {
        eligibleDrivers.push({
          id: doc.id,
          expoPushToken: driverData.expoPushToken,
          latitude: driverData.latitude,
          longitude: driverData.longitude,
          firstName: driverData.firstName || "Driver",
          phoneNumber: driverData.phoneNumber || null,
        });
      }
    });
    console.log(`Found ${eligibleDrivers.length} eligible drivers`);
    if (eligibleDrivers.length === 0) {
      console.log("No eligible drivers found");
      return;
    }
    // Select the best driver (for now, pick the first; replace with your algorithm)
    const bestDriver = eligibleDrivers[0];
    console.log("Selected driver:", bestDriver.id);
    
    // Calculate countdown times
    const now = new Date();
    const offerExpiryTime = new Date(now.getTime() + 15000); // 15 seconds from now
    
    // Create a DriverSelection document with countdown
    const driverSelectionRef = await db.collection("DriverSelection").add({
      rideId: event.params.rideId,
      selectedDriverId: bestDriver.id,
      selectedDriverName: bestDriver.firstName,
      selectedDriverPhone: bestDriver.phoneNumber,
      createdAt: now,
      offerSentAt: now,
      offerExpiryTime: offerExpiryTime,
      status: "pending_offer",
      countdownSeconds: 15,
      rideData: {
        fare: rideData.fare || 0,
        pickupAddress: rideData.pickupAddress || "",
        destinationAddress: rideData.destinationAddress || "",
        rideType: rideType,
        distance: rideData.distance || 0,
        customerName: rideData.customerName || "",
        customerPhone: rideData.customerPhone || "",
      }
    });
    
    console.log(`DriverSelection created with ID: ${driverSelectionRef.id}, expires at: ${offerExpiryTime}`);
    
    // Wait 3 seconds before sending notification
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Prepare notification data
    const notificationData = {
      type: "new_ride_offer",
      rideId: event.params.rideId,
      driverId: bestDriver.id,
      selectionId: driverSelectionRef.id,
      fare: (rideData.fare && rideData.fare.toString()) || "0",
      pickupAddress: rideData.pickupAddress || "",
      destinationAddress: rideData.destinationAddress || "",
      rideType: rideType,
      countdownSeconds: 15,
      offerExpiryTime: offerExpiryTime.toISOString(),
    };
    
    // Send push notification if Expo token exists
    if (bestDriver.expoPushToken) {
      await sendEnhancedPushNotification(
        bestDriver.expoPushToken,
        "🚗 Nouvelle course disponible!",
        "Une nouvelle demande de course correspond à votre profil. Ouvrez l'app pour voir les détails.",
        notificationData,
        bestDriver.id
      );
    } else {
      console.log("Selected driver has no Expo push token");
    }
    
    // Send WhatsApp message if phone number exists
    if (bestDriver.phoneNumber) {
      const whatsappMessage = formatRideOfferMessage({
        pickupAddress: rideData.pickupAddress || "Adresse non disponible",
        destinationAddress: rideData.destinationAddress || "Adresse non disponible",
        fare: rideData.fare || 0,
        distance: rideData.distance || 5,
      }, bestDriver.firstName || "Chauffeur");
      await sendWhatsAppMessage(bestDriver.phoneNumber, whatsappMessage);
    } else {
      console.log("Selected driver has no phone number");
    }
    
    // Update DriverSelection document status
    await driverSelectionRef.update({ 
      status: "offer_sent",
      notificationSentAt: new Date()
    });
    
    console.log("Ride offer sent to selected driver with 15-second countdown");
    
    // Schedule countdown expiration check
    setTimeout(async () => {
      try {
        const selectionDoc = await driverSelectionRef.get();
        if (selectionDoc.exists()) {
          const selectionData = selectionDoc.data();
          if (selectionData.status === "offer_sent" || selectionData.status === "pending_offer") {
            console.log(`Offer expired for ride ${event.params.rideId}, driver ${bestDriver.id}`);
            
            // Update status to expired
            await driverSelectionRef.update({
              status: "expired",
              expiredAt: new Date(),
              countdownSeconds: 0
            });
            
            // Update ride request status to waiting for next driver
            await db.collection("rideRequests").doc(event.params.rideId).update({
              status: "waiting_for_next_driver",
              lastDriverRejected: bestDriver.id,
              lastDriverRejectedAt: new Date()
            });
            
            console.log(`Offer expired and ride status updated for ${event.params.rideId}`);
          }
        }
      } catch (error) {
        console.error("Error handling offer expiration:", error);
      }
    }, 15000); // 15 seconds
    
  } catch (error) {
    console.error("Error in handleDriverSelection:", error);
  }
});

// Cloud Function to handle offer acceptance
exports.handleOfferAcceptance = onDocumentUpdated({
  document: "DriverSelection/{selectionId}",
  maxInstances: 10,
}, async (event) => {
  const db = getFirestore();
  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    // Check if status changed to accepted
    if ((!beforeData || beforeData.status !== "accepted") && 
        afterData && afterData.status === "accepted") {
      
      console.log(`Driver ${afterData.selectedDriverId} accepted offer for ride ${afterData.rideId}`);
      
      // Update ride request
      await db.collection("rideRequests").doc(afterData.rideId).update({
        status: "assigned",
        driverId: afterData.selectedDriverId,
        driverName: afterData.selectedDriverName,
        driverPhone: afterData.selectedDriverPhone,
        assignedAt: new Date(),
        acceptedAt: new Date()
      });
      
      // Update driver status
      await db.collection("Drivers").doc(afterData.selectedDriverId).update({
        rideInProgress: true,
        currentRideId: afterData.rideId,
        isAvailable: false,
        lastRideAcceptedAt: new Date()
      });
      
      console.log(`Ride ${afterData.rideId} assigned to driver ${afterData.selectedDriverId}`);
    }
  } catch (error) {
    console.error("Error in handleOfferAcceptance:", error);
  }
});

// Cloud Function to handle offer rejection
exports.handleOfferRejection = onDocumentUpdated({
  document: "DriverSelection/{selectionId}",
  maxInstances: 10,
}, async (event) => {
  const db = getFirestore();
  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    
    // Check if status changed to rejected
    if ((!beforeData || beforeData.status !== "rejected") && 
        afterData && afterData.status === "rejected") {
      
      console.log(`Driver ${afterData.selectedDriverId} rejected offer for ride ${afterData.rideId}`);
      
      // Update ride request to look for next driver
      await db.collection("rideRequests").doc(afterData.rideId).update({
        status: "waiting_for_next_driver",
        lastDriverRejected: afterData.selectedDriverId,
        lastDriverRejectedAt: new Date()
      });
      
      console.log(`Ride ${afterData.rideId} marked for next driver selection`);
    }
  } catch (error) {
    console.error("Error in handleOfferRejection:", error);
  }
});

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
    // Get all currently online drivers
    const driversSnapshot = await db.collection("Drivers")
      .where("isOnline", "==", true)
      .get();
    const onlineDrivers = [];
    driversSnapshot.forEach((doc) => {
      const data = doc.data();
      onlineDrivers.push({
        id: doc.id,
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phoneNumber: data.phoneNumber || "",
        driverType: data.driverType || "",
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        isAvailable: data.isAvailable || false,
        photo: data.photo || "",
      });
    });
    // Write/update the OnlineDriver document
    await db.collection("OnlineDriver").doc("summary").set({
      count: onlineDrivers.length,
      drivers: onlineDrivers,
      updatedAt: new Date(),
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
    const afterData = event.data && event.data.after ? event.data.after.data() : null;
    if (!afterData) return;

    // Only update if driver's online status changed
    const isOnline = afterData.isOnline === true;
    
    if (isOnline) {
      // Simple update - just increment count
      const onlineDriverRef = db.collection("OnlineDriver").doc("current");
      await onlineDriverRef.set({
        lastUpdated: new Date(),
        status: 'active'
      }, { merge: true });
    }
    
  } catch (error) {
    console.error('Error in maintainOnlineDriverDocument:', error);
  }
});

// Cloud Function to periodically clean up offline drivers from OnlineDriver document
exports.cleanupOfflineDrivers = onDocumentUpdated({
  document: "OnlineDriver/current",
  maxInstances: 1,
}, async (event) => {
  const db = getFirestore();

  try {
    const onlineDriverData = event.data && event.data.after ? event.data.after.data() : null;
    
    if (!onlineDriverData || !onlineDriverData.onlineDrivers) {
      return;
    }

    const currentTime = new Date();
    const offlineDrivers = [];
    const updatedOnlineDrivers = [];

    // Check each driver's last online update
    for (const driver of onlineDriverData.onlineDrivers) {
      if (driver.lastOnlineUpdate) {
        const lastUpdate = new Date(driver.lastOnlineUpdate);
        const timeDiff = (currentTime - lastUpdate) / 1000; // seconds
        
        // If driver hasn't updated in more than 10 minutes, consider them offline
        if (timeDiff > 600) {
          offlineDrivers.push(driver.id);
        } else {
          updatedOnlineDrivers.push(driver);
        }
      } else {
        // If no lastOnlineUpdate, keep them for now
        updatedOnlineDrivers.push(driver);
      }
    }

    // If we found offline drivers, update the document
    if (offlineDrivers.length > 0) {
      console.log(`Cleaning up ${offlineDrivers.length} offline drivers:`, offlineDrivers);
      
      // Recalculate totals
      let totalDrivers = updatedOnlineDrivers.length;
      let totalAvailableDrivers = 0;
      let driversByType = {};

      updatedOnlineDrivers.forEach((driver) => {
        if (driver.isAvailable !== false) {
          totalAvailableDrivers++;
        }

        const driverType = driver.driverType || 'unknown';
        if (!driversByType[driverType]) {
          driversByType[driverType] = {
            count: 0,
            available: 0,
            drivers: []
          };
        }
        driversByType[driverType].count++;
        if (driver.isAvailable !== false) {
          driversByType[driverType].available++;
        }
      });

      const updatedData = {
        totalOnlineDrivers: totalDrivers,
        totalAvailableDrivers: totalAvailableDrivers,
        driversByType: driversByType,
        onlineDrivers: updatedOnlineDrivers,
        lastUpdated: currentTime,
        lastCleanup: currentTime,
        cleanedUpDrivers: offlineDrivers,
        status: totalDrivers > 0 ? 'active' : 'inactive'
      };

      await db.collection("OnlineDriver").doc("current").set(updatedData);
      console.log(`Cleaned up offline drivers. Remaining: ${totalDrivers} online, ${totalAvailableDrivers} available`);
    }
  } catch (error) {
    console.error("Error cleaning up offline drivers:", error);
  }
});

// Test function for WhatsApp integration
const {onRequest} = require("firebase-functions/v2/https");

// Scheduled function to clean up offline drivers every minute
const {onSchedule} = require("firebase-functions/v2/scheduler");

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

exports.testWhatsAppIntegration = onRequest(
  { maxInstances: 10 },
  async (request, response) => {
  try {
    // Test phone number (replace with a real number for testing)
    const testPhoneNumber = "+25377702036"; // Replace with actual test number

    const testMessage = `🧪 *Test WhatsApp Integration*

Bonjour Test Driver,

Ceci est un test de l'intégration WhatsApp pour Eco-share.

📍 *Départ:* Test Address
🎯 *Destination:* Test Destination
💰 *Prix:* Fdj1000

⏰ *Temps estimé:* ~15 min

*Test réussi si vous recevez ce message!*

Merci!
Eco-share Team`;

    console.log("Testing WhatsApp integration...");
    console.log("Phone number:", testPhoneNumber);
    console.log("Message:", testMessage);

    // Test the UltraMsg integration
    const result = await sendWhatsAppMessageUltraMsg(testPhoneNumber, testMessage);

    console.log("WhatsApp test result:", result);

    response.json({
      success: true,
      message: "WhatsApp test completed",
      result: result,
      phoneNumber: testPhoneNumber,
    });
  } catch (error) {
    console.error("WhatsApp test failed:", error);
    response.status(500).json({
      success: false,
      error: error.message,
      details: error,
    });
  }
});

// ============================================================================
// NEW: Ride Distribution System - Select Best Driver for New Ride Requests
// ============================================================================

exports.selectBestDriverForRide = onDocumentCreated({
  document: "rideRequests/{rideId}",
  maxInstances: 1,
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (event) => {
  const db = getFirestore();
  
  try {
    const rideData = event.data && event.data.data ? event.data.data() : null;
    if (!rideData || rideData.status !== 'waiting') {
      return;
    }
    
    const rideId = event.params.rideId;
    console.log(`Processing ride ${rideId} for type: ${rideData.rideType}`);
    
    // Simple driver selection - just get the first available driver
    const driversQuery = db
      .collection('Drivers')
      .where('isOnline', '==', true)
      .where('driverType', '==', rideData.rideType)
      .limit(1);
    
    const driversSnapshot = await driversQuery.get();
    
    if (driversSnapshot.empty) {
      console.log(`No drivers found for type: ${rideData.rideType}`);
      return;
    }
    
    const driverDoc = driversSnapshot.docs[0];
    const driverData = driverDoc.data();
    
    // Calculate countdown times
    const now = new Date();
    const countdownExpiryTime = new Date(now.getTime() + 15000); // 15 seconds from now
    
    // Store selection data with countdown
    await db.collection("SelectedDriver").doc(rideId).set({
      rideId: rideId,
      selectedDriverId: driverDoc.id,
      status: 'selected',
      timestamp: now,
      countdownStartedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      countdownSeconds: 15,
      isCountdownActive: true
    });
    
    // Update ride request
    await db.collection("rideRequests").doc(rideId).update({
      selectedDriverId: driverDoc.id,
      status: 'driver_selected',
      driverSelectedAt: now,
      countdownExpiryTime: countdownExpiryTime
    });
    
    console.log(`Ride ${rideId} assigned to driver ${driverDoc.id} with 15s countdown`);
    
    // Send push notification to the selected driver
    try {
      if (driverData.expoPushToken) {
        const notificationData = {
          type: "new_ride_offer",
          rideId: rideId,
          driverId: driverDoc.id,
          fare: (rideData.fare && rideData.fare.toString()) || "0",
          pickupAddress: rideData.pickupAddress || "",
          destinationAddress: rideData.destinationAddress || "",
          rideType: rideData.rideType,
          countdownSeconds: 15
        };
        
        await sendEnhancedPushNotification(
          driverData.expoPushToken,
          "🚗 Nouvelle course disponible!",
          "Une course vous attend! Ouvrez l'app pour voir l'offre. (15s pour répondre)",
          notificationData,
          driverDoc.id
        );
        
        console.log(`Push notification sent to driver ${driverDoc.id} for ride ${rideId}`);
      } else {
        console.log(`Driver ${driverDoc.id} has no Expo push token`);
      }
    } catch (notificationError) {
      console.error(`Error sending push notification to driver ${driverDoc.id}:`, notificationError);
      // Continue with the process even if notification fails
    }
    
    // Start countdown timer for auto-reassignment
    setTimeout(async () => {
      try {
        console.log(`Countdown expired for ride ${rideId}, checking if driver accepted...`);
        
        // Check if the ride status has changed from 'driver_selected' to 'assigned'
        const rideDoc = await db.collection("rideRequests").doc(rideId).get();
        if (!rideDoc.exists) {
          console.log(`Ride ${rideId} no longer exists, skipping countdown check`);
          return;
        }
        
        const currentRideData = rideDoc.data();
        
        // If status is still 'driver_selected', driver didn't accept - reassign
        if (currentRideData.status === 'driver_selected') {
          console.log(`Driver ${driverDoc.id} didn't accept ride ${rideId} within 15s, reassigning...`);
          
          // Find next available driver
          const nextDriver = await findNextAvailableDriver(currentRideData, driverDoc.id, db);
          
          if (nextDriver) {
            // Reassign to next driver
            await reassignRideToNextDriver(rideId, nextDriver, currentRideData, db);
            console.log(`Ride ${rideId} reassigned to next driver ${nextDriver.id}`);
          } else {
            // No other drivers available
            await markRideAsNoDriversAvailable(rideId, currentRideData, db);
            console.log(`No other drivers available for ride ${rideId}`);
          }
        } else {
          console.log(`Ride ${rideId} status changed to ${currentRideData.status}, countdown no longer needed`);
        }
        
      } catch (error) {
        console.error(`Error in countdown timer for ride ${rideId}:`, error);
      }
    }, 15000); // 15 seconds
    
  } catch (error) {
    console.error(`Error in selectBestDriverForRide:`, error);
  }
});

// ============================================================================
// NEW: Ride Status Change Handler - Minimal Version
// ============================================================================

exports.handleRideStatusChange = onDocumentUpdated({
  document: "rideRequests/{rideId}",
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
    
    // Handle ride completion
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
    
    // Get all online drivers of the specified type, excluding the declined driver
    const driversQuery = db
      .collection('Drivers')
      .where('isOnline', '==', true)
      .where('driverType', '==', rideType)
      .limit(5); // Limit to 5 to avoid quota issues
    
    const driversSnapshot = await driversQuery.get();
    
    if (driversSnapshot.empty) {
      console.log(`No online drivers found for type: ${rideType}`);
      return null;
    }
    
    const eligibleDrivers = [];
    
    driversSnapshot.forEach(doc => {
      const driverData = doc.data();
      
      // Exclude the declined driver
      if (doc.id !== excludedDriverId) {
        eligibleDrivers.push({
          id: doc.id,
          firstName: driverData.firstName || "Driver",
          lastName: driverData.lastName || "",
          phoneNumber: driverData.phoneNumber || "",
          photo: driverData.photo || "",
          rating: driverData.rating || 0,
          rideCount: driverData.rideCount || 0
        });
      }
    });
    
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
      driverSelectedAt: now,
      countdownExpiryTime: countdownExpiryTime,
      reassignmentAttempts: increment(1),
      lastReassignmentTime: now
    });
    
    // Update the SelectedDriver collection
    await db.collection("SelectedDriver").doc(rideId).update({
      status: "reassigned",
      selectedDriverId: nextDriver.id,
      reassignedAt: now,
      reassignedToDriver: nextDriver.id,
      reassignmentAttempt: increment(1),
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
        
        // If status is still 'driver_selected', driver didn't accept - try one more time
        if (currentRideData.status === 'driver_selected') {
          const reassignmentAttempts = currentRideData.reassignmentAttempts || 1;
          
          if (reassignmentAttempts < 3) { // Max 3 attempts
            console.log(`Driver ${nextDriver.id} didn't accept ride ${rideId}, trying one more reassignment...`);
            
            const finalDriver = await findNextAvailableDriver(currentRideData, nextDriver.id, db);
            if (finalDriver) {
              await reassignRideToNextDriver(rideId, finalDriver, currentRideData, db);
            } else {
              await markRideAsNoDriversAvailable(rideId, currentRideData, db);
            }
          } else {
            console.log(`Max reassignment attempts reached for ride ${rideId}`);
            await markRideAsNoDriversAvailable(rideId, currentRideData, db);
          }
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

// Helper function to increment values
function increment(value) {
  return (value || 0) + 1;
}
