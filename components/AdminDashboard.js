import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';

const AdminDashboard = () => {
  const { colors } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates((data) => {
      setStats(data);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await OnlineDriverService.getOnlineDriverStats();
      setStats(data);
    } catch (error) {
      console.error('Error loading admin stats:', error);
      Alert.alert('Error', 'Failed to load online driver statistics');
    } finally {
      setLoading(false);
    }
  };

  const getDriverTypeStats = () => {
    if (!stats || !stats.driversByType) return [];
    
    return Object.entries(stats.driversByType).map(([type, data]) => ({
      type,
      total: data.count,
      available: data.available,
    }));
  };

  const getOnlineDriversList = () => {
    if (!stats || !stats.onlineDrivers) return [];
    return stats.onlineDrivers.slice(0, 10); // Show first 10 drivers
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="refresh" size={32} color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading admin dashboard...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Ionicons name="shield" size={32} color={colors.primary} />
        <View style={styles.headerContent}>
          <Text style={[styles.title, { color: colors.text }]}>Admin Dashboard</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Online Driver Management
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.refreshButton, { backgroundColor: colors.primary }]}
          onPress={loadStats}
        >
          <Ionicons name="refresh" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryGrid}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="people" size={24} color={colors.primary} />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats?.totalOnlineDrivers || 0}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Total Online
          </Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats?.totalAvailableDrivers || 0}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Available
          </Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="car" size={24} color="#FF9800" />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {getDriverTypeStats().length}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Driver Types
          </Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="time" size={24} color="#2196F3" />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats?.lastUpdated ? 'Live' : 'Offline'}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Status
          </Text>
        </View>
      </View>

      {/* Driver Types Breakdown */}
      {getDriverTypeStats().length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Driver Types Breakdown
          </Text>
          {getDriverTypeStats().map((typeStats) => (
            <View key={typeStats.type} style={[styles.typeCard, { backgroundColor: colors.card }]}>
              <View style={styles.typeHeader}>
                <Text style={[styles.typeName, { color: colors.text }]}>
                  {typeStats.type.charAt(0).toUpperCase() + typeStats.type.slice(1)}
                </Text>
                <View style={styles.typeStats}>
                  <Text style={[styles.typeCount, { color: colors.primary }]}>
                    {typeStats.total} total
                  </Text>
                  <Text style={[styles.typeAvailable, { color: '#4CAF50' }]}>
                    {typeStats.available} available
                  </Text>
                </View>
              </View>
              <View style={styles.progressBar}>
                <View 
                  style={[
                    styles.progressFill, 
                    { 
                      backgroundColor: colors.primary,
                      width: `${(typeStats.available / typeStats.total) * 100}%`
                    }
                  ]} 
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Recent Online Drivers */}
      {getOnlineDriversList().length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Recent Online Drivers
          </Text>
          {getOnlineDriversList().map((driver) => (
            <View key={driver.id} style={[styles.driverCard, { backgroundColor: colors.card }]}>
              <View style={styles.driverHeader}>
                <View style={styles.driverInfo}>
                  <Text style={[styles.driverName, { color: colors.text }]}>
                    {driver.firstName} {driver.lastName}
                  </Text>
                  <Text style={[styles.driverType, { color: colors.textSecondary }]}>
                    {driver.driverType} • {driver.city || 'Unknown location'}
                  </Text>
                </View>
                <View style={styles.driverStatus}>
                  <Ionicons
                    name={driver.isAvailable ? 'checkmark-circle' : 'close-circle'}
                    size={16}
                    color={driver.isAvailable ? '#4CAF50' : '#F44336'}
                  />
                </View>
              </View>
              <View style={styles.driverDetails}>
                <Text style={[styles.driverDetail, { color: colors.textSecondary }]}>
                  Rating: {driver.rating.toFixed(1)} ⭐ • Rides: {driver.rideCount}
                </Text>
                {driver.phoneNumber && (
                  <Text style={[styles.driverDetail, { color: colors.textSecondary }]}>
                    Phone: {driver.phoneNumber}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Last Updated Info */}
      {stats?.lastUpdated && (
        <View style={[styles.footer, { backgroundColor: colors.card }]}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>
            Last updated: {new Date(stats.lastUpdated).toLocaleString()}
          </Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    padding: 16,
    margin: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerContent: {
    flex: 1,
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 12,
  },
  summaryCard: {
    width: '47%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  typeCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  typeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeName: {
    fontSize: 16,
    fontWeight: '600',
  },
  typeStats: {
    flexDirection: 'row',
    gap: 12,
  },
  typeCount: {
    fontSize: 14,
    fontWeight: '500',
  },
  typeAvailable: {
    fontSize: 14,
    fontWeight: '500',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  driverCard: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  driverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '600',
  },
  driverType: {
    fontSize: 14,
    marginTop: 2,
  },
  driverStatus: {
    marginLeft: 8,
  },
  driverDetails: {
    gap: 4,
  },
  driverDetail: {
    fontSize: 12,
  },
  footer: {
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
});

export default AdminDashboard; 