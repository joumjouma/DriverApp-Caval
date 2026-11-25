/**
 * Shared Firestore data model for the Caval apps (driver + customer) and
 * Cloud Functions. Keep this file identical in DriverApp-Caval and
 * Caval-Customer-Clean. New code can use these types in .ts files, or in
 * .js files via JSDoc:  /** @type {import('../types/firestore').RideRequest} *\/
 *
 * "server" = written only by Cloud Functions (enforced by firestore.rules).
 */
import type { Timestamp } from 'firebase/firestore';

type When = Timestamp | Date | string;

export type RideType = 'Caval Privé' | 'Caval moto';

export type RideStatus =
  | 'waiting'            // created by the customer
  | 'driver_selected'    // server offered it to selectedDriverId (15 s to accept)
  | 'assigned'           // driver accepted
  | 'driver_arrived'
  | 'picked_up'
  | 'completed'
  | 'declined'           // customer cancelled while searching
  | 'cancelled'
  | 'cancelled_by_driver'
  | 'no_drivers_available';

/** rideRequests/{rideId} */
export interface RideRequest {
  userId: string;                    // customer uid
  rideType: RideType;
  status: RideStatus;
  pickupLat: number; pickupLng: number;
  destinationLat: number; destinationLng: number;
  pickupAddress?: string; destinationAddress?: string;
  distance?: number;                 // km, from the customer's route
  duration?: number;
  fare: number;                      // Fdj — overwritten by the server
  paymentMethod?: string;
  createdAt: When;

  selectedDriverId?: string | null;  // server
  driverId?: string | null;          // set by the driver on accept
  driverName?: string | null;
  driverPhoto?: string | null;
  driverPhone?: string | null;
  declinedDrivers?: string[];        // server
  reassignmentAttempts?: number;     // server

  fareSource?: 'server';             // server
  billedDistanceKm?: number;         // server
  clientFare?: number | null;        // server: what the app sent
  earningsRecordedAt?: When;         // server

  pickupNote?: string | null;        // landmark for the driver, ≤ 140
  passenger?: { name: string; phone: string } | null; // ride booked for someone else

  // Packages (see docs/PACKAGES.md in DriverApp-Caval)
  serviceType?: 'ride' | 'delivery' | 'hourly'; // missing = ride
  demo?: boolean;                    // demo mode: only matched with demo drivers
  package?: RidePackage;
  pickupPhotoUrl?: string;           // driver, at pickup
  deliveryVerified?: boolean;        // server (confirmDelivery)
  deliveredAt?: When;                // server
  deliveryCodeAttempts?: number;     // server
}

export type PackageSize = 'petit' | 'moyen' | 'grand';

export interface RidePackage {
  size: PackageSize;
  description?: string;              // ≤ 200
  recipientName: string;             // ≤ 80
  recipientPhone: string;            // +253…
  note?: string;                     // for the driver, ≤ 200
  payer: 'sender';
}

/** rideRequests/{id}/private/delivery — server only; readable by the sender */
export interface DeliveryPrivate {
  code: string;                      // 4 digits, also WhatsApp'd to the recipient
  createdAt: When;
  sentToRecipientAt?: When;
  copiedFrom?: string;               // retried delivery keeps the old code
}

/** appConfig/customer — feature flags, edited in the Console */
export interface CustomerAppConfig {
  packagesEnabled?: boolean;
}

/** Drivers/{uid} — readable by every signed-in user, keep it public-safe */
export interface Driver {
  email: string;
  firstName: string; lastName: string;
  phoneNumber: string;
  vehicleType: string; driverType: RideType | string;
  city?: string; country?: string;
  plaqueImmatriculation?: string;
  carMake?: string; carModel?: string; carColor?: string;
  photo?: string;
  rating?: number; rideCount?: number;
  isOnline: boolean; isAvailable: boolean;
  latitude?: number; longitude?: number;
  gender?: 'female' | 'male' | null;
  demo?: boolean;                    // demo mode (appConfig/demo.testers only)
  // admin / server only:
  isApproved: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  approvalDate?: When | null; approvedBy?: string | null;
  documentsVerified: boolean;
  ratings?: number[]; averageRating?: number; totalRatings?: number;
}

/** Drivers/{uid}/private/profile — owner only */
export interface DriverPrivateProfile {
  carteGrisePhoto?: string;
  paymentMethods?: unknown;
  createdAt?: When;
}

/** Customers/{uid} — owner only */
export interface Customer {
  firstName: string;
  lastName?: string;
  email?: string;
  number?: string;                   // phone
  photo?: string;
}

/** moneyByRider/{driverId}_{YYYYMMDD} — server, Djibouti date */
export interface DailyMoney {
  driverId: string;
  total: number;
  trips: { rideId: string; fare: number; timestamp: string }[];
}

/** Earnings/{driverId} — server */
export interface Earnings {
  totalEarnings: number;
  dailyBreakdown: Record<string, { total: number; trips: number }>; // key YYYY-MM-DD
}

/** SelectedDriver/{rideId} — the current offer, server-created */
export interface RideOffer {
  rideId: string;
  selectedDriverId: string;
  status: 'selected' | 'reassigned' | 'assigned' | 'accepted' | 'rejected' | 'declined' | 'completed';
  countdownExpiryTime?: When;
}

/** conversations/{id} and conversations/{id}/messages/{id} */
export interface Conversation {
  customerId: string;
  driverId: string;
  participants?: string[];
  lastMessage?: string;
}
