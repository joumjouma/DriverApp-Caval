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

// Cloud Function to send push notification when a driver is assigned a ride
exports.sendRideAssignmentNotification = onDocumentUpdated('rideRequests/{rideId}', async (event) => {
  const db = getFirestore();
  const messaging = getMessaging();
  
  try {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    
    // Check if ride status changed to "assigned" and has a driverId
    if (beforeData?.status !== 'assigned' && 
        afterData?.status === 'assigned' && 
        afterData?.driverId) {
      
      console.log('Ride assigned to driver:', afterData.driverId);
      
      // Get driver's push token
      const driverDoc = await db.collection('Drivers').doc(afterData.driverId).get();
      if (!driverDoc.exists) {
        console.log('Driver document not found');
        return;
      }
      
      const driverData = driverDoc.data();
      const pushToken = driverData.pushToken;
      
      if (!pushToken) {
        console.log('Driver has no push token');
        return;
      }
      
      // Prepare notification message
      const message = {
        token: pushToken,
        notification: {
          title: '🎯 Course assignée!',
          body: 'Vous avez été sélectionné pour une nouvelle course. Ouvrez l\'app pour voir les détails.',
        },
        data: {
          type: 'ride_request',
          rideId: event.params.rideId,
          driverId: afterData.driverId,
          fare: afterData.fare?.toString() || '0',
          pickupAddress: afterData.pickupAddress || '',
          destinationAddress: afterData.destinationAddress || '',
        },
        android: {
          notification: {
            sound: 'default',
            channelId: 'ride-requests',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            vibrateTimings: [0, 250, 250, 250],
            icon: 'ic_launcher',
            color: '#FF8C00',
            largeIcon: 'ic_launcher',
            style: {
              type: 'bigtext',
              text: 'Vous avez été sélectionné pour une nouvelle course. Ouvrez l\'app pour voir les détails.',
              summary: 'Nouvelle course disponible'
            }
          },
          data: {
            type: 'ride_request',
            rideId: event.params.rideId,
            driverId: afterData.driverId,
            fare: afterData.fare?.toString() || '0',
            pickupAddress: afterData.pickupAddress || '',
            destinationAddress: afterData.destinationAddress || '',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              alert: {
                title: '🎯 Course assignée!',
                body: 'Vous avez été sélectionné pour une nouvelle course. Ouvrez l\'app pour voir les détails.',
              },
              category: 'RIDE_REQUEST',
              'mutable-content': 1,
            },
          },
          data: {
            type: 'ride_request',
            rideId: event.params.rideId,
            driverId: afterData.driverId,
            fare: afterData.fare?.toString() || '0',
            pickupAddress: afterData.pickupAddress || '',
            destinationAddress: afterData.destinationAddress || '',
          },
        },
      };
      
      // Send the notification
      const response = await messaging.send(message);
      console.log('Push notification sent successfully:', response);
      
    } else if (beforeData?.status !== 'waiting' && 
               afterData?.status === 'waiting') {
      // Send notification to all online drivers of the same type
      console.log('New ride request created, notifying eligible drivers');
      
      const rideType = afterData.rideType;
      if (!rideType) {
        console.log('No ride type specified');
        return;
      }
      
      // Get all online drivers of the same type
      const driversSnapshot = await db.collection('Drivers')
        .where('isOnline', '==', true)
        .where('isAvailable', '!=', false)
        .where('driverType', '==', rideType)
        .where('rideInProgress', '==', false)
        .get();
      
      const eligibleDrivers = [];
      driversSnapshot.forEach(doc => {
        const driverData = doc.data();
        if (driverData.pushToken && 
            driverData.latitude && 
            driverData.longitude && 
            !driverData.currentRideId) {
          eligibleDrivers.push({
            id: doc.id,
            pushToken: driverData.pushToken,
            latitude: driverData.latitude,
            longitude: driverData.longitude,
          });
        }
      });
      
      console.log(`Found ${eligibleDrivers.length} eligible drivers`);
      
      // Send notification to the closest driver (simplified selection)
      if (eligibleDrivers.length > 0) {
        const selectedDriver = eligibleDrivers[0]; // For now, just pick the first one
        
        const message = {
          token: selectedDriver.pushToken,
          notification: {
            title: '🚗 Nouvelle course disponible!',
            body: 'Une nouvelle demande de course correspond à votre profil. Ouvrez l\'app pour voir les détails.',
          },
          data: {
            type: 'ride_request',
            rideId: event.params.rideId,
            driverId: selectedDriver.id,
            fare: afterData.fare?.toString() || '0',
            pickupAddress: afterData.pickupAddress || '',
            destinationAddress: afterData.destinationAddress || '',
          },
          android: {
            notification: {
              sound: 'default',
              channelId: 'ride-requests',
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
              vibrateTimings: [0, 250, 250, 250],
              icon: 'ic_launcher',
              color: '#FF8C00',
              largeIcon: 'ic_launcher',
              style: {
                type: 'bigtext',
                text: 'Une nouvelle demande de course correspond à votre profil. Ouvrez l\'app pour voir les détails.',
                summary: 'Nouvelle course disponible'
              }
            },
            data: {
              type: 'ride_request',
              rideId: event.params.rideId,
              driverId: selectedDriver.id,
              fare: afterData.fare?.toString() || '0',
              pickupAddress: afterData.pickupAddress || '',
              destinationAddress: afterData.destinationAddress || '',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                badge: 1,
                alert: {
                  title: '🚗 Nouvelle course disponible!',
                  body: 'Une nouvelle demande de course correspond à votre profil. Ouvrez l\'app pour voir les détails.',
                },
                category: 'RIDE_REQUEST',
                'mutable-content': 1,
              },
            },
            data: {
              type: 'ride_request',
              rideId: event.params.rideId,
              driverId: selectedDriver.id,
              fare: afterData.fare?.toString() || '0',
              pickupAddress: afterData.pickupAddress || '',
              destinationAddress: afterData.destinationAddress || '',
            },
          },
        };
        
        const response = await messaging.send(message);
        console.log('Push notification sent to selected driver:', response);
      }
    }
    
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
});

