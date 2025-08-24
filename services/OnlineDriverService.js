import { db } from '../config/firebase';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

class OnlineDriverService {
  /**
   * Get the current OnlineDriver document with aggregated information
   */
  static async getOnlineDriverStats() {
    try {
      const onlineDriverDoc = await getDoc(doc(db, 'OnlineDriver', 'current'));
      
      if (onlineDriverDoc.exists()) {
        return onlineDriverDoc.data();
      } else {
        console.log('OnlineDriver document not found');
        return null;
      }
    } catch (error) {
      console.error('Error fetching online driver stats:', error);
      return null;
    }
  }

  /**
   * Listen to real-time updates of the OnlineDriver document
   */
  static subscribeToOnlineDriverUpdates(callback) {
    try {
      const unsubscribe = onSnapshot(
        doc(db, 'OnlineDriver', 'current'),
        (doc) => {
          if (doc.exists()) {
            callback(doc.data());
          } else {
            callback(null);
          }
        },
        (error) => {
          console.error('Error listening to OnlineDriver updates:', error);
          callback(null);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error('Error setting up OnlineDriver subscription:', error);
      return () => {};
    }
  }

  /**
   * Get online drivers by type
   */
  static async getOnlineDriversByType(driverType) {
    try {
      const stats = await this.getOnlineDriverStats();
      
      if (!stats || !stats.onlineDrivers) {
        return [];
      }

      return stats.onlineDrivers.filter(driver => 
        driver.driverType === driverType && driver.isAvailable
      );
    } catch (error) {
      console.error('Error getting online drivers by type:', error);
      return [];
    }
  }

  /**
   * Get available drivers count by type
   */
  static async getAvailableDriversCountByType(driverType) {
    try {
      const stats = await this.getOnlineDriverStats();
      
      if (!stats || !stats.driversByType || !stats.driversByType[driverType]) {
        return 0;
      }

      return stats.driversByType[driverType].available || 0;
    } catch (error) {
      console.error('Error getting available drivers count by type:', error);
      return 0;
    }
  }

  /**
   * Get total online drivers count
   */
  static async getTotalOnlineDriversCount() {
    try {
      const stats = await this.getOnlineDriverStats();
      return stats ? stats.totalOnlineDrivers : 0;
    } catch (error) {
      console.error('Error getting total online drivers count:', error);
      return 0;
    }
  }

  /**
   * Get total available drivers count
   */
  static async getTotalAvailableDriversCount() {
    try {
      const stats = await this.getOnlineDriverStats();
      return stats ? stats.totalAvailableDrivers : 0;
    } catch (error) {
      console.error('Error getting total available drivers count:', error);
      return 0;
    }
  }

  /**
   * Get driver statistics summary
   */
  static async getDriverStatisticsSummary() {
    try {
      const stats = await this.getOnlineDriverStats();
      
      if (!stats) {
        return {
          totalOnline: 0,
          totalAvailable: 0,
          byType: {},
          lastUpdated: null,
          status: 'inactive'
        };
      }

      return {
        totalOnline: stats.totalOnlineDrivers,
        totalAvailable: stats.totalAvailableDrivers,
        byType: stats.driversByType,
        lastUpdated: stats.lastUpdated,
        status: stats.status
      };
    } catch (error) {
      console.error('Error getting driver statistics summary:', error);
      return {
        totalOnline: 0,
        totalAvailable: 0,
        byType: {},
        lastUpdated: null,
        status: 'inactive'
      };
    }
  }

  /**
   * Get online duration for a specific driver
   */
  static async getDriverOnlineDuration(driverId) {
    try {
      const stats = await this.getOnlineDriverStats();
      
      if (!stats || !stats.drivers) {
        return 0;
      }

      const driver = stats.drivers.find(d => d.id === driverId);
      return driver ? driver.onlineDuration || 0 : 0;
    } catch (error) {
      console.error('Error getting driver online duration:', error);
      return 0;
    }
  }

  /**
   * Get all online drivers with their duration
   */
  static async getOnlineDriversWithDuration() {
    try {
      const stats = await this.getOnlineDriverStats();
      
      if (!stats || !stats.drivers) {
        return [];
      }

      return stats.drivers.map(driver => ({
        ...driver,
        onlineDuration: driver.onlineDuration || 0,
        formattedDuration: this.formatDuration(driver.onlineDuration || 0)
      }));
    } catch (error) {
      console.error('Error getting online drivers with duration:', error);
      return [];
    }
  }

  /**
   * Format duration from seconds to human readable format
   */
  static formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0s';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${remainingSeconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }

  /**
   * Get real-time online duration updates
   */
  static subscribeToOnlineDurationUpdates(callback) {
    try {
      const unsubscribe = onSnapshot(
        doc(db, 'OnlineDriver', 'summary'),
        (doc) => {
          if (doc.exists()) {
            const data = doc.data();
            if (data && data.drivers) {
              const driversWithDuration = data.drivers.map(driver => ({
                ...driver,
                formattedDuration: this.formatDuration(driver.onlineDuration || 0)
              }));
              callback(driversWithDuration);
            } else {
              callback([]);
            }
          } else {
            callback([]);
          }
        },
        (error) => {
          console.error('Error listening to online duration updates:', error);
          callback([]);
        }
      );

      return unsubscribe;
    } catch (error) {
      console.error('Error setting up online duration subscription:', error);
      return () => {};
    }
  }
}

export default OnlineDriverService; 