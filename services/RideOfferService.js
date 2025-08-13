import { doc, onSnapshot, updateDoc, getDoc, query, collection, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { auth } from '../config/firebase';
import notificationService from './NotificationService';

class RideOfferService {
  constructor() {
    this.currentOffer = null;
    this.countdownInterval = null;
    this.offerListener = null;
    this.onOfferUpdate = null;
    this.onOfferExpired = null;
    this.isInitialized = false;
  }

  // Initialize the service safely
  initialize() {
    try {
      if (this.isInitialized) {
        return true;
      }
      
      // Check if required dependencies are available
      if (!db || !auth) {
        console.error('RideOfferService: Required dependencies not available');
        return false;
      }
      
      this.isInitialized = true;
      console.log('RideOfferService initialized successfully');
      return true;
    } catch (error) {
      console.error('RideOfferService initialization error:', error);
      return false;
    }
  }

  // Listen for ride offers for the current driver
  startListeningForOffers(driverId) {
    try {
      if (!this.initialize()) {
        console.error('RideOfferService not properly initialized');
        return false;
      }
      
      if (!driverId) {
        console.error('No driver ID provided for listening to offers');
        return false;
      }

      console.log('Starting to listen for ride offers...');
      
      // Listen to DriverSelection collection for offers to this driver
      const q = query(
        collection(db, "DriverSelection"),
        where("selectedDriverId", "==", driverId),
        where("status", "in", ["pending_offer", "offer_sent"])
      );

      this.offerListener = onSnapshot(q, (snapshot) => {
        try {
          snapshot.docChanges().forEach((change) => {
            if (change.type === "added" || change.type === "modified") {
              const offerData = change.doc.data();
              console.log('Ride offer received:', offerData);
              
              // Check if offer is still valid
              const now = new Date();
              const expiryTime = offerData.offerExpiryTime?.toDate() || new Date(offerData.offerExpiryTime);
              
              if (now < expiryTime && offerData.status !== "expired") {
                this.currentOffer = {
                  id: change.doc.id,
                  ...offerData,
                  remainingSeconds: Math.max(0, Math.floor((expiryTime - now) / 1000))
                };
                
                if (this.onOfferUpdate) {
                  this.onOfferUpdate(this.currentOffer);
                }
                
                // Start countdown
                this.startCountdown(offerData.offerExpiryTime);
              } else {
                // Offer has expired
                this.handleOfferExpired(change.doc.id);
              }
            } else if (change.type === "removed") {
              // Offer was removed (accepted/rejected by another driver)
              this.handleOfferExpired(change.doc.id);
            }
          });
        } catch (snapshotError) {
          console.error('Error processing snapshot changes:', snapshotError);
        }
      }, (error) => {
        console.error('Error listening for ride offers:', error);
      });
      
      return true;
    } catch (error) {
      console.error('Error starting offer listener:', error);
      return false;
    }
  }

  // Start countdown timer
  startCountdown(expiryTime) {
    try {
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
      }

      this.countdownInterval = setInterval(() => {
        try {
          const now = new Date();
          const expiry = expiryTime?.toDate() || new Date(expiryTime);
          const remainingSeconds = Math.max(0, Math.floor((expiry - now) / 1000));

          if (this.currentOffer) {
            this.currentOffer.remainingSeconds = remainingSeconds;
            
            if (this.onOfferUpdate) {
              this.onOfferUpdate(this.currentOffer);
            }

            if (remainingSeconds <= 0) {
              this.handleOfferExpired(this.currentOffer.id);
            }
          }
        } catch (countdownError) {
          console.error('Error in countdown timer:', countdownError);
          this.handleOfferExpired(this.currentOffer?.id);
        }
      }, 1000);
    } catch (error) {
      console.error('Error starting countdown:', error);
    }
  }

  // Handle offer expiration
  handleOfferExpired(offerId) {
    try {
      console.log(`Offer ${offerId} expired`);
      
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      
      if (this.onOfferExpired) {
        this.onOfferExpired();
      }
      
      this.currentOffer = null;
    } catch (error) {
      console.error('Error handling offer expiration:', error);
    }
  }

  // Accept a ride offer
  async acceptOffer(offerId) {
    try {
      if (!this.initialize()) {
        throw new Error('Service not properly initialized');
      }
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No user logged in');
      }

      console.log(`Accepting offer ${offerId}`);
      
      // Update the DriverSelection document
      await updateDoc(doc(db, "DriverSelection", offerId), {
        status: "accepted",
        acceptedAt: new Date(),
        countdownSeconds: 0
      });

      // Clear current offer
      this.currentOffer = null;
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }

      console.log(`Offer ${offerId} accepted successfully`);
      return { success: true };
    } catch (error) {
      console.error('Error accepting offer:', error);
      return { success: false, error: error.message };
    }
  }

  // Reject a ride offer
  async rejectOffer(offerId) {
    try {
      if (!this.initialize()) {
        throw new Error('Service not properly initialized');
      }
      
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('No user logged in');
      }

      console.log(`Rejecting offer ${offerId}`);
      
      // Update the DriverSelection document
      await updateDoc(doc(db, "DriverSelection", offerId), {
        status: "rejected",
        rejectedAt: new Date(),
        countdownSeconds: 0
      });

      // Clear current offer
      this.currentOffer = null;
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }

      console.log(`Offer ${offerId} rejected successfully`);
      return { success: true };
    } catch (error) {
      console.error('Error rejecting offer:', error);
      return { success: false, error: error.message };
    }
  }

  // Get current offer
  getCurrentOffer() {
    return this.currentOffer;
  }

  // Stop listening for offers
  stopListening() {
    try {
      if (this.offerListener) {
        this.offerListener();
        this.offerListener = null;
      }
      
      if (this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
      
      this.currentOffer = null;
      this.onOfferUpdate = null;
      this.onOfferExpired = null;
      
      console.log('Stopped listening for ride offers');
    } catch (error) {
      console.error('Error stopping ride offer service:', error);
    }
  }

  // Format countdown time
  formatCountdown(seconds) {
    try {
      if (typeof seconds !== 'number' || seconds < 0) {
        return '0:00';
      }
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    } catch (error) {
      console.error('Error formatting countdown:', error);
      return '0:00';
    }
  }
}

// Create and export a singleton instance
const rideOfferService = new RideOfferService();
export default rideOfferService; 