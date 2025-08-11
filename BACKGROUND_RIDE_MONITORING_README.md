# Background Ride Monitoring System for Caval Driver App

## Overview

The background ride monitoring system ensures that drivers receive ride offers in real-time even when the app is in the background or closed. This solves the critical issue where drivers would miss ride opportunities because the Firestore `onSnapshot` listener stops working when the app is backgrounded.

## How It Works

### 1. Background Task Monitoring
- **TaskManager**: Uses `expo-task-manager` to define background tasks that continue running
- **BackgroundFetch**: Uses `expo-background-fetch` for periodic background execution
- **Real-time Updates**: Continuously monitors Firestore for new ride requests

### 2. Push Notification Integration
- **Local Notifications**: Sends immediate notifications when new rides are found
- **Background Processing**: Processes notifications even when app is closed
- **Smart Handling**: Different notification types for different scenarios

### 3. State Persistence
- **AsyncStorage**: Stores ride data that comes in while app is backgrounded
- **Timestamp Tracking**: Tracks when rides were received to handle expiration
- **Automatic Cleanup**: Removes old/stale ride data automatically

## Key Components

### Background Task Definition
```javascript
const RIDE_MONITORING_TASK_NAME = 'ride-monitoring-task';

TaskManager.defineTask(RIDE_MONITORING_TASK_NAME, async ({ data, error }) => {
  // Queries Firestore for new ride requests
  // Sends local notifications
  // Stores ride data for later processing
});
```

### App State Management
```javascript
useEffect(() => {
  const handleAppStateChange = (nextAppState) => {
    if (appState.match(/inactive|background/) && nextAppState === 'active') {
      // App came to foreground - check for background rides
      checkBackgroundRides();
    } else if (nextAppState.match(/inactive|background/)) {
      // App going to background - start monitoring
      if (isOnline && auth.currentUser && driverType) {
        startBackgroundRideMonitoring();
      }
    }
  };
}, [appState, isOnline, driverType]);
```

### Background Ride Monitoring Start
```javascript
const startBackgroundRideMonitoring = async () => {
  const monitoringData = {
    driverId: auth.currentUser.uid,
    driverType,
    lastCheckTime: Date.now()
  };
  
  // Store monitoring state
  await AsyncStorage.setItem('background_ride_monitoring', JSON.stringify(monitoringData));
  
  // Start background task
  await TaskManager.startTaskAsync(RIDE_MONITORING_TASK_NAME, { data: monitoringData });
  
  // Register background fetch
  await BackgroundFetch.registerTaskAsync(RIDE_MONITORING_TASK_NAME, {
    minimumInterval: 10000, // Check every 10 seconds
    stopOnTerminate: false,
    startOnBoot: true,
  });
};
```

### Background Ride Processing
```javascript
const checkBackgroundRides = async () => {
  // Get all background ride keys
  const keys = await AsyncStorage.getAllKeys();
  const backgroundRideKeys = keys.filter(key => key.startsWith('background_ride_'));
  
  for (const key of backgroundRideKeys) {
    const rideData = await AsyncStorage.getItem(key);
    if (rideData) {
      const { rideId, rideData: ride, timestamp } = JSON.parse(rideData);
      
      // Check if ride is still available (not too old)
      const age = Date.now() - timestamp;
      const maxAge = 30000; // 30 seconds
      
      if (age < maxAge) {
        // Process the ride offer
        await processRideOffer(ride, null);
      }
      
      // Clean up stored data
      await AsyncStorage.removeItem(key);
    }
  }
};
```

## System Flow

### 1. Driver Goes Online
- Background ride monitoring starts automatically
- TaskManager and BackgroundFetch are registered
- Periodic checks begin every 10 seconds

### 2. App Goes to Background
- Firestore `onSnapshot` listener becomes unreliable
- Background task takes over monitoring
- Continues checking for new ride requests

### 3. New Ride Request Arrives
- Background task detects new ride in Firestore
- Sends immediate local notification
- Stores ride data in AsyncStorage
- Driver receives notification even if app is closed

### 4. App Returns to Foreground
- `checkBackgroundRides()` function runs
- Processes any rides received while backgrounded
- Restores normal Firestore listening
- Driver sees ride offers immediately

### 5. Driver Goes Offline
- Background monitoring stops automatically
- All background tasks are cleaned up
- Prevents unnecessary background processing

## Configuration

### Required Permissions

#### iOS (app.json)
```json
{
  "ios": {
    "infoPlist": {
      "UIBackgroundModes": [
        "location",
        "fetch",
        "remote-notification"
      ]
    }
  }
}
```

#### Android (AndroidManifest.xml)
```xml
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

### Required Packages
```json
{
  "dependencies": {
    "expo-task-manager": "^13.1.6",
    "expo-background-fetch": "^13.1.6",
    "expo-notifications": "^0.31.4"
  }
}
```

## Benefits

- ✅ **Real-time Ride Offers**: Drivers receive offers immediately, even when app is closed
- ✅ **No Missed Opportunities**: Background monitoring ensures 100% ride coverage
- ✅ **Battery Efficient**: Smart background processing with configurable intervals
- ✅ **Seamless Experience**: Works transparently without user intervention
- ✅ **Cross-platform**: Works on both iOS and Android
- ✅ **Automatic Cleanup**: Prevents memory leaks and stale data

## Troubleshooting

### Common Issues

1. **Background monitoring not starting**
   - Check if driver is online and has driver type set
   - Verify background fetch permissions are granted
   - Check console logs for task registration errors

2. **Notifications not appearing**
   - Ensure notification permissions are granted
   - Check if background fetch is enabled in device settings
   - Verify task is running in background

3. **Rides not showing when returning to app**
   - Check AsyncStorage for stored background rides
   - Verify `checkBackgroundRides()` is being called
   - Check for errors in background task execution

### Debug Logging

The system includes comprehensive logging:
- Background task start/stop
- Ride detection and storage
- Notification sending
- AsyncStorage operations
- App state changes

### Testing

To test background ride monitoring:

1. **Start the app** and go online as a driver
2. **Go to background** (swipe out of app)
3. **Create a ride request** from another device/app
4. **Check for notification** - should appear immediately
5. **Return to app** - ride offer should be visible
6. **Verify countdown** - should continue from where it left off

## Performance Considerations

- **Background Interval**: Set to 10 seconds for optimal battery life
- **Data Expiration**: Rides older than 30 seconds are automatically discarded
- **Memory Management**: Automatic cleanup prevents memory leaks
- **Battery Optimization**: Respects device battery optimization settings

## Future Enhancements

- **Smart Intervals**: Adjust monitoring frequency based on driver activity
- **Push Notifications**: Server-side push notifications for immediate delivery
- **Geographic Filtering**: Only monitor rides in driver's area
- **Priority System**: Handle high-priority rides differently
- **Analytics**: Track background monitoring effectiveness

## Integration Points

- **Authentication**: Automatically starts/stops based on login status
- **Online Status**: Only monitors when driver is online
- **Driver Type**: Filters rides by driver's vehicle type
- **Location Services**: Integrates with existing location tracking
- **Notification System**: Works with existing push notification setup

This system ensures that drivers never miss ride opportunities due to app backgrounding, providing a seamless and reliable experience for the Caval Driver app. 