// Cloud Function to send approval notification when driver status is updated
exports.sendDriverApprovalNotification = onDocumentUpdated('Drivers/{driverId}', async (event) => {
  const db = getFirestore();
  const messaging = getMessaging();
  
  try {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    
    // Check if approval status changed
    if (beforeData?.approvalStatus !== 'approved' && 
        afterData?.approvalStatus === 'approved') {
      
      console.log('Driver approved:', event.params.driverId);
      
      const pushToken = afterData.pushToken;
      
      if (!pushToken) {
        console.log('Driver has no push token');
        return;
      }
      
      // Prepare approval notification message
      const message = {
        token: pushToken,
        notification: {
          title: '✅ Compte approuvé!',
          body: 'Félicitations! Votre compte chauffeur a été approuvé. Vous pouvez maintenant commencer à travailler.',
        },
        data: {
          type: 'driver_approval',
          driverId: event.params.driverId,
          status: 'approved',
        },
        android: {
          notification: {
            sound: 'default',
            channelId: 'driver-approval',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            vibrateTimings: [0, 250, 250, 250],
            icon: 'ic_launcher',
            color: '#4CAF50',
            largeIcon: 'ic_launcher',
            style: {
              type: 'bigtext',
              text: 'Félicitations! Votre compte chauffeur a été approuvé. Vous pouvez maintenant commencer à travailler.',
              summary: 'Compte approuvé'
            }
          },
          data: {
            type: 'driver_approval',
            driverId: event.params.driverId,
            status: 'approved',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              alert: {
                title: '✅ Compte approuvé!',
                body: 'Félicitations! Votre compte chauffeur a été approuvé. Vous pouvez maintenant commencer à travailler.',
              },
              category: 'DRIVER_APPROVAL',
              'mutable-content': 1,
            },
          },
          data: {
            type: 'driver_approval',
            driverId: event.params.driverId,
            status: 'approved',
          },
        },
      };
      
      // Send the notification
      const response = await messaging.send(message);
      console.log('Approval notification sent successfully:', response);
      
    } else if (beforeData?.approvalStatus !== 'rejected' && 
               afterData?.approvalStatus === 'rejected') {
      
      console.log('Driver rejected:', event.params.driverId);
      
      const pushToken = afterData.pushToken;
      
      if (!pushToken) {
        console.log('Driver has no push token');
        return;
      }
      
      // Prepare rejection notification message
      const message = {
        token: pushToken,
        notification: {
          title: '❌ Compte non approuvé',
          body: 'Votre demande de compte chauffeur n\'a pas été approuvée. Contactez le support pour plus d\'informations.',
        },
        data: {
          type: 'driver_approval',
          driverId: event.params.driverId,
          status: 'rejected',
        },
        android: {
          notification: {
            sound: 'default',
            channelId: 'driver-approval',
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            vibrateTimings: [0, 250, 250, 250],
            icon: 'ic_launcher',
            color: '#F44336',
            largeIcon: 'ic_launcher',
            style: {
              type: 'bigtext',
              text: 'Votre demande de compte chauffeur n\'a pas été approuvée. Contactez le support pour plus d\'informations.',
              summary: 'Compte non approuvé'
            }
          },
          data: {
            type: 'driver_approval',
            driverId: event.params.driverId,
            status: 'rejected',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              alert: {
                title: '❌ Compte non approuvé',
                body: 'Votre demande de compte chauffeur n\'a pas été approuvée. Contactez le support pour plus d\'informations.',
              },
              category: 'DRIVER_APPROVAL',
              'mutable-content': 1,
            },
          },
          data: {
            type: 'driver_approval',
            driverId: event.params.driverId,
            status: 'rejected',
          },
        },
      };
      
      // Send the notification
      const response = await messaging.send(message);
      console.log('Rejection notification sent successfully:', response);
    }
    
  } catch (error) {
    console.error('Error sending approval notification:', error);
  }
});

// Example function (uncomment and edit as needed)
// const { onRequest } = require("firebase-functions/https");
// const logger = require("firebase-functions/logger");
// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", { structuredData: true });
//   response.send("Hello from Firebase!");
// });
