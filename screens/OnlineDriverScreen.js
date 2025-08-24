import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, StatusBar, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import OnlineDriverStats from '../components/OnlineDriverStats';
import OnlineDriversList from '../components/OnlineDriversList';

const { width, height } = Dimensions.get('window');

const OnlineDriverScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewMode, setViewMode] = useState('stats'); // 'stats' or 'list'

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Auto-refresh driver numbers every 30 minutes
    const driverRefreshTimer = setInterval(() => {
      // This will trigger a refresh in the OnlineDriverStats component
      console.log('Auto-refreshing driver numbers every 30 minutes');
    }, 30 * 60 * 1000); // 30 minutes

    return () => {
      clearInterval(timer);
      clearInterval(driverRefreshTimer);
    };
  }, []);

  const formatTime = (date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('fr-FR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Enhanced Header with Gradient and Time */}
      <LinearGradient
        colors={['#ff7e28', '#ff9f43', '#ffb74d']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <SafeAreaView style={styles.headerContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#ff7e28" />
          
          {/* Top Bar with Back Button and Time */}
          <View style={styles.topBar}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            
            <View style={styles.timeContainer}>
              <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
              <Text style={styles.dateText}>{formatDate(currentTime)}</Text>
            </View>
            
            <TouchableOpacity
              style={styles.refreshButton}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Main Header Content */}
          <View style={styles.headerContent}>
            <View style={styles.headerIconContainer}>
              <View style={styles.headerIconBackground}>
                <Ionicons name="car" size={40} color="#fff" />
              </View>
            </View>
            
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Chauffeurs en ligne</Text>
              <Text style={styles.headerSubtitle}>
                Surveillance en temps réel du réseau de transport
              </Text>
              <View style={styles.headerStats}>
                <View style={styles.headerStat}>
                  <Ionicons name="wifi" size={16} color="#fff" />
                  <Text style={styles.headerStatText}>Temps réel</Text>
                </View>
                <View style={styles.headerStat}>
                  <Ionicons name="shield-checkmark" size={16} color="#fff" />
                  <Text style={styles.headerStatText}>Sécurisé</Text>
                </View>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Main Content */}
      <SafeAreaView style={{ flex: 1 }}>
        {/* View Mode Toggle */}
        <View style={styles.viewToggleContainer}>
          <TouchableOpacity
            style={[
              styles.viewToggleButton,
              viewMode === 'stats' && { backgroundColor: colors.primary }
            ]}
            onPress={() => setViewMode('stats')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name="analytics-outline" 
              size={20} 
              color={viewMode === 'stats' ? '#fff' : colors.text} 
            />
            <Text style={[
              styles.viewToggleText,
              { color: viewMode === 'stats' ? '#fff' : colors.text }
            ]}>
              Statistiques
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.viewToggleButton,
              viewMode === 'list' && { backgroundColor: colors.primary }
            ]}
            onPress={() => setViewMode('list')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name="list-outline" 
              size={20} 
              color={viewMode === 'list' ? '#fff' : colors.text} 
            />
            <Text style={[
              styles.viewToggleText,
              { color: viewMode === 'list' ? '#fff' : colors.text }
            ]}>
              Liste des chauffeurs
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content based on view mode */}
        {viewMode === 'stats' ? (
          <OnlineDriverStats fake={true} />
        ) : (
          <OnlineDriversList 
            showDetails={true}
            onDriverPress={(driver) => {
              console.log('Driver pressed:', driver);
              // You can add navigation to driver details here
            }}
          />
        )}
      </SafeAreaView>

      {/* Floating Action Button */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        activeOpacity={0.8}
      >
        <Ionicons name="analytics" size={24} color="#fff" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  headerGradient: {
    paddingTop: 10,
    paddingBottom: 20,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    borderRadius: 20,
  },
  headerContainer: {
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  timeContainer: {
    alignItems: 'center',
  },
  timeText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 2,
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    textTransform: 'capitalize',
  },
  refreshButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  headerIconContainer: {
    marginRight: 20,
  },
  headerIconBackground: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 126, 40, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 12,
    lineHeight: 22,
  },
  headerStats: {
    flexDirection: 'row',
    gap: 16,
  },
  headerStat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  headerStatText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
    marginLeft: 6,
  },
  viewToggleContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  viewToggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.card,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    gap: 8,
  },
  viewToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
});

export default OnlineDriverScreen; 