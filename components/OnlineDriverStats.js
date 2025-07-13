import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';

const OnlineDriverStats = () => {
  const { colors } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
    const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates(setStats);
    return () => unsubscribe();
  }, []);

  const loadStats = async () => {
    try {
      const data = await OnlineDriverService.getOnlineDriverStats();
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>
          Loading online driver statistics...
        </Text>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.noDataText, { color: colors.text }]}>
          No online driver data available
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Ionicons name="car" size={32} color={colors.primary} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>Online Drivers</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {stats.totalOnlineDrivers} online, {stats.totalAvailableDrivers} available
          </Text>
        </View>
      </View>

      <View style={styles.summaryContainer}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="people" size={24} color={colors.primary} />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats.totalOnlineDrivers}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Total Online
          </Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats.totalAvailableDrivers}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Available
          </Text>
        </View>
      </View>

      {stats.driversByType && Object.keys(stats.driversByType).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Drivers by Type
          </Text>
          {Object.entries(stats.driversByType).map(([type, data]) => (
            <View key={type} style={[styles.typeCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.typeName, { color: colors.text }]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
              <Text style={[styles.typeStats, { color: colors.textSecondary }]}>
                {data.count} online, {data.available} available
              </Text>
            </View>
          ))}
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
  },
  headerText: {
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
  },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  summaryLabel: {
    fontSize: 12,
    marginTop: 4,
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
  typeName: {
    fontSize: 16,
    fontWeight: '600',
  },
  typeStats: {
    fontSize: 14,
    marginTop: 4,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
  noDataText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: 'center',
  },
});

export default OnlineDriverStats; 