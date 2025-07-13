# OnlineDriver Firebase Document System

This document explains the OnlineDriver system that tracks and displays information about currently online drivers in the Caval driver application.

## Overview

The OnlineDriver system consists of:
1. **Cloud Functions** - Automatically maintain the OnlineDriver document
2. **Client Service** - Fetch and subscribe to online driver data
3. **UI Components** - Display online driver statistics and information

## Firebase Document Structure

The `OnlineDriver/current` document contains:

```javascript
{
  totalOnlineDrivers: number,        // Total number of online drivers
  totalAvailableDrivers: number,     // Number of available drivers
  driversByType: {                   // Breakdown by driver type
    [driverType]: {
      count: number,                 // Total drivers of this type
      available: number,             // Available drivers of this type
      drivers: []                    // Array of driver IDs
    }
  },
  onlineDrivers: [                   // Array of online driver objects
    {
      id: string,                    // Driver ID
      firstName: string,             // Driver's first name
      lastName: string,              // Driver's last name
      phoneNumber: string,           // Driver's phone number
      driverType: string,            // Type of driver (e.g., "car", "motorcycle")
      rating: number,                // Driver's rating
      rideCount: number,             // Total rides completed
      isAvailable: boolean,          // Whether driver is available for rides
      latitude: number,              // Current latitude
      longitude: number,             // Current longitude
      lastLocationUpdate: string,    // Last location update timestamp
      lastOnlineUpdate: string,      // Last online status update
      city: string,                  // Driver's city
      vehicleType: string,           // Type of vehicle
      carMake: string,               // Car make (if applicable)
      carModel: string,              // Car model (if applicable)
      carColor: string,              // Car color (if applicable)
      plaqueImmatriculation: string // License plate number
    }
  ],
  lastUpdated: Date,                 // Last document update timestamp
  updatedBy: string,                 // ID of driver who triggered the update
  status: string                     // "active" or "inactive"
}
```

## Cloud Functions

### 1. maintainOnlineDriverDocument

**Trigger**: When any driver document in the `Drivers` collection is updated

**Purpose**: Maintains the aggregated OnlineDriver document with current online driver information

**Functionality**:
- Monitors changes to driver online status
- Aggregates all online drivers
- Groups drivers by type
- Updates the OnlineDriver document with current statistics

### 2. cleanupOfflineDrivers

**Trigger**: When the OnlineDriver document is updated

**Purpose**: Removes drivers who haven't updated their status in 5 minutes

**Functionality**:
- Checks last online update timestamps
- Removes drivers inactive for more than 5 minutes
- Recalculates totals after cleanup

## Client-Side Usage

### Import the Service

```javascript
import OnlineDriverService from '../services/OnlineDriverService';
```

### Get Online Driver Statistics

```javascript
// Get complete online driver data
const stats = await OnlineDriverService.getOnlineDriverStats();

// Get total online drivers count
const totalOnline = await OnlineDriverService.getTotalOnlineDriversCount();

// Get total available drivers count
const totalAvailable = await OnlineDriverService.getTotalAvailableDriversCount();

// Get available drivers count by type
const carDrivers = await OnlineDriverService.getAvailableDriversCountByType('car');

// Get online drivers by type
const motorcycleDrivers = await OnlineDriverService.getOnlineDriversByType('motorcycle');

// Get driver statistics summary
const summary = await OnlineDriverService.getDriverStatisticsSummary();
```

### Real-time Updates

```javascript
// Subscribe to real-time updates
const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates((data) => {
  console.log('Online driver data updated:', data);
  // Update your UI with the new data
});

// Don't forget to unsubscribe when component unmounts
useEffect(() => {
  return () => unsubscribe();
}, []);
```

## UI Components

### OnlineDriverStats Component

A React component that displays online driver statistics:

```javascript
import OnlineDriverStats from '../components/OnlineDriverStats';

// Use in your screen
<OnlineDriverStats />
```

**Features**:
- Real-time updates
- Pull-to-refresh
- Error handling
- Loading states
- Driver type breakdown
- Individual driver information

### AdminDashboard Component

An admin-focused dashboard component:

```javascript
import AdminDashboard from '../components/AdminDashboard';

// Use in admin screen
<AdminDashboard />
```

**Features**:
- Summary cards with key metrics
- Driver type breakdown with progress bars
- Recent online drivers list
- Manual refresh capability
- Detailed driver information

## Integration with Existing Code

The OnlineDriver system integrates seamlessly with the existing driver management system:

1. **Automatic Updates**: When drivers go online/offline, the OnlineDriver document is automatically updated
2. **Real-time Sync**: All components receive real-time updates when driver status changes
3. **No Breaking Changes**: Existing driver functionality remains unchanged

## Deployment

### Deploy Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

### Update Client Code

The client-side code is already integrated and will work once the Cloud Functions are deployed.

## Monitoring and Debugging

### Cloud Function Logs

Check Firebase Console > Functions > Logs to monitor:
- Driver status changes
- Document updates
- Cleanup operations
- Any errors

### Client-Side Debugging

Add console logs to track data flow:

```javascript
// In your component
useEffect(() => {
  const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates((data) => {
    console.log('OnlineDriver update:', data);
    setStats(data);
  });
  
  return unsubscribe;
}, []);
```

## Performance Considerations

1. **Document Size**: The OnlineDriver document contains driver information but excludes sensitive data
2. **Update Frequency**: Updates only occur when driver status changes, not continuously
3. **Cleanup**: Automatic cleanup prevents stale data accumulation
4. **Real-time**: Uses Firestore's real-time listeners for immediate updates

## Security

- Only aggregated, non-sensitive driver information is stored in the OnlineDriver document
- Individual driver documents remain secure in the Drivers collection
- Cloud Functions run with appropriate Firebase Admin SDK permissions

## Troubleshooting

### Common Issues

1. **OnlineDriver document not found**
   - Check if Cloud Functions are deployed
   - Verify driver documents have `isOnline` field

2. **Real-time updates not working**
   - Check network connectivity
   - Verify Firestore rules allow reading OnlineDriver collection

3. **Stale data**
   - Cloud Functions automatically clean up offline drivers
   - Manual refresh available in UI components

### Debug Steps

1. Check Firebase Console for Cloud Function logs
2. Verify driver documents have correct `isOnline` values
3. Test with a single driver going online/offline
4. Check client-side console for errors

## Future Enhancements

Potential improvements:
- Geographic clustering of drivers
- Driver availability predictions
- Performance analytics
- Advanced filtering options
- Export functionality for admin users 