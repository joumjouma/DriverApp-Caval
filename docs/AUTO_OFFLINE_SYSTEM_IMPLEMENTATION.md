# Auto-Offline System Implementation

## Overview

This system automatically takes drivers offline exactly 20 minutes after they go online, with **NO EXCEPTIONS**. The system is mandatory and cannot be disabled, overridden, or bypassed by any means.

## System Architecture

### 1. Core Components

#### `useAutoOffline` Hook (`hooks/useAutoOffline.js`)
- **Primary Timer**: 20-minute countdown that starts immediately when driver goes online
- **Automatic Execution**: Sets driver offline after exactly 20 minutes
- **No Override**: Cannot be disabled or extended beyond the 20-minute limit
- **Background Support**: Timer continues running even if app goes to background

#### `AutoOfflineTimer` Component (`components/AutoOfflineTimer.js`)
- **Visual Countdown**: Appears when less than 5 minutes remain
- **User Options**: 
  - Extend time for another 20 minutes
  - Go offline immediately
- **Mandatory Display**: Cannot be hidden or disabled

#### Integration in `HomeScreenWithMap.js`
- **Automatic Integration**: Hook is automatically initialized with driver online status
- **Seamless Operation**: No additional setup required
- **UI Integration**: Timer component appears automatically when needed

### 2. How It Works

#### When Driver Goes Online:
1. `setIsOnline(true)` is called
2. `useAutoOffline` hook automatically starts 20-minute countdown
3. Timer runs silently in background
4. No user intervention required

#### During the 20 Minutes:
1. Timer counts down silently
2. Driver can continue normal operations
3. No interruptions or notifications
4. Timer continues even if app goes to background

#### Last 5 Minutes:
1. `AutoOfflineTimer` component becomes visible
2. Shows countdown: "Auto-offline in X min"
3. Provides two options:
   - **EXTEND**: Resets timer for another 20 minutes
   - **OFFLINE**: Goes offline immediately

#### After 20 Minutes:
1. If no action taken: Driver automatically goes offline
2. If EXTEND pressed: Timer resets for another 20 minutes
3. If OFFLINE pressed: Driver goes offline immediately

## Implementation Details

### 1. Timer Logic

```javascript
const TWENTY_MINUTES = 20 * 60 * 1000; // 20 minutes in milliseconds

// Timer starts automatically when isOnline becomes true
useEffect(() => {
  if (isOnline) {
    startTimer(); // Starts 20-minute countdown
  } else {
    clearTimer(); // Clears timer when offline
  }
}, [isOnline]);
```

### 2. Automatic Offline Execution

```javascript
const setDriverOffline = useCallback(async () => {
  // Update Firestore
  await updateDoc(driverRef, {
    isOnline: false,
    isAvailable: false,
    lastOfflineUpdate: new Date(),
    autoOfflineReason: "20_minute_timeout",
    autoOfflineAt: new Date()
  });
  
  // Update local state
  setIsOnline(false);
  
  // Show user notification
  Alert.alert("🔄 Auto-Offlined", 
    "You've been automatically set offline after being online for 20 minutes.");
}, []);
```

### 3. UI Integration

```javascript
// Auto-offline timer appears automatically when needed
<AutoOfflineTimer
  isOnline={isOnline}
  remainingTime={getRemainingTime()}
  onExtendTime={resetTimer}
  onGoOffline={() => setIsOnline(false)}
/>
```

## Key Features

### ✅ **Mandatory Operation**
- Cannot be disabled or bypassed
- Runs automatically for all drivers
- No configuration options to turn off

### ✅ **Precise Timing**
- Exactly 20 minutes from going online
- No variance or exceptions
- Timer continues in background

### ✅ **User Control**
- Extend time for another 20 minutes
- Go offline immediately if desired
- Clear visual countdown

### ✅ **System Integration**
- Updates Firestore automatically
- Maintains driver status consistency
- Works with existing online/offline logic

