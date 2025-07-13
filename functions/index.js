/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {onDocumentUpdated, onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

// Initialize Firebase Admin
initializeApp();

// Function to send Expo push notification
const sendExpoPushNotification = async (pushToken, title, body, data) => {
  const message = {
    to: pushToken,
    sound: "default",
    title: title,
    body: body,
    data: data,
    priority: "high",
    channelId: "ride-requests",
  };

  try {
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
    return result;
  } catch (error) {
    console.error("Error sending Expo push notification:", error);
    throw error;
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

// Cloud Function to handle ride assignment with driver selection from OnlineDriver collection
exports.handleRideAssignment = onDocumentCreated({
  document: "rideRequests/{rideId}",
  maxInstances: 10,
}, async (event) => {
  const db = getFirestore();
  
  try {
    const rideData = event.data && event.data.data ? event.data.data() : null;
    
    if (!rideData || rideData.status !== "waiting") {
      console.log("Ride request is not in waiting status, skipping assignment");
      return;
    }

    const rideType = rideData.rideType;
    if (!rideType) {
      console.log("No ride type specified");
      return;
    }

    console.log(`Processing ride assignment for ride ${event.params.rideId}, type: ${rideType}`);

    // Get the current OnlineDriver document
    const onlineDriverDoc = await db.collection("OnlineDriver").doc("current").get();
    
    if (!onlineDriverDoc.exists) {
      console.log("No OnlineDriver document found");
      return;
    }

    const onlineDriverData = onlineDriverDoc.data();
    
    if (!onlineDriverData || !onlineDriverData.onlineDrivers || onlineDriverData.onlineDrivers.length === 0) {
      console.log("No online drivers available");
      return;
    }

    // Filter available drivers by type and availability
    const eligibleDrivers = onlineDriverData.onlineDrivers.filter(driver => {
      return driver.driverType === rideType && 
             driver.isAvailable === true &&
             driver.latitude && 
             driver.longitude;
    });

    console.log(`Found ${eligibleDrivers.length} eligible drivers for ride type: ${rideType}`);

    if (eligibleDrivers.length === 0) {
      console.log("No eligible drivers found for this ride type");
      return;
    }

    // Calculate distance from pickup location to each driver
    const pickupLocation = {
      latitude: rideData.pickupLat,
      longitude: rideData.pickupLng
    };

    const driversWithDistance = eligibleDrivers.map(driver => {
      const distance = calculateDistance(pickupLocation, {
        latitude: driver.latitude,
        longitude: driver.longitude
      });
      
      return {
        ...driver,
        distanceToPickup: distance
      };
    });

    // Sort by distance (closest first) and then by rating (highest first)
    driversWithDistance.sort((a, b) => {
      // Primary sort: distance (closest first)
      if (Math.abs(a.distanceToPickup - b.distanceToPickup) > 0.1) {
        return a.distanceToPickup - b.distanceToPickup;
      }
      // Secondary sort: rating (highest first)
      return (b.rating || 0) - (a.rating || 0);
    });

    // Select the best driver (closest with highest rating)
    const selectedDriver = driversWithDistance[0];
    
    console.log(`Selected driver: ${selectedDriver.id} (${selectedDriver.firstName})`);
    console.log(`Distance to pickup: ${selectedDriver.distanceToPickup.toFixed(2)} km`);
    console.log(`Driver rating: ${selectedDriver.rating || 0}`);

    // Create SelectedDriver document
    const selectedDriverData = {
      rideId: event.params.rideId,
      driverId: selectedDriver.id,
      driverInfo: {
        firstName: selectedDriver.firstName,
        lastName: selectedDriver.lastName,
        phoneNumber: selectedDriver.phoneNumber,
        driverType: selectedDriver.driverType,
        rating: selectedDriver.rating,
        rideCount: selectedDriver.rideCount,
        photo: selectedDriver.photo,
        latitude: selectedDriver.latitude,
        longitude: selectedDriver.longitude
      },
      rideInfo: {
        pickupLat: rideData.pickupLat,
        pickupLng: rideData.pickupLng,
        destinationLat: rideData.destinationLat,
        destinationLng: rideData.destinationLng,
        pickupAddress: rideData.pickupAddress,
        destinationAddress: rideData.destinationAddress,
        fare: rideData.fare,
        distance: rideData.distance,
        rideType: rideData.rideType
      },
      selectionCriteria: {
        distanceToPickup: selectedDriver.distanceToPickup,
        driverRating: selectedDriver.rating,
        totalEligibleDrivers: eligibleDrivers.length
      },
      status: "selected",
      selectedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from now
      notificationSent: false
    };

    // Save to SelectedDriver collection
    await db.collection("SelectedDriver").add(selectedDriverData);
    
    console.log(`Driver ${selectedDriver.id} registered in SelectedDriver collection`);

    // Wait 3 seconds before sending notification
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send notification to selected driver
    try {
      // Get driver's current document to get push token
      const driverDoc = await db.collection("Drivers").doc(selectedDriver.id).get();
      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        
        // Send push notification if Expo token exists
        if (driverData.expoPushToken) {
          const notificationData = {
            type: "new_ride_offer",
            rideId: event.params.rideId,
            driverId: selectedDriver.id,
            fare: (rideData.fare && rideData.fare.toString()) || "0",
            pickupAddress: rideData.pickupAddress || "",
            destinationAddress: rideData.destinationAddress || "",
            rideType: rideData.rideType,
            distance: selectedDriver.distanceToPickup.toFixed(2)
          };

          await sendExpoPushNotification(
            driverData.expoPushToken,
            "🚗 Nouvelle course disponible!",
            `Une nouvelle course à ${selectedDriver.distanceToPickup.toFixed(1)}km de vous. Ouvrez l'app pour voir les détails.`,
            notificationData
          );
          
          console.log(`Push notification sent to driver ${selectedDriver.id}`);
        } else {
          console.log(`Driver ${selectedDriver.id} has no Expo push token`);
        }

        // Send WhatsApp message if phone number exists
        if (selectedDriver.phoneNumber) {
          const whatsappMessage = formatRideOfferMessage({
            pickupAddress: rideData.pickupAddress || "Adresse non disponible",
            destinationAddress: rideData.destinationAddress || "Adresse non disponible",
            fare: rideData.fare || 0,
            distance: selectedDriver.distanceToPickup
          }, selectedDriver.firstName || "Chauffeur");

          await sendWhatsAppMessage(selectedDriver.phoneNumber, whatsappMessage);
          console.log(`WhatsApp message sent to driver ${selectedDriver.id}`);
        } else {
          console.log(`Driver ${selectedDriver.id} has no phone number`);
        }
      }

      // Update SelectedDriver document to mark notification as sent
      const selectedDriverQuery = await db.collection("SelectedDriver")
        .where("rideId", "==", event.params.rideId)
        .where("driverId", "==", selectedDriver.id)
        .get();
      
      if (!selectedDriverQuery.empty) {
        const docRef = selectedDriverQuery.docs[0].ref;
        await docRef.update({ 
          notificationSent: true,
          notificationSentAt: new Date()
        });
      }

      console.log(`Ride assignment completed for driver ${selectedDriver.id}`);
    } catch (error) {
      console.error("Error sending notification to selected driver:", error);
    }

  } catch (error) {
    console.error("Error in handleRideAssignment:", error);
  }
});

// Helper function to calculate distance between two points
const calculateDistance = (point1, point2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((point2.latitude - point1.latitude) * Math.PI) / 180;
  const dLon = ((point2.longitude - point1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((point1.latitude * Math.PI) / 180) *
      Math.cos((point2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
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

        // Update the ride request with selected driver info
        await db.collection("rideRequests").doc(event.params.rideId).update({
          selectedDriverId: bestDriver.id,
          selectedDriverName: bestDriver.firstName,
          selectedDriverPhone: bestDriver.phoneNumber,
        });

        // Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Prepare notification data
        const notificationData = {
          type: "new_ride_offer",
          rideId: event.params.rideId,
          driverId: bestDriver.id,
          fare: (afterData.fare && afterData.fare.toString()) || "0",
          pickupAddress: afterData.pickupAddress || "",
          destinationAddress: afterData.destinationAddress || "",
          rideType: rideType,
        };

        // Send push notification if Expo token exists
        if (bestDriver.expoPushToken) {
          await sendExpoPushNotification(
            bestDriver.expoPushToken,
            "🚗 Nouvelle course disponible!",
            "Une nouvelle demande de course correspond à votre profil. Ouvrez l'app pour voir les détails.",
            notificationData,
          );
        } else {
          console.log("Selected driver has no Expo push token");
        }

        // Send WhatsApp message if phone number exists
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

          await sendExpoPushNotification(
            expoPushToken,
            "🎯 Course assignée!",
            "Vous avez été sélectionné pour une nouvelle course. " +
            "Ouvrez l'app pour voir les détails.",
            notificationData,
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
    // Create a DriverSelection document
    await db.collection("DriverSelection").add({
      rideId: event.params.rideId,
      selectedDriverId: bestDriver.id,
      selectedDriverName: bestDriver.firstName,
      selectedDriverPhone: bestDriver.phoneNumber,
      createdAt: new Date(),
      status: "pending_offer"
    });
    // Wait 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    // Prepare notification data
    const notificationData = {
      type: "new_ride_offer",
      rideId: event.params.rideId,
      driverId: bestDriver.id,
      fare: (rideData.fare && rideData.fare.toString()) || "0",
      pickupAddress: rideData.pickupAddress || "",
      destinationAddress: rideData.destinationAddress || "",
      rideType: rideType,
    };
    // Send push notification if Expo token exists
    if (bestDriver.expoPushToken) {
      await sendExpoPushNotification(
        bestDriver.expoPushToken,
        "🚗 Nouvelle course disponible!",
        "Une nouvelle demande de course correspond à votre profil. Ouvrez l'app pour voir les détails.",
        notificationData,
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
    const selectionQuery = await db.collection("DriverSelection")
      .where("rideId", "==", event.params.rideId)
      .where("selectedDriverId", "==", bestDriver.id)
      .get();
    if (!selectionQuery.empty) {
      const docRef = selectionQuery.docs[0].ref;
      await docRef.update({ status: "offer_sent" });
    }
    console.log("Ride offer sent to selected driver only and DriverSelection updated");
  } catch (error) {
    console.error("Error in handleDriverSelection:", error);
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
  maxInstances: 10,
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
  maxInstances: 10,
}, async (event) => {
  const db = getFirestore();

  try {
    const beforeData = event.data && event.data.before ? event.data.before.data() : null;
    const afterData = event.data && event.data.after ? event.data.after.data() : null;

    // Check if driver's online status changed
    const wasOnline = beforeData && beforeData.isOnline === true;
    const isOnline = afterData && afterData.isOnline === true;
    
    if (wasOnline !== isOnline) {
      console.log(`Driver ${event.params.driverId} online status changed from ${wasOnline} to ${isOnline}`);
      
      // Get all online drivers
      const driversSnapshot = await db.collection("Drivers")
        .where("isOnline", "==", true)
        .get();

      const onlineDrivers = [];
      let totalDrivers = 0;
      let totalAvailableDrivers = 0;
      let driversByType = {};

      driversSnapshot.forEach((doc) => {
        const driverData = doc.data();
        totalDrivers++;
        
        if (driverData.isAvailable !== false) {
          totalAvailableDrivers++;
        }

        // Group by driver type
        const driverType = driverData.driverType || 'unknown';
        if (!driversByType[driverType]) {
          driversByType[driverType] = {
            count: 0,
            available: 0,
            drivers: []
          };
        }
        driversByType[driverType].count++;
        if (driverData.isAvailable !== false) {
          driversByType[driverType].available++;
        }

        // Add driver information (excluding sensitive data)
        onlineDrivers.push({
          id: doc.id,
          firstName: driverData.firstName || 'Driver',
          lastName: driverData.lastName || '',
          phoneNumber: driverData.phoneNumber || '',
          driverType: driverData.driverType || 'unknown',
          rating: driverData.rating || 0,
          rideCount: driverData.rideCount || 0,
          isAvailable: driverData.isAvailable !== false,
          latitude: driverData.latitude || null,
          longitude: driverData.longitude || null,
          lastLocationUpdate: driverData.lastLocationUpdate || null,
          lastOnlineUpdate: driverData.lastOnlineUpdate || null,
          city: driverData.city || '',
          vehicleType: driverData.vehicleType || '',
          carMake: driverData.carMake || '',
          carModel: driverData.carModel || '',
          carColor: driverData.carColor || '',
          plaqueImmatriculation: driverData.plaqueImmatriculation || ''
        });
      });

      // Create or update the OnlineDriver document
      const onlineDriverData = {
        totalOnlineDrivers: totalDrivers,
        totalAvailableDrivers: totalAvailableDrivers,
        driversByType: driversByType,
        onlineDrivers: onlineDrivers,
        lastUpdated: new Date(),
        updatedBy: event.params.driverId,
        status: totalDrivers > 0 ? 'active' : 'inactive'
      };

      await db.collection("OnlineDriver").doc("current").set(onlineDriverData);
      
      console.log(`Updated OnlineDriver document: ${totalDrivers} total online, ${totalAvailableDrivers} available`);
    }
  } catch (error) {
    console.error("Error maintaining OnlineDriver document:", error);
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

exports.scheduledCleanupOfflineDrivers = onSchedule({
  schedule: "every 1 minutes",
  maxInstances: 1,
}, async (event) => {
  const db = getFirestore();

  try {
    console.log("Running scheduled cleanup of offline drivers...");
    
    // Get the current OnlineDriver document
    const onlineDriverDoc = await db.collection("OnlineDriver").doc("current").get();
    
    if (!onlineDriverDoc.exists) {
      console.log("No OnlineDriver document found, skipping cleanup");
      return;
    }

    const onlineDriverData = onlineDriverDoc.data();
    
    if (!onlineDriverData || !onlineDriverData.onlineDrivers) {
      console.log("No online drivers data found, skipping cleanup");
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
          console.log(`Driver ${driver.id} marked as offline (last update: ${lastUpdate}, time diff: ${timeDiff}s)`);
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
      console.log(`Scheduled cleanup: Removing ${offlineDrivers.length} offline drivers:`, offlineDrivers);
      
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
      console.log(`Scheduled cleanup completed. Remaining: ${totalDrivers} online, ${totalAvailableDrivers} available`);
    } else {
      console.log("Scheduled cleanup: No offline drivers found");
    }
  } catch (error) {
    console.error("Error in scheduled cleanup of offline drivers:", error);
  }
});

exports.cleanupExpiredSelectedDrivers = onSchedule({
  schedule: "every 5 minutes",
  maxInstances: 1,
}, async (event) => {
  const db = getFirestore();

  try {
    console.log("Running scheduled cleanup of expired SelectedDriver documents...");
    
    const currentTime = new Date();
    const cutoffTime = new Date(currentTime.getTime() - 15 * 60 * 1000); // 15 minutes ago
    
    // Query for expired SelectedDriver documents
    const expiredQuery = query(
      collection(db, "SelectedDriver"),
      where("status", "==", "selected"),
      where("selectedAt", "<", cutoffTime)
    );
    
    const expiredDocs = await getDocs(expiredQuery);
    
    if (expiredDocs.empty) {
      console.log("No expired SelectedDriver documents found");
      return;
    }

    console.log(`Found ${expiredDocs.size} expired SelectedDriver documents to clean up`);
    
    // Update expired documents to expired status
    const batch = db.batch();
    expiredDocs.forEach((doc) => {
      batch.update(doc.ref, {
        status: "expired",
        expiredAt: currentTime
      });
    });
    
    await batch.commit();
    console.log(`Successfully updated ${expiredDocs.size} expired SelectedDriver documents`);
    
  } catch (error) {
    console.error("Error in cleanup of expired SelectedDriver documents:", error);
  }
});

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
