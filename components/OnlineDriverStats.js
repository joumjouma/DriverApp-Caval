import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';

// Module-level variables to persist fake stats across mounts
let lastFakeStats = null;
let lastFakeStatsTimestamp = 0;

const OnlineDriverStats = ({ fake = false }) => {
  const { colors } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (fake) {
      // Helper to generate new fake stats
      const genFakeStats = () => {
        const totalOnlineDrivers = Math.floor(Math.random() * (26 - 12 + 1)) + 12;
        const totalAvailableDrivers = Math.floor(totalOnlineDrivers * (0.6 + Math.random() * 0.3)); // 60-90%
        lastFakeStats = {
          totalOnlineDrivers,
          totalAvailableDrivers,
          driversByType: {},
        };
        lastFakeStatsTimestamp = Date.now();
        setStats(lastFakeStats);
        setLoading(false);
      };
      // On mount, use last stats if less than 5 minutes old, else generate new
      const now = Date.now();
      if (lastFakeStats && now - lastFakeStatsTimestamp < 300000) {
        setStats(lastFakeStats);
        setLoading(false);
      } else {
        genFakeStats();
      }
      // Set up interval to update every 5 minutes
      const interval = setInterval(() => {
        genFakeStats();
      }, 300000);
      return () => clearInterval(interval);
    } else {
      loadStats();
      const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates(setStats);
      return () => unsubscribe();
    }
  }, [fake]);

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
          Chargement des statistiques des chauffeurs en ligne...
        </Text>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.noDataText, { color: colors.text }]}>
          Aucune donnée de chauffeur en ligne disponible
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Ionicons name="car" size={32} color={colors.primary} />
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.text }]}>Chauffeurs en ligne</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {stats.totalOnlineDrivers} en ligne, {stats.totalAvailableDrivers} disponibles
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
            Total en ligne
          </Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
          <Text style={[styles.summaryNumber, { color: colors.text }]}>
            {stats.totalAvailableDrivers}
          </Text>
          <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
            Disponibles
          </Text>
        </View>
      </View>

      {stats.driversByType && Object.keys(stats.driversByType).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Chauffeurs par type
          </Text>
          {Object.entries(stats.driversByType).map(([type, data]) => (
            <View key={type} style={[styles.typeCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.typeName, { color: colors.text }]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
              <Text style={[styles.typeStats, { color: colors.textSecondary }]}>
                {data.count} en ligne, {data.available} disponibles
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