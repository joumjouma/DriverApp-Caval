# Online Driver Timer System

## Overview

This system automatically tracks how long each driver has been online in the OnlineDriver collection. When a driver goes online, a timer starts counting their online duration in real-time.

## Features

### 🕐 Real-Time Timer
- **Automatic Start**: Timer starts immediately when driver goes online
- **Real-Time Updates**: Duration updates every second on the client
- **Persistent Storage**: Duration stored in Firestore and updated every minute
- **Visual Indicators**: Color-coded status based on online duration

### 📊 Duration Status Levels
- **🟢 New (0-5 min)**: Green indicator, "time-outline" icon
- **🟠 Active (5-15 min)**: Orange indicator, "time" icon  
- **🔴 Extended (15-30 min)**: Red indicator, "warning" icon
- **🟣 Long Session (30+ min)**: Purple indicator, "alert-circle" icon

### 🔄 Auto-Refresh System
- **Cloud Function Updates**: Updates duration every minute via scheduled function
- **Real-Time Subscriptions**: Client receives live updates via Firestore listeners
- **Manual Refresh**: Users can manually refresh data by tapping timer

## System Architecture

### 1. Cloud Functions

#### `updateOnlineDrivers`
- **Trigger**: When any driver document is updated
- **Purpose**: Sets `onlineStartTime` when driver goes online
- **Updates**: OnlineDriver/summary document with duration data

#### `maintainOnlineDriverDocument`
- **Trigger**: When driver online status changes
- **Purpose**: Tracks driver online/offline events
- **Updates**: OnlineDriver/current document with status changes

#### `updateOnlineDuration` (NEW)
- **Trigger**: Every minute via scheduled function
- **Purpose**: Updates online duration for all online drivers
- **Updates**: Both individual driver documents and summary document

### 2. Client Components

#### `OnlineDurationTimer`
- **Purpose**: Displays individual driver's online duration
- **Features**: Real-time countdown, status indicators, refresh capability
- **Usage**: Can be embedded in any screen showing driver information

#### `OnlineDriversList`
- **Purpose**: Lists all online drivers with their duration
- **Features**: Real-time updates, pull-to-refresh, driver details
- **Usage**: Main screen for viewing all online drivers

### 3. Service Layer

#### `OnlineDriverService`
- **New Methods**:
  - `getDriverOnlineDuration(driverId)`: Get specific driver's duration
  - `getOnlineDriversWithDuration()`: Get all drivers with duration
  - `formatDuration(seconds)`: Format seconds to human-readable
  - `subscribeToOnlineDurationUpdates(callback)`: Real-time subscription

## Database Schema

### Drivers Collection
```javascript
{
  // ... existing fields
  onlineStartTime: Timestamp,    // When driver went online
  onlineDuration: number,        // Current online duration in seconds
  lastOnlineUpdate: Timestamp    // Last duration update
}
```

### OnlineDriver Collection
#### `summary` Document
```javascript
{
  count: number,                 // Total online drivers
  drivers: [                     // Array of online drivers
    {
      id: string,
      firstName: string,
      lastName: string,
      // ... other driver fields
      onlineStartTime: Timestamp,
      onlineDuration: number,    // Duration in seconds
      lastOnlineUpdate: Timestamp
    }
  ],
  updatedAt: Timestamp,
  lastDriverStatusChange: Timestamp,
  lastDurationUpdate: Timestamp
}
```

#### `current` Document
```javascript
{
  lastUpdated: Timestamp,
  status: 'active' | 'inactive',
  lastDriverOnline: Timestamp,
  lastDriverOffline: Timestamp,
  driverId: string
}
```

## Implementation Details

### Timer Logic
1. **Start**: When `isOnline` changes from `false` to `true`
2. **Update**: Every minute via cloud function + every second on client
3. **Stop**: When `isOnline` changes to `false`

### Real-Time Updates
- **Client**: Updates every second for smooth countdown
- **Server**: Updates every minute for persistence
- **Sync**: Client receives server updates and adjusts local timer

### Error Handling
- **Graceful Degradation**: Shows "Offline" if duration unavailable
- **Retry Logic**: Manual refresh button for data recovery
- **Fallback Values**: Defaults to 0 if data missing

## Usage Examples

### Basic Timer Display
```javascript
import OnlineDurationTimer from '../components/OnlineDurationTimer';

<OnlineDurationTimer driverId="driver123" />
```

### Detailed Timer with Status
```javascript
<OnlineDurationTimer 
  driverId="driver123" 
  showDetails={true} 
/>
```

### Complete Drivers List
```javascript
import OnlineDriversList from '../components/OnlineDriversList';

<OnlineDriversList 
  showDetails={true}
  onDriverPress={(driver) => console.log(driver)}
/>
```

### Service Usage
```javascript
import OnlineDriverService from '../services/OnlineDriverService';

// Get specific driver duration
const duration = await OnlineDriverService.getDriverOnlineDuration('driver123');

// Subscribe to real-time updates
const unsubscribe = OnlineDriverService.subscribeToOnlineDurationUpdates((drivers) => {
  console.log('Updated drivers:', drivers);
});

// Format duration
const formatted = OnlineDriverService.formatDuration(3661); // "1h 1m 1s"
```

## Deployment

### Cloud Functions
```bash
cd functions
npm run deploy
```

### Client App
```bash
npm start
# or
expo start
```

## Monitoring

### Cloud Function Logs
- `updateOnlineDrivers`: Driver status changes
- `maintainOnlineDriverDocument`: Online/offline events
- `updateOnlineDuration`: Scheduled duration updates

### Client Logs
- Timer start/stop events
- Duration updates
- Error handling

## Performance Considerations

### Cloud Functions
- **Memory**: 256MB for duration updates, 128MB for status tracking
- **Timeout**: 60 seconds for duration updates, 30 seconds for status
- **Frequency**: Duration updates every minute, status updates on change

### Client
- **Updates**: Every second for smooth countdown
- **Subscriptions**: Real-time Firestore listeners
- **Memory**: Efficient state management with cleanup

## Future Enhancements

### Planned Features
- **Duration Analytics**: Charts showing online patterns
- **Notifications**: Alerts for long online sessions
- **Break Reminders**: Suggest breaks after extended periods
- **Performance Metrics**: Driver efficiency based on online time

### Potential Optimizations
- **Batch Updates**: Group multiple driver updates
- **Caching**: Client-side duration caching
- **Compression**: Optimize data transfer
- **Background Sync**: Offline duration tracking

## Troubleshooting

### Common Issues

#### Timer Not Starting
- Check if `onlineStartTime` is set in driver document
- Verify cloud function execution logs
- Ensure driver `isOnline` status is correct

#### Duration Not Updating
- Check scheduled function execution
- Verify Firestore rules allow updates
- Check client subscription setup

#### Performance Issues
- Reduce update frequency if needed
- Implement client-side caching
- Monitor cloud function execution times

### Debug Commands
```javascript
// Check driver status
console.log('Driver data:', driverData);

// Verify timer state
console.log('Online duration:', onlineDuration);

// Check subscription
console.log('Subscription active:', !!unsubscribe);
```

## Support

For issues or questions about the Online Driver Timer System:
1. Check cloud function logs in Firebase Console
2. Verify client-side console logs
3. Test with simple driver status changes
4. Review Firestore security rules
