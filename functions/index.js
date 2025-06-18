const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

exports.assignClosestDriver = functions.firestore
  .document('rideRequests/{rideId}')
  .onWrite(async (change, context) => {
    const ride = change.after.exists ? change.after.data() : null;
    if (!ride || ride.status !== 'waiting') return;

    const pickupLat = ride.pickupLat;
    const pickupLng = ride.pickupLng;
    const declinedDrivers = ride.declinedDrivers || [];
    const rideType = ride.rideType;

    console.log(`Processing ride request ${context.params.rideId}:`, {
      rideType,
      pickupLat,
      pickupLng,
      declinedDrivers
    });

    // Fetch all available drivers with enhanced filtering
    const driversSnapshot = await admin.firestore().collection('Drivers')
      .where('isOnline', '==', true)
      .get();
    
    let drivers = [];
    driversSnapshot.forEach(doc => {
      const data = doc.data();
      
      // Enhanced driver filtering
      const hasValidLocation = data.latitude && data.longitude;
      const isAvailable = data.isAvailable !== false; // Default to true if not set
      const noRideInProgress = !data.rideInProgress;
      const noCurrentRide = !data.currentRideId;
      const matchesRideType = data.driverType === rideType;
      const notDeclined = !declinedDrivers.includes(doc.id);
      
      console.log(`Driver ${doc.id} check:`, {
        isOnline: data.isOnline,
        isAvailable,
        hasLocation: hasValidLocation,
        noRideInProgress,
        noCurrentRide,
        matchesType: matchesRideType,
        notDeclined,
        driverType: data.driverType,
        rideType
      });
      
      if (hasValidLocation && isAvailable && noRideInProgress && noCurrentRide && matchesRideType && notDeclined) {
        const distance = haversineDistance(pickupLat, pickupLng, data.latitude, data.longitude);
        drivers.push({ 
          id: doc.id, 
          distance,
          rideCount: data.rideCount || 0,
          lastRideTime: data.lastRideTime
        });
        console.log(`✓ Driver ${doc.id} added (distance: ${distance.toFixed(2)}km)`);
      } else {
        console.log(`✗ Driver ${doc.id} excluded`);
      }
    });

    console.log(`Found ${drivers.length} eligible drivers for ride type: ${rideType}`);

    // Sort drivers by distance
    drivers.sort((a, b) => a.distance - b.distance);

    if (drivers.length > 0) {
      const selectedDriver = drivers[0];
      console.log(`Assigning ride to driver ${selectedDriver.id} (distance: ${selectedDriver.distance.toFixed(2)}km)`);
      
      // Assign to the closest driver
      await admin.firestore().collection('rideRequests').doc(context.params.rideId).update({
        assignedDriver: selectedDriver.id,
        status: 'waiting',
        assignedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      console.log('No available drivers found, will retry in 10 seconds');
      // No available drivers, reset after delay
      setTimeout(async () => {
        try {
          await admin.firestore().collection('rideRequests').doc(context.params.rideId).update({
            assignedDriver: null,
            status: 'waiting',
            declinedDrivers: []
          });
          console.log(`Reset ride ${context.params.rideId} for retry`);
        } catch (error) {
          console.error('Error resetting ride for retry:', error);
        }
      }, 10000); // 10 seconds
    }
  }); 