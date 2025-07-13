import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';

const TestOnlineDriverScreen = () => {
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
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="refresh" size={32} color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading OnlineDriver test...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Ionicons name="bug" size={32} color={colors.primary} />
        <View style={styles.headerContent}>
          <Text style={[styles.title, { color: colors.text }]}>OnlineDriver Test</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Testing OnlineDriver functionality
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <View style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Current Stats</Text>
          <Text style={[styles.statText, { color: colors.text }]}>
            Total Online: {stats?.totalOnlineDrivers || 0}
          </Text>
          <Text style={[styles.statText, { color: colors.text }]}>
            Available: {stats?.totalAvailableDrivers || 0}
          </Text>
          <Text style={[styles.statText, { color: colors.text }]}>
            Status: {stats?.status || 'unknown'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.testButton, { backgroundColor: colors.primary }]}
          onPress={loadStats}
        >
          <Ionicons name="refresh" size={20} color="white" />
          <Text style={styles.testButtonText}>Refresh Stats</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
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
  headerContent: {
    marginLeft: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  section: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  statText: {
    fontSize: 16,
    marginBottom: 8,
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  testButtonText: {
    color: 'white',
    fontWeight: '600',
    marginLeft: 8,
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

export default TestOnlineDriverScreen; 