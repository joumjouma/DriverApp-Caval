import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';
import OnlineDurationTimer from './OnlineDurationTimer';

/**
 * Component to display a list of all online drivers with their duration
 */
const OnlineDriversList = ({ showDetails = false, onDriverPress }) => {
  const { colors } = useTheme();
  const [onlineDrivers, setOnlineDrivers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    let unsubscribe = null;

    const setupSubscription = async () => {
      try {
        setIsLoading(true);
        
        // Get initial data
        const drivers = await OnlineDriverService.getOnlineDriversWithDuration();
        setOnlineDrivers(drivers);
        setLastUpdate(new Date());

        // Subscribe to real-time updates
        unsubscribe = OnlineDriverService.subscribeToOnlineDurationUpdates((drivers) => {
          setOnlineDrivers(drivers);
          setLastUpdate(new Date());
        });
      } catch (error) {
        console.error('Error setting up online drivers subscription:', error);
      } finally {
        setIsLoading(false);
      }
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const drivers = await OnlineDriverService.getOnlineDriversWithDuration();
      setOnlineDrivers(drivers);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error refreshing online drivers:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const renderDriverItem = ({ item }) => (
    <TouchableOpacity
      style={[styles.driverItem, { backgroundColor: colors.card }]}
      onPress={() => onDriverPress && onDriverPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.driverInfo}>
        <View style={styles.driverHeader}>
          <View style={styles.driverNameContainer}>
            <Text style={[styles.driverName, { color: colors.text }]}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={[styles.driverType, { color: colors.textSecondary }]}>
              {item.driverType || 'Unknown'}
            </Text>
          </View>
          
          <View style={styles.statusContainer}>
            <View style={[
              styles.statusIndicator, 
              { backgroundColor: item.isAvailable ? '#4CAF50' : '#FF5722' }
            ]} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>
              {item.isAvailable ? 'Available' : 'Busy'}
            </Text>
          </View>
        </View>

        <View style={styles.driverDetails}>
          <View style={styles.detailRow}>
            <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.detailText, { color: colors.textSecondary }]}>
              {item.phoneNumber || 'No phone'}
            </Text>
          </View>
          
          {item.latitude && item.longitude && (
            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.timerContainer}>
          <OnlineDurationTimer driverId={item.id} showDetails={showDetails} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={[styles.emptyState, { backgroundColor: colors.card }]}>
      <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
      <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
        No Online Drivers
      </Text>
      <Text style={[styles.emptyStateSubtitle, { color: colors.textSecondary }]}>
        There are currently no drivers online
      </Text>
    </View>
  );

  const renderHeader = () => (
    <View style={[styles.header, { backgroundColor: colors.background }]}>
      <View style={styles.headerContent}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Online Drivers ({onlineDrivers.length})
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          {lastUpdate ? `Last updated: ${lastUpdate.toLocaleTimeString()}` : 'Loading...'}
        </Text>
      </View>
      
      <TouchableOpacity 
        style={[styles.refreshButton, { backgroundColor: colors.primary }]}
        onPress={onRefresh}
        disabled={refreshing}
      >
        <Ionicons 
          name="refresh" 
          size={20} 
          color="white" 
          style={refreshing ? styles.rotating : null}
        />
      </TouchableOpacity>
    </View>
  );

  if (isLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <Ionicons name="refresh" size={32} color={colors.textSecondary} style={styles.rotating} />
        <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
          Loading online drivers...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {renderHeader()}
      
      <FlatList
        data={onlineDrivers}
        renderItem={renderDriverItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={renderEmptyState}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 12,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    padding: 16,
    flexGrow: 1,
  },
  driverItem: {
    marginBottom: 12,
    borderRadius: 12,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  driverInfo: {
    gap: 12,
  },
  driverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  driverNameContainer: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  driverType: {
    fontSize: 12,
    textTransform: 'capitalize',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  driverDetails: {
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 12,
  },
  timerContainer: {
    alignItems: 'flex-start',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    borderRadius: 12,
    marginTop: 32,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.8,
  },
  rotating: {
    transform: [{ rotate: '360deg' }],
  },
});

export default OnlineDriversList;






