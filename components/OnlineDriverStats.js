import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import OnlineDriverService from '../services/OnlineDriverService';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

// Module-level variables to persist fake stats across mounts
let lastFakeStats = null;
let lastFakeStatsTimestamp = 0;

const OnlineDriverStats = ({ fake = false }) => {
  const { colors } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [countdown, setCountdown] = useState({ minutes: 0, seconds: 0 });

  useEffect(() => {
    if (fake) {
      // Helper to generate new fake stats with more comprehensive data
      const genFakeStats = () => {
        const totalOnlineDrivers = Math.floor(Math.random() * (26 - 12 + 1)) + 12;
        const totalAvailableDrivers = Math.floor(totalOnlineDrivers * (0.6 + Math.random() * 0.3)); // 60-90%
        
        // Generate realistic driver type distribution
        const driverTypes = {
          'Caval Privé': {
            count: Math.floor(totalOnlineDrivers * 0.6),
            available: Math.floor(totalOnlineDrivers * 0.6 * 0.7),
            icon: 'car',
            color: '#ff7e28',
            description: 'Véhicules privés premium'
          },
          'Caval moto': {
            count: Math.floor(totalOnlineDrivers * 0.4),
            available: Math.floor(totalOnlineDrivers * 0.4 * 0.8),
            icon: 'bicycle',
            color: '#ff9f43',
            description: 'Motos et scooters'
          }
        };

        // Generate performance metrics
        const performanceMetrics = {
          averageResponseTime: Math.floor(Math.random() * 5) + 2, // 2-7 minutes
          completionRate: (85 + Math.random() * 10).toFixed(1), // 85-95%
          customerSatisfaction: (4.2 + Math.random() * 0.6).toFixed(1), // 4.2-4.8
          peakHours: ['08:00-10:00', '17:00-19:00'],
          activeAreas: ['Centre-ville', 'Aéroport', 'Port', 'Université']
        };

        // Generate geographic distribution
        const geographicDistribution = {
          'Centre-ville': Math.floor(Math.random() * 8) + 4,
          'Aéroport': Math.floor(Math.random() * 5) + 2,
          'Port': Math.floor(Math.random() * 4) + 1,
          'Université': Math.floor(Math.random() * 6) + 3,
          'Zone industrielle': Math.floor(Math.random() * 3) + 1
        };

        lastFakeStats = {
          totalOnlineDrivers,
          totalAvailableDrivers,
          driversByType: driverTypes,
          performanceMetrics,
          geographicDistribution,
          lastUpdated: new Date(),
          status: 'active',
          systemHealth: 'excellent',
          uptime: '99.8%',
          activeRides: Math.floor(Math.random() * 15) + 5,
          completedRidesToday: Math.floor(Math.random() * 45) + 20,
          totalEarningsToday: Math.floor(Math.random() * 50000) + 25000,
          averageRideFare: Math.floor(Math.random() * 2000) + 1500
        };
        lastFakeStatsTimestamp = Date.now();
        setStats(lastFakeStats);
        setCountdown({ minutes: 30, seconds: 0 });
        setLoading(false);
      };
      
      // On mount, use last stats if less than 30 minutes old, else generate new
      const now = Date.now();
      if (lastFakeStats && now - lastFakeStatsTimestamp < 30 * 60 * 1000) {
        setStats(lastFakeStats);
        // Calculate remaining time for existing stats
        const timeUntilNextUpdate = lastFakeStatsTimestamp + 30 * 60 * 1000 - now;
        const minutes = Math.floor(timeUntilNextUpdate / 60000);
        const seconds = Math.floor((timeUntilNextUpdate % 60000) / 1000);
        setCountdown({ minutes: Math.max(0, minutes), seconds: Math.max(0, seconds) });
        setLoading(false);
      } else {
        genFakeStats();
      }
      
      // Set up interval to update every 30 minutes
      const interval = setInterval(() => {
        genFakeStats();
        setCountdown({ minutes: 30, seconds: 0 });
      }, 30 * 60 * 1000); // 30 minutes
      return () => clearInterval(interval);
    } else {
      loadStats();
      const unsubscribe = OnlineDriverService.subscribeToOnlineDriverUpdates(setStats);
      return () => unsubscribe();
    }
  }, [fake]);

  // Update countdown every second for real-time display
  useEffect(() => {
    if (fake && lastFakeStatsTimestamp) {
      const interval = setInterval(() => {
        const now = Date.now();
        const timeUntilNextUpdate = lastFakeStatsTimestamp + 30 * 60 * 1000 - now;
        
        if (timeUntilNextUpdate > 0) {
          const minutes = Math.floor(timeUntilNextUpdate / 60000);
          const seconds = Math.floor((timeUntilNextUpdate % 60000) / 1000);
          setCountdown({ minutes, seconds });
        } else {
          setCountdown({ minutes: 0, seconds: 0 });
        }
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [fake, lastFakeStatsTimestamp]);

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

  const onRefresh = async () => {
    setRefreshing(true);
    if (fake) {
      // Check if 30 minutes have passed since last stats generation
      const now = Date.now();
      if (lastFakeStats && now - lastFakeStatsTimestamp < 30 * 60 * 1000) {
        // Less than 30 minutes have passed, keep existing stats
        console.log('Manual refresh: Using existing stats (less than 30 minutes old)');
        setStats(lastFakeStats);
      } else {
        // More than 30 minutes have passed, generate new stats
        console.log('Manual refresh: Generating new stats (30+ minutes old)');
        const totalOnlineDrivers = Math.floor(Math.random() * (26 - 12 + 1)) + 12;
        const totalAvailableDrivers = Math.floor(totalOnlineDrivers * (0.6 + Math.random() * 0.3));
        
        const driverTypes = {
          'Caval Privé': {
            count: Math.floor(totalOnlineDrivers * 0.6),
            available: Math.floor(totalOnlineDrivers * 0.6 * 0.7),
            icon: 'car',
            color: '#ff7e28',
            description: 'Véhicules privés premium'
          },
          'Caval moto': {
            count: Math.floor(totalOnlineDrivers * 0.4),
            available: Math.floor(totalOnlineDrivers * 0.4 * 0.8),
            icon: 'bicycle',
            color: '#ff9f43',
            description: 'Motos et scooters'
          }
        };

        const newStats = {
          totalOnlineDrivers,
          totalAvailableDrivers,
          driversByType: driverTypes,
          performanceMetrics: {
            averageResponseTime: Math.floor(Math.random() * 5) + 2,
            completionRate: (85 + Math.random() * 10).toFixed(1),
            customerSatisfaction: (4.2 + Math.random() * 0.6).toFixed(1),
            peakHours: ['08:00-10:00', '17:00-19:00'],
            activeAreas: ['Centre-ville', 'Aéroport', 'Port', 'Université']
          },
          geographicDistribution: {
            'Centre-ville': Math.floor(Math.random() * 8) + 4,
            'Aéroport': Math.floor(Math.random() * 5) + 2,
            'Port': Math.floor(Math.random() * 4) + 1,
            'Université': Math.floor(Math.random() * 6) + 3,
            'Zone industrielle': Math.floor(Math.random() * 3) + 1
          },
          lastUpdated: new Date(),
          status: 'active',
          systemHealth: 'excellent',
          uptime: '99.8%',
          activeRides: Math.floor(Math.random() * 15) + 5,
          completedRidesToday: Math.floor(Math.random() * 45) + 20,
          totalEarningsToday: Math.floor(Math.random() * 50000) + 25000,
          averageRideFare: Math.floor(Math.random() * 2000) + 1500
        };
        
        setStats(newStats);
        lastFakeStats = newStats;
        lastFakeStatsTimestamp = Date.now();
        setCountdown({ minutes: 30, seconds: 0 });
      }
    } else {
      await loadStats();
    }
    setRefreshing(false);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'excellent': return '#ff7e28';
      case 'good': return '#ff9f43';
      case 'fair': return '#ffb74d';
      case 'poor': return '#d84315';
      default: return '#9E9E9E';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'excellent': return 'checkmark-circle';
      case 'good': return 'checkmark-circle-outline';
      case 'fair': return 'warning';
      case 'poor': return 'close-circle';
      default: return 'help-circle';
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Chargement des statistiques des chauffeurs en ligne...
          </Text>
          <Text style={[styles.loadingSubtext, { color: colors.textSecondary }]}>
            Mise à jour en temps réel...
          </Text>
        </View>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.noDataContainer}>
          <Ionicons name="alert-circle" size={64} color={colors.textSecondary} />
          <Text style={[styles.noDataText, { color: colors.text }]}>
            Aucune donnée de chauffeur en ligne disponible
          </Text>
          <Text style={[styles.noDataSubtext, { color: colors.textSecondary }]}>
            Vérifiez votre connexion ou réessayez plus tard
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {/* Header Section with Enhanced Design */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <LinearGradient
          colors={['rgba(255, 126, 40, 0.15)', 'rgba(255, 159, 67, 0.1)']}
          style={styles.headerGradient}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="car" size={32} color={colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.text }]}>
                Chauffeurs en ligne
              </Text>
              {fake && (
                <Text style={[styles.demoNote, { color: '#FF8C00' }]}>
                  ⚠️ Données de démonstration (mise à jour toutes les 30 min)
                </Text>
              )}
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {stats.totalOnlineDrivers} en ligne • {stats.totalAvailableDrivers} disponibles
              </Text>
              <Text style={[styles.lastUpdated, { color: colors.textSecondary }]}>
                Dernière mise à jour: {stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleTimeString('fr-FR') : 'N/A'}
              </Text>
              {fake && lastFakeStatsTimestamp && (
                <Text style={[styles.nextUpdate, { color: colors.textSecondary }]}>
                  Prochaine mise à jour: {new Date(lastFakeStatsTimestamp + 30 * 60 * 1000).toLocaleTimeString('fr-FR')}
                </Text>
              )}
              {fake && lastFakeStatsTimestamp && (
                <Text style={[styles.countdown, { color: '#FF8C00' }]}>
                  ⏱️ Prochaine mise à jour dans: {countdown.minutes} min {countdown.seconds}s
                </Text>
              )}
            </View>
          </View>
        </LinearGradient>
      </View>

      {/* System Status Card */}
      <View style={[styles.statusCard, { backgroundColor: colors.card }]}>
        <View style={styles.statusHeader}>
          <Ionicons 
            name={getStatusIcon(stats.systemHealth || 'good')} 
            size={24} 
            color={getStatusColor(stats.systemHealth || 'good')} 
          />
          <Text style={[styles.statusTitle, { color: colors.text }]}>
            État du système
          </Text>
          <View style={[styles.notificationBadge, { backgroundColor: '#ff7e28' }]}>
            <Text style={styles.notificationBadgeText}>3</Text>
          </View>
        </View>
        <View style={styles.statusGrid}>
          <View style={styles.statusItem}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Disponibilité</Text>
            <Text style={[styles.statusValue, { color: getStatusColor(stats.systemHealth || 'good') }]}>
              {stats.uptime || '99.8%'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Santé</Text>
            <Text style={[styles.statusValue, { color: getStatusColor(stats.systemHealth || 'good') }]}>
              {stats.systemHealth || 'excellent'}
            </Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Latence</Text>
            <Text style={[styles.statusValue, { color: '#4CAF50' }]}>
              45ms
            </Text>
          </View>
        </View>
      </View>

      {/* Main Statistics Cards */}
      <View style={styles.summaryContainer}>
        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <LinearGradient
            colors={['#ff7e28', '#ff9f43']}
            style={styles.summaryCardGradient}
          >
            <Ionicons name="people" size={28} color="#fff" />
            <Text style={styles.summaryNumber}>
              {stats.totalOnlineDrivers}
            </Text>
            <Text style={styles.summaryLabel}>
              Total en ligne
            </Text>
            <View style={styles.summaryTrend}>
              <Ionicons name="trending-up" size={16} color="#fff" />
              <Text style={styles.summaryTrendText}>+12%</Text>
            </View>
          </LinearGradient>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: colors.card }]}>
          <LinearGradient
            colors={['#ff9f43', '#ffb74d']}
            style={styles.summaryCardGradient}
          >
            <Ionicons name="checkmark-circle" size={28} color="#fff" />
            <Text style={styles.summaryNumber}>
              {stats.totalAvailableDrivers}
            </Text>
            <Text style={styles.summaryLabel}>
              Disponibles
            </Text>
            <View style={styles.summaryTrend}>
              <Ionicons name="trending-up" size={16} color="#fff" />
              <Text style={styles.summaryTrendText}>+8%</Text>
            </View>
          </LinearGradient>
        </View>
      </View>

      {/* Driver Types Section with Enhanced Design */}
      {stats.driversByType && Object.keys(stats.driversByType).length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Répartition par type de véhicule
            </Text>
            <TouchableOpacity 
              style={styles.infoButton}
              onPress={() => setShowDetailedStats(!showDetailedStats)}
            >
              <Ionicons 
                name={showDetailedStats ? "chevron-up" : "chevron-down"} 
                size={20} 
                color={colors.primary} 
              />
            </TouchableOpacity>
          </View>
          
          {Object.entries(stats.driversByType).map(([type, data]) => (
            <View key={type} style={[styles.typeCard, { backgroundColor: colors.card }]}>
              <LinearGradient
                colors={[data.color + '20', data.color + '10']}
                style={styles.typeCardGradient}
              >
                <View style={styles.typeCardHeader}>
                  <View style={[styles.typeIconContainer, { backgroundColor: data.color + '20' }]}>
                    <Ionicons name={data.icon} size={24} color={data.color} />
                  </View>
                  <View style={styles.typeCardContent}>
                    <Text style={[styles.typeName, { color: colors.text }]}>
                      {type}
                    </Text>
                    <Text style={[styles.typeDescription, { color: colors.textSecondary }]}>
                      {data.description}
                    </Text>
                  </View>
                  <View style={styles.typeStatsContainer}>
                    <Text style={[styles.typeCount, { color: colors.text }]}>
                      {data.count}
                    </Text>
                    <Text style={[styles.typeAvailable, { color: data.color }]}>
                      {data.available} disponibles
                    </Text>
                  </View>
                </View>
                
                {showDetailedStats && (
                  <View style={styles.typeDetails}>
                    <View style={styles.typeDetailRow}>
                      <Text style={[styles.typeDetailLabel, { color: colors.textSecondary }]}>
                        Taux de disponibilité:
                      </Text>
                      <Text style={[styles.typeDetailValue, { color: colors.text }]}>
                        {data.count > 0 ? Math.round((data.available / data.count) * 100) : 0}%
                      </Text>
                    </View>
                    <View style={styles.typeDetailRow}>
                      <Text style={[styles.typeDetailLabel, { color: colors.textSecondary }]}>
                        Temps de réponse moyen:
                      </Text>
                      <Text style={[styles.typeDetailValue, { color: colors.text }]}>
                        {stats.performanceMetrics?.averageResponseTime || 3} min
                      </Text>
                    </View>
                  </View>
                )}
              </LinearGradient>
            </View>
          ))}
        </View>
      )}

      {/* Footer with Additional Info */}
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          {fake ? 'Données mises à jour toutes les 30 minutes' : 'Données mises à jour en temps réel'} • Système Caval Courrier
        </Text>
        <Text style={[styles.footerSubtext, { color: colors.textSecondary }]}>
          © 2024 Caval Team - Tous droits réservés
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 30,
  },
  header: {
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  headerGradient: {
    padding: 20,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 126, 40, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  demoNote: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  nextUpdate: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  countdown: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
  },
  statusCard: {
    margin: 16,
    padding: 16,
    borderRadius: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 12,
    flex: 1,
  },
  statusGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statusItem: {
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  summaryCardGradient: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  summaryNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginTop: 8,
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  summaryTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  summaryTrendText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  infoButton: {
    padding: 8,
  },
  typeCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  typeCardGradient: {
    padding: 16,
  },
  typeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  typeCardContent: {
    flex: 1,
  },
  typeName: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  typeDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  typeStatsContainer: {
    alignItems: 'flex-end',
  },
  typeCount: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 4,
  },
  typeAvailable: {
    fontSize: 14,
    fontWeight: '600',
  },
  typeDetails: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  typeDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeDetailLabel: {
    fontSize: 14,
  },
  typeDetailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    marginTop: 32,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  footerSubtext: {
    fontSize: 12,
    textAlign: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  notificationBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  loadingSubtext: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  noDataContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  noDataText: {
    marginTop: 16,
    fontSize: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  noDataSubtext: {
    marginTop: 8,
    fontSize: 14,
    textAlign: 'center',
  },
});

export default OnlineDriverStats; 