/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onDocumentUpdated} = require("firebase-functions/v2/firestore");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");
const {getMessaging} = require("firebase-admin/messaging");

// Initialize Firebase Admin
initializeApp();

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

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

// Alternative function to send WhatsApp message using free API service
const sendWhatsAppMessageFree = async (phoneNumber, message) => {
  try {
    // Using a free WhatsApp API service (you can choose from several options)
    // Option 1: Using WhatsApp API Gateway
    const response = await fetch("https://api.whatsapp.com/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer YOUR_FREE_API_KEY", // Get from free WhatsApp API service
      },
      body: JSON.stringify({
        phone: phoneNumber,
        message: message,
        type: "text",
      }),
    });

    const result = await response.json();
    console.log("Free WhatsApp API result:", result);
    return result;
  } catch (error) {
    console.error("Error sending WhatsApp message via free API:", error);
    throw error;
  }
};

// Function to send WhatsApp message to driver
const sendWhatsAppMessage = async (phoneNumber, message) => {
  try {
    // You'll need to replace these with your actual WhatsApp Business API credentials
    const accessToken = "YOUR_WHATSAPP_ACCESS_TOKEN";
    const phoneNumberId = "YOUR_PHONE_NUMBER_ID";
    
    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
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
    });

    const result = await response.json();
    console.log("WhatsApp message result:", result);
    return result;
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

📍 *Départ:* ${rideData.pickupAddress || "Adresse non disponible"}
🎯 *Destination:* ${rideData.destinationAddress || "Adresse non disponible"}
💰 *Prix:* Fdj${rideData.fare || "0"}

⏰ *Temps estimé:* ~${Math.round((rideData.distance || 5) / 30 * 60)} min

*Pour accepter cette course:*
1. Ouvrez l'application Eco-share
2. Allez dans l'onglet "Courses"
3. Cliquez sur "Accepter"

*Cette offre expire dans 15 minutes.*

Merci de votre service!
Eco-share Team`;
};

// Cloud Function to send push notification when a new ride request is created
exports.sendNewRideNotification = onDocumentUpdated("rideRequests/{rideId}", 
    async (event) => {
      const db = getFirestore();

      try {
        const beforeData = event.data && event.data.before ? 
            event.data.before.data() : null;
        const afterData = event.data && event.data.after ? 
            event.data.after.data() : null;

        // Check if a new ride request was created (status changed to "waiting")
        if ((!beforeData || beforeData.status !== "waiting") &&
            afterData && afterData.status === "waiting") {
          console.log("New ride request created, notifying eligible drivers");

          const rideType = afterData.rideType;
          if (!rideType) {
            console.log("No ride type specified");
            return;
          }

          // Get all online drivers of the same type with Expo push tokens
          const driversSnapshot = await db.collection("Drivers")
              .where("isOnline", "==", true)
              .where("isAvailable", "!=", false)
              .where("driverType", "==", rideType)
              .where("rideInProgress", "==", false)
              .get();

          const eligibleDrivers = [];
          driversSnapshot.forEach((doc) => {
            const driverData = doc.data();
            if (driverData.expoPushToken &&
                driverData.latitude &&
                driverData.longitude &&
                !driverData.currentRideId) {
              eligibleDrivers.push({
                id: doc.id,
                expoPushToken: driverData.expoPushToken,
                latitude: driverData.latitude,
                longitude: driverData.longitude,
                firstName: driverData.firstName || "Driver",
              });
            }
          });

          console.log(`Found ${eligibleDrivers.length} eligible drivers with Expo push tokens`);

          // Send notification to all eligible drivers
          const notificationPromises = eligibleDrivers.map(async (driver) => {
            try {
              const notificationData = {
                type: "new_ride_offer",
                rideId: event.params.rideId,
                driverId: driver.id,
                fare: (afterData.fare && afterData.fare.toString()) || "0",
                pickupAddress: afterData.pickupAddress || "",
                destinationAddress: afterData.destinationAddress || "",
                rideType: rideType,
              };

              // Send push notification
              await sendExpoPushNotification(
                  driver.expoPushToken,
                  "🚗 Nouvelle course disponible!",
                  "Une nouvelle demande de course correspond à votre profil. " +
                  "Ouvrez l'app pour voir les détails.",
                  notificationData
              );

              // Send WhatsApp message if driver has phone number
              try {
                const driverDoc = await db.collection("Drivers").doc(driver.id).get();
                if (driverDoc.exists) {
                  const driverData = driverDoc.data();
                  if (driverData.phoneNumber) {
                    const whatsappMessage = formatRideOfferMessage({
                      pickupAddress: afterData.pickupAddress || "Adresse non disponible",
                      destinationAddress: afterData.destinationAddress || "Adresse non disponible",
                      fare: afterData.fare || 0,
                      distance: afterData.distance || 5,
                    }, driverData.firstName || "Chauffeur");

                    await sendWhatsAppMessage(driverData.phoneNumber, whatsappMessage);
                    console.log(`WhatsApp message sent to driver ${driver.firstName} (${driver.id})`);
                  }
                }
              } catch (whatsappError) {
                console.error(`Error sending WhatsApp message to driver ${driver.id}:`, whatsappError);
                // Don't fail the entire process if WhatsApp fails
              }

              console.log(`Notification sent to driver ${driver.firstName} (${driver.id})`);
            } catch (error) {
              console.error(`Error sending notification to driver ${driver.id}:`, error);
            }
          });

          // Wait for all notifications to be sent
          await Promise.all(notificationPromises);
          console.log("All notifications sent successfully");
        } else if ((!beforeData || beforeData.status !== "assigned") &&
                   afterData && afterData.status === "assigned" &&
                   afterData.driverId) {
          console.log("Ride assigned to driver:", afterData.driverId);

          // Get driver's Expo push token
          const driverDoc = await db.collection("Drivers").doc(afterData.driverId).get();
          if (!driverDoc.exists) {
            console.log("Driver document not found");
            return;
          }

          const driverData = driverDoc.data();
          const expoPushToken = driverData.expoPushToken;

          if (!expoPushToken) {
            console.log("Driver has no Expo push token");
            return;
          }

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
              notificationData
          );

          // Send WhatsApp message for ride assignment
          try {
            const driverDoc = await db.collection("Drivers").doc(afterData.driverId).get();
            if (driverDoc.exists) {
              const driverData = driverDoc.data();
              if (driverData.phoneNumber) {
                const assignmentMessage = `🎯 *Course assignée!*

Bonjour ${driverData.firstName || "Chauffeur"},

Vous avez été sélectionné pour une nouvelle course!

📍 *Départ:* ${afterData.pickupAddress || "Adresse non disponible"}
🎯 *Destination:* ${afterData.destinationAddress || "Adresse non disponible"}
💰 *Prix:* Fdj${afterData.fare || "0"}

*Actions requises:*
1. Ouvrez l'application Eco-share
2. Allez dans l'onglet "Courses en cours"
3. Suivez les instructions pour récupérer le client

*Merci de votre service!*
Eco-share Team`;

                await sendWhatsAppMessage(driverData.phoneNumber, assignmentMessage);
                console.log(`WhatsApp assignment message sent to driver ${driverData.firstName} (${afterData.driverId})`);
              }
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

// Cloud Function to send approval notification when driver status is updated
exports.sendDriverApprovalNotification = onDocumentUpdated("Drivers/{driverId}", 
    async (event) => {
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

// Example function (uncomment and edit as needed)
// const { onRequest } = require("firebase-functions/https");
// const logger = require("firebase-functions/logger");
// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", { structuredData: true });
//   response.send("Hello from Firebase!");
// });
