# Background Countdown System for Caval Driver App

## Overview

The background countdown system ensures that the 15-second ride acceptance countdown continues working even when the app is in the background or when the user swipes out of the app. This prevents the countdown from freezing and ensures drivers can still accept or decline rides within the time limit.

## How It Works

### 1. App State Monitoring
- The app monitors when it goes to background/foreground using `AppState.addEventListener`
- When going to background: starts a background countdown task
- When coming to foreground: restores the countdown state from background

### 2. Background Task Implementation
- Uses `expo-task-manager` to define a background task (`COUNTDOWN_TASK_NAME`)
- Uses `expo-background-fetch` for periodic background execution
- Stores countdown state in AsyncStorage for persistence

### 3. Countdown State Management
- **Active Timer**: JavaScript `setInterval` when app is in foreground
- **Background Timer**: Background task updates countdown every second
- **State Persistence**: Countdown data stored in AsyncStorage with timestamps

## Key Components

### Background Task Definition
```javascript
const COUNTDOWN_TASK_NAME = 'countdown-timer-task';

TaskManager.defineTask(COUNTDOWN_TASK_NAME, async ({ data, error }) => {
  // Handles countdown updates in background
  // Updates AsyncStorage with remaining time
  // Marks countdown as expired when time runs out
});
```

### App State Handler
```javascript
useEffect(() => {
  const handleAppStateChange = (nextAppState) => {
    if (appState.match(/inactive|background/) && nextAppState === 'active') {
      // App came to foreground - restore countdown
      restoreCountdownFromBackground();
    } else if (nextAppState.match(/inactive|background/)) {
      // App going to background - start background countdown
      startBackgroundCountdown();
    }
    setAppState(nextAppState);
  };
  
  const subscription = AppState.addEventListener('change', handleAppStateChange);
  return () => subscription?.remove();
}, [appState, isModalVisible, currentRideRequest, timeLeft]);
```

### Background Countdown Start
```javascript
const startBackgroundCountdown = async () => {
  const countdownData = {
    timeLeft,
    rideId: currentRideRequest.id,
    startTime: Date.now(),
    totalDuration: 15000 // 15 seconds
  };
  
  // Store in AsyncStorage
  await AsyncStorage.setItem(`countdown_${currentRideRequest.id}`, JSON.stringify(countdownData));
  
  // Start background task
  await TaskManager.startTaskAsync(COUNTDOWN_TASK_NAME, { data: countdownData });
  
  // Register background fetch
  await BackgroundFetch.registerTaskAsync(COUNTDOWN_TASK_NAME, {
    minimumInterval: 1000,
    stopOnTerminate: false,
    startOnBoot: true,
  });
};
```

### Countdown Restoration
```javascript
const restoreCountdownFromBackground = async () => {
  // Check if countdown expired while in background
  const expiredCountdown = await AsyncStorage.getItem(`countdown_${currentRideRequest.id}_expired`);
  if (expiredCountdown) {
    setTimeLeft(0);
    declineRide();
    return;
  }
  
  // Restore countdown with remaining time
  const storedCountdown = await AsyncStorage.getItem(`countdown_${currentRideRequest.id}`);
  if (storedCountdown) {
    const countdownData = JSON.parse(storedCountdown);
    const elapsed = Date.now() - countdownData.startTime;
    const remainingTime = Math.max(0, Math.ceil((countdownData.totalDuration - elapsed) / 1000));
    
    if (remainingTime > 0) {
      setTimeLeft(remainingTime);
      startTimerWithTime(remainingTime);
    } else {
      setTimeLeft(0);
      declineRide();
    }
  }
};
```

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
    "expo-background-fetch": "^13.1.6"
  }
}
```

## Usage Flow

1. **Driver receives ride offer** → Modal appears with 15-second countdown
2. **App goes to background** → Background countdown task starts
3. **Background task runs** → Updates countdown every second in AsyncStorage
4. **App returns to foreground** → Countdown state restored from background
5. **Countdown continues** → Driver can still accept/decline within remaining time

## Benefits

- ✅ Countdown never freezes when app is backgrounded
- ✅ Accurate time tracking even during app switches
- ✅ Seamless user experience
- ✅ Reliable ride acceptance/decline functionality
- ✅ Battery-efficient background processing

## Troubleshooting

### Common Issues

1. **Countdown still freezes**
   - Check if background fetch is enabled in device settings
   - Verify all required permissions are granted
   - Check console logs for background task errors

2. **Background task not starting**
   - Ensure `expo-background-fetch` is properly installed
   - Check if device supports background fetch
   - Verify task registration in console logs

3. **Countdown restoration issues**
   - Check AsyncStorage for stored countdown data
   - Verify app state change detection is working
   - Check for errors in `restoreCountdownFromBackground`

### Debug Logging

The system includes comprehensive logging:
- App state changes
- Background task start/stop
- Countdown updates
- AsyncStorage operations
- Error conditions

Check the console for these logs to diagnose any issues.

## Testing

To test the background countdown:

1. Start the app and go online
2. Wait for a ride offer
3. When modal appears, swipe out of the app (go to background)
4. Wait a few seconds
5. Return to the app
6. Verify countdown continued and shows correct remaining time

## Future Enhancements

- Push notifications when countdown expires in background
- More granular background task scheduling
- Battery optimization improvements
- Cross-platform background task reliability improvements 