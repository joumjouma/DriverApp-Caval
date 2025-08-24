import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * Component to display auto-offline timer and allow time extension
 */
const AutoOfflineTimer = ({ isOnline, remainingTime, onExtendTime, onGoOffline }) => {
  const [showTimer, setShowTimer] = useState(false);

  // Show timer when driver has less than 5 minutes remaining (300 seconds)
  useEffect(() => {
    const shouldShow = isOnline && remainingTime <= 5 && remainingTime > 0;
    
    if (shouldShow && !showTimer) {
      console.log(`⏰ AutoOfflineTimer: TIMER VISIBLE - ${remainingTime} minutes remaining before auto-offline`);
      setShowTimer(true);
    } else if (!shouldShow && showTimer) {
      console.log('⏰ AutoOfflineTimer: Timer hidden (driver offline or time extended)');
      setShowTimer(false);
    }
    
    // Log timer state changes
    if (shouldShow) {
      console.log(`⏰ AutoOfflineTimer: Countdown active - ${remainingTime} minutes remaining`);
    }
  }, [isOnline, remainingTime, showTimer]);

  // Handle extending time
  const handleExtendTime = () => {
    console.log('⏰ AutoOfflineTimer: User chose to EXTEND time for another 20 minutes');
    
    Alert.alert(
      "⏰ Extend Online Time",
      "Do you want to stay online for another 20 minutes?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Extend", 
          style: "default",
          onPress: () => {
            console.log('⏰ AutoOfflineTimer: EXTEND confirmed - resetting timer for another 20 minutes (1200 seconds)');
            if (onExtendTime) {
              onExtendTime();
            }
          }
        }
      ]
    );
  };

  // Handle going offline now
  const handleGoOffline = () => {
    console.log('⏰ AutoOfflineTimer: User chose to go OFFLINE immediately');
    
    Alert.alert(
      "🔄 Go Offline Now",
      "Are you sure you want to go offline now?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Go Offline", 
          style: "destructive",
          onPress: () => {
            console.log('⏰ AutoOfflineTimer: OFFLINE confirmed - setting driver offline now');
            if (onGoOffline) {
              onGoOffline();
            }
          }
        }
      ]
    );
  };

  if (!showTimer) {
    return null;
  }

  console.log(`⏰ AutoOfflineTimer: Rendering timer with ${remainingTime} minutes remaining`);

  return (
    <View style={styles.container}>
      <View style={styles.timerContainer}>
        <Ionicons name="time-outline" size={20} color="#FF6B35" />
        <Text style={styles.timerText}>
          Auto-offline in {remainingTime} min
        </Text>
      </View>
      
      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.extendButton]} 
          onPress={handleExtendTime}
        >
          <Ionicons name="refresh-outline" size={16} color="#4CAF50" />
          <Text style={styles.extendButtonText}>Extend</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, styles.offlineButton]} 
          onPress={handleGoOffline}
        >
          <Ionicons name="power-outline" size={16} color="#F44336" />
          <Text style={styles.offlineButtonText}>Offline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF3E0',
    borderWidth: 1,
    borderColor: '#FFB74D',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  timerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF6B35',
    marginLeft: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  extendButton: {
    backgroundColor: '#E8F5E8',
    borderColor: '#4CAF50',
  },
  extendButtonText: {
    color: '#4CAF50',
    fontWeight: '600',
    marginLeft: 6,
  },
  offlineButton: {
    backgroundColor: '#FFEBEE',
    borderColor: '#F44336',
  },
  offlineButtonText: {
    color: '#F44336',
    fontWeight: '600',
    marginLeft: 6,
  },
});

export default AutoOfflineTimer; 