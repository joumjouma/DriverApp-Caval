# Client-Side Auto-Offline System

This system automatically sets drivers offline after 20 minutes of being online, implemented entirely on the client side using React hooks and timers.

## How It Works

### 1. Simple Timer Logic
- **When driver goes online**: 20-minute timer starts
- **After 20 minutes**: Driver is automatically set offline
- **No server-side functions**: Everything runs in the app

### 2. User Experience
- **Timer starts silently**: No interruption when going online
- **Last 5 minutes**: Timer becomes visible with options
- **Options**: Extend time or go offline immediately
- **Automatic**: Goes offline if no action taken

## Implementation

### 1. Hook: `useAutoOffline`

```javascript
import { useAutoOffline } from '../hooks/useAutoOffline';

const MyComponent = () => {
  const [isOnline, setIsOnline] = useState(false);
  
  const { resetTimer, getRemainingTime, clearTimer } = useAutoOffline(
    isOnline, 
    setIsOnline
  );

  // Timer automatically starts when isOnline becomes true
  // Timer automatically clears when isOnline becomes false
};
```

**Features:**
- Automatically starts 20-minute timer when driver goes online
- Clears timer when driver goes offline
- Provides functions to reset timer or get remaining time
- Updates Firestore when auto-offline occurs

### 2. Component: `AutoOfflineTimer`

```javascript
import AutoOfflineTimer from '../components/AutoOfflineTimer';

<AutoOfflineTimer
  isOnline={isOnline}
  remainingTime={getRemainingTime()}
  onExtendTime={resetTimer}
  onGoOffline={() => setIsOnline(false)}
/>
```

**Features:**
- Shows countdown when less than 5 minutes remaining
- Extend button: Resets timer for another 20 minutes
- Offline button: Goes offline immediately
- Beautiful UI with icons and colors

## Usage Example

```javascript
import React, { useState } from 'react';
import { useAutoOffline } from '../hooks/useAutoOffline';
import AutoOfflineTimer from '../components/AutoOfflineTimer';

const HomeScreen = () => {
  const [isOnline, setIsOnline] = useState(false);
  
  // Auto-offline hook
  const { resetTimer, getRemainingTime } = useAutoOffline(
    isOnline, 
    setIsOnline
  );

  // Handle going online
  const handleGoOnline = () => {
    setIsOnline(true);
    // Timer automatically starts
  };

  // Handle going offline
  const handleGoOffline = () => {
    setIsOnline(false);
    // Timer automatically clears
  };

  return (
    <View>
      {/* Your existing online/offline toggle */}
      <TouchableOpacity onPress={isOnline ? handleGoOffline : handleGoOnline}>
        <Text>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
      </TouchableOpacity>

      {/* Auto-offline timer component */}
      <AutoOfflineTimer
        isOnline={isOnline}
        remainingTime={getRemainingTime()}
        onExtendTime={resetTimer}
        onGoOffline={handleGoOffline}
      />
    </View>
  );
};
```

## Features

### ✅ **Automatic Operation**
- No manual intervention required
- Timer starts automatically when going online
- Timer clears automatically when going offline

### ✅ **User Control**
- Extend time for another 20 minutes
- Go offline immediately if desired
- Clear visual feedback in last 5 minutes

### ✅ **Reliable**
- Works even if app goes to background
- Updates Firestore when auto-offline occurs
- Handles errors gracefully

### ✅ **Lightweight**
- No server-side functions
- No scheduled tasks
- Minimal resource usage

## Customization

### Change Timer Duration
```javascript
// In useAutoOffline.js
const TWENTY_MINUTES = 30 * 60 * 1000; // Change to 30 minutes
```

### Change Warning Time
```javascript
// In AutoOfflineTimer.js
useEffect(() => {
  setShowTimer(isOnline && remainingTime <= 10 && remainingTime > 0); // Show when 10 minutes remaining
}, [isOnline, remainingTime]);
```

### Custom Styling
```javascript
// In AutoOfflineTimer.js styles
container: {
  backgroundColor: '#YOUR_COLOR',
  // ... other styles
}
```

## Database Updates

When auto-offline occurs, these fields are updated in Firestore:

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

## Benefits

1. **Simple**: No complex server-side logic
2. **Reliable**: Works even with network issues
3. **Fast**: Immediate response, no server delays
4. **Cost-effective**: No additional Firebase function costs
5. **Maintainable**: Easy to understand and modify

## Limitations

1. **App must be running**: Timer stops if app is completely closed
2. **Single device**: Timer only works on the device where it started
3. **No server sync**: Other devices won't know about the timer

## Best Practices

1. **Test thoroughly**: Ensure timer works in various app states
2. **Handle edge cases**: What happens if app goes to background?
3. **User feedback**: Make it clear when timer is active
4. **Graceful degradation**: Handle errors without breaking the app

---

**Note**: This system is perfect for simple auto-offline requirements. For more complex scenarios (like cross-device sync or server-side validation), consider the cloud function approach instead. 