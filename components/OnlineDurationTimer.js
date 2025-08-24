import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';

/**
 * Component to display online duration timer for a specific driver
 */
function OnlineDurationTimer({ driverId, showDetails = false }) {
  const { colors } = useTheme();
  const [onlineDuration, setOnlineDuration] = useState(0);
  const [formattedDuration, setFormattedDuration] = useState('0s');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    let unsubscribe = null;

    const setupSubscription = async () => {
      try {
        // Get initial duration
        const duration = await OnlineDriverService.getDriverOnlineDuration(driverId);
        setOnlineDuration(duration);
        setFormattedDuration(OnlineDriverService.formatDuration(duration));

        // Subscribe to real-time updates
        unsubscribe = OnlineDriverService.subscribeToOnlineDurationUpdates((drivers) => {
          const driver = drivers.find(d => d.id === driverId);
          if (driver) {
            setOnlineDuration(driver.onlineDuration || 0);
            setFormattedDuration(driver.formattedDuration || '0s');
          }
        });
      } catch (error) {
        console.error('Error setting up online duration subscription:', error);
      }
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [driverId]);

  // Update duration every second for real-time display
  useEffect(() => {
    if (onlineDuration > 0) {
      const interval = setInterval(() => {
        setOnlineDuration(prev => {
          const newDuration = prev + 1;
          setFormattedDuration(OnlineDriverService.formatDuration(newDuration));
          return newDuration;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [onlineDuration]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const duration = await OnlineDriverService.getDriverOnlineDuration(driverId);
      setOnlineDuration(duration);
      setFormattedDuration(OnlineDriverService.formatDuration(duration));
    } catch (error) {
      console.error('Error refreshing online duration:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getStatusColor = () => {
    if (onlineDuration < 300) return '#4CAF50'; // Green for first 5 minutes
    if (onlineDuration < 600) return '#FF9800'; // Orange for 5-10 minutes
    if (onlineDuration < 1200) return '#FF5722'; // Red for 10-20 minutes
    return '#9C27B0'; // Purple for 20+ minutes (shouldn't happen with auto-offline)
  };

  const getStatusIcon = () => {
    if (onlineDuration < 300) return 'time-outline';
    if (onlineDuration < 600) return 'time';
    if (onlineDuration < 1200) return 'warning';
    return 'alert-circle';
  };

  if (onlineDuration <= 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.card }]}>
        <Ionicons name="time-outline" size={16} color={colors.text} />
        <Text style={[styles.durationText, { color: colors.text }]}>
          Offline
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.card }]}>
      <TouchableOpacity 
        style={styles.timerContainer} 
        onPress={handleRefresh}
        disabled={isRefreshing}
      >
        <Ionicons 
          name={getStatusIcon()} 
          size={16} 
          color={getStatusColor()} 
        />
        <Text style={[styles.durationText, { color: colors.text }]}>
          {formattedDuration}
        </Text>
        {isRefreshing && (
          <Ionicons name="refresh" size={12} color={colors.text} style={styles.refreshIcon} />
        )}
      </TouchableOpacity>
      
      {showDetails && (
        <View style={styles.detailsContainer}>
          <Text style={[styles.detailsText, { color: colors.textSecondary }]}>
            Online since: {new Date(Date.now() - (onlineDuration * 1000)).toLocaleTimeString()}
          </Text>
          <Text style={[styles.detailsText, { color: colors.textSecondary }]}>
            Status: {onlineDuration < 300 ? 'New' : onlineDuration < 600 ? 'Active' : onlineDuration < 1200 ? 'Warning' : 'Auto-Offline'}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 8,
    borderRadius: 8,
    marginVertical: 4,
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  refreshIcon: {
    marginLeft: 8,
    opacity: 0.7,
  },
  detailsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  detailsText: {
    fontSize: 12,
    marginVertical: 2,
  },
});

export default OnlineDurationTimer;