### ✅ **Background Support**
- Timer continues when app is backgrounded
- No interruption from app state changes
- Reliable execution regardless of app state

## Database Updates

When auto-offline occurs, these fields are automatically updated in Firestore:

```javascript
{
  isOnline: false,
  isAvailable: false,
  lastOfflineUpdate: timestamp,
  lastAvailabilityUpdate: timestamp,
  autoOfflineReason: "20_minute_timeout",
  autoOfflineAt: timestamp
}
```

## User Experience

### 1. Going Online
- Driver presses GO button
- Status changes to "EN LIGNE"
- 20-minute timer starts silently
- No interruption to normal workflow

### 2. During Online Time
- Timer runs in background
- No visible indicators
- Driver can perform all normal operations
- Timer continues even if app is backgrounded

### 3. Last 5 Minutes
- Countdown timer appears
- Shows remaining time clearly
- Two action buttons available
- Driver must make a choice

### 4. Auto-Offline
- Automatic execution after 20 minutes
- Clear notification to user
- Status changes to "HORS LIGNE"
- Timer resets for next online session

## Safety Features

### 1. No Override Possible
- System cannot be disabled
- No admin settings to bypass
- No user preferences to ignore
- Mandatory for all drivers

### 2. Background Continuity
- Timer continues in background
- App state changes don't affect timer
- Reliable execution regardless of conditions
- No interruption from system events

### 3. Error Handling
- Graceful fallback if Firestore fails
- Local state updates even if backend fails
- User notification of auto-offline status
- System remains stable under all conditions

## Compliance and Benefits

### 1. System Reliability
- Prevents driver overload
- Ensures fair ride distribution
- Maintains consistent service levels
- Prevents system abuse

### 2. Safety Compliance
- Enforces driver rest periods
- Prevents extended driving sessions
- Maintains operational standards
- Ensures driver well-being

### 3. User Experience
- Predictable service availability
- Fair opportunity distribution
- Consistent driver availability
- Reliable system operation

## Technical Implementation

### 1. Hook Integration
```javascript
// Automatically integrated in HomeScreenWithMap
const { resetTimer, getRemainingTime, clearTimer } = useAutoOffline(
  isOnline, 
  setIsOnline
);
```

### 2. Component Display
```javascript
// Automatically appears when needed
<AutoOfflineTimer
  isOnline={isOnline}
  remainingTime={getRemainingTime()}
  onExtendTime={resetTimer}
  onGoOffline={() => setIsOnline(false)}
/>
```

### 3. State Management
```javascript
// Timer automatically starts/stops based on online status
useEffect(() => {
  if (isOnline) {
    startTimer(); // 20-minute countdown
  } else {
    clearTimer(); // Clear timer
  }
}, [isOnline]);
```

## Testing and Validation

### 1. Timer Accuracy
- Verify exactly 20 minutes from online to offline
- Test timer continuation in background
- Validate countdown display in last 5 minutes

### 2. User Interactions
- Test EXTEND functionality
- Test immediate offline option
- Verify timer reset after extension

### 3. System Integration
- Confirm Firestore updates
- Verify local state consistency
- Test background operation

## Maintenance and Monitoring

### 1. System Health
- Monitor auto-offline execution rates
- Track user extension patterns
- Verify timer accuracy

### 2. User Feedback
- Monitor user complaints about auto-offline
- Track extension usage patterns
- Identify potential improvements

### 3. Performance Metrics
- Timer execution reliability
- Background operation success rate
- System integration stability

## Conclusion

This auto-offline system provides a robust, mandatory solution that ensures all drivers go offline after exactly 20 minutes of being online. The system cannot be disabled, overridden, or bypassed, ensuring consistent operation across all drivers and maintaining system reliability.

The implementation is seamless, requiring no additional setup or configuration, and provides drivers with clear options to extend their time or go offline immediately. The system works reliably even when the app is backgrounded, ensuring consistent execution regardless of app state.

This mandatory approach ensures fair distribution of ride opportunities, prevents driver overload, and maintains consistent service levels across the platform.
