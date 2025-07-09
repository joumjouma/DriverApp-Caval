// Utility functions for calculating distances between coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (value) => {
  return (value * Math.PI) / 180;
};

// Driver class to store driver information
class Driver {
  constructor(id, location, rideCount = 0, lastRideTime = null, isOnline = true) {
    this.id = id;
    this.location = location;
    this.rideCount = rideCount;
    this.lastRideTime = lastRideTime;
    this.isOnline = isOnline;
  }
}

// Main distribution algorithm
const distributeRideRequest = (rideRequest, availableDrivers) => {
  if (!availableDrivers || availableDrivers.length === 0) {
    console.log("No available drivers");
    return null;
  }

  // Filter only online drivers
  const onlineDrivers = availableDrivers.filter(driver => driver.isOnline);
  
  console.log(`[DISTRIBUTION] Number of online drivers: ${onlineDrivers.length}`);

  if (onlineDrivers.length === 0) {
    console.log("No online drivers");
    return null;
  }

  // Always select the closest driver to the pickup point
  let closestDriver = null;
  let minDistance = Infinity;
  onlineDrivers.forEach(driver => {
    const distance = calculateDistance(
      rideRequest.pickupLat,
      rideRequest.pickupLng,
      driver.location.latitude,
      driver.location.longitude
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestDriver = driver;
    }
  });
  console.log(`[DISTRIBUTION] Closest driver: ${closestDriver?.id}, Distance: ${minDistance.toFixed(2)} km`);
  return closestDriver;
};

// Function to update driver statistics after a ride
const updateDriverStats = (driverId, drivers) => {
  return drivers.map(driver => {
    if (driver.id === driverId) {
      return new Driver(
        driver.id,
        driver.location,
        driver.rideCount + 1,
        new Date(),
        driver.isOnline
      );
    }
    return driver;
  });
};

module.exports = {
  distributeRideRequest,
  updateDriverStats,
  Driver
}; 