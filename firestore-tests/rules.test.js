// Firestore rules tests. Run from this folder:
//   npm install
//   npm test
// Requires Java 11+ (the Firestore emulator is a Java program).

const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test, before, after, beforeEach } = require('node:test');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection,
  query, where, getDocs, increment, arrayUnion,
} = require('firebase/firestore');

let env;
const DRIVER = 'driver1', DRIVER2 = 'driver2', CUSTOMER = 'cust1', CUSTOMER2 = 'cust2';
const db = (uid) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'caval-rules-test',
    firestore: { rules: readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const a = ctx.firestore();
    const driver = { firstName: 'D', isApproved: true, approvalStatus: 'approved', isOnline: false,
                     driverType: 'standard', totalEarnings: 100, ratings: [5], averageRating: 5 };
    await setDoc(doc(a, 'Drivers', DRIVER), driver);
    await setDoc(doc(a, 'Drivers', DRIVER2), driver);
    await setDoc(doc(a, 'Customers', CUSTOMER), { firstName: 'C' });
    await setDoc(doc(a, 'Customers', CUSTOMER2), { firstName: 'C2' });
    await setDoc(doc(a, 'rideRequests', 'ride1'), {
      userId: CUSTOMER, status: 'waiting', fare: 20, rideType: 'standard', driverId: null });
    await setDoc(doc(a, 'conversations', 'conv1'), {
      customerId: CUSTOMER, driverId: DRIVER, participants: [CUSTOMER, DRIVER] });
    await setDoc(doc(a, 'conversations', 'conv2'), { customerId: CUSTOMER, driverId: DRIVER }); // driver-created shape
  });
});

// ---------- Drivers ----------
test('signed-out users cannot read anything', async () => {
  await assertFails(getDoc(doc(db(null), 'Drivers', DRIVER)));
  await assertFails(getDoc(doc(db(null), 'rideRequests', 'ride1')));
});

test('driver can register as pending (RegisterScreen)', async () => {
  await assertSucceeds(setDoc(doc(db('new'), 'Drivers', 'new'), {
    firstName: 'N', isApproved: false, approvalStatus: 'pending', approvedBy: null,
    documentsVerified: false, earnings: 0, totalEarnings: 0, weeklyEarnings: 0, dailyEarnings: 0 }));
});

test('driver cannot register pre-approved', async () => {
  await assertFails(setDoc(doc(db('new'), 'Drivers', 'new'), { isApproved: true, approvalStatus: 'approved' }));
});

test('driver cannot create a Drivers doc for someone else', async () => {
  await assertFails(setDoc(doc(db('new'), 'Drivers', 'other'), { isApproved: false }));
});

test('driver can update own status/location', async () => {
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER),
    { isOnline: true, isAvailable: true, latitude: 1, longitude: 2, rideCount: increment(1), rating: 4.8 }));
});

test('driver cannot approve themselves or edit earnings', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { isApproved: true }));
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { approvalStatus: 'approved' }));
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { totalEarnings: 99999 }));
});

test('driver cannot edit another driver', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER2), { isOnline: false }));
});

test('customer can rate a driver (DriverFoundScreen) but nothing else', async () => {
  await assertSucceeds(updateDoc(doc(db(CUSTOMER), 'Drivers', DRIVER),
    { ratings: [5, 4], averageRating: 4.5, totalRatings: 2 }));
  await assertFails(updateDoc(doc(db(CUSTOMER), 'Drivers', DRIVER), { isApproved: false }));
  await assertFails(updateDoc(doc(db(CUSTOMER), 'Drivers', DRIVER), { averageRating: 5, isOnline: false }));
});

test('driver can query online drivers (assignment)', async () => {
  await assertSucceeds(getDocs(query(collection(db(DRIVER), 'Drivers'),
    where('isOnline', '==', true), where('driverType', '==', 'standard'))));
});

// ---------- Customers ----------
test('customers are private to their owner', async () => {
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'Customers', CUSTOMER)));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'Customers', CUSTOMER)));
  await assertFails(getDoc(doc(db(DRIVER), 'Customers', CUSTOMER)));
});

// ---------- rideRequests ----------
test('customer creates own ride (RideOptionsScreen)', async () => {
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'),
    { userId: CUSTOMER, status: 'waiting', fare: 10, rideType: 'standard', driverId: null }));
});

test('customer creates ride without status (HomeScreenWithMap)', async () => {
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), { userId: CUSTOMER, activity: 'active' }));
});

test('customer cannot create a ride for someone else or pre-assigned', async () => {
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), { userId: CUSTOMER2, status: 'waiting' }));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), { userId: CUSTOMER, status: 'completed' }));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), { userId: CUSTOMER, driverId: DRIVER }));
});

test('customer reads own rides via query (ActivityScreen)', async () => {
  await assertSucceeds(getDocs(query(collection(db(CUSTOMER), 'rideRequests'),
    where('userId', '==', CUSTOMER), where('status', '==', 'completed'))));
});

test('customer cannot read or list other rides', async () => {
  await assertFails(getDoc(doc(db(CUSTOMER2), 'rideRequests', 'ride1')));
  await assertFails(getDocs(collection(db(CUSTOMER2), 'rideRequests')));
});

test('customer can cancel own ride, not change fare', async () => {
  await assertSucceeds(updateDoc(doc(db(CUSTOMER), 'rideRequests', 'ride1'),
    { status: 'declined', cancelledAt: new Date(), cancelledBy: 'customer', cancellationReason: 'x' }));
  await assertFails(updateDoc(doc(db(CUSTOMER), 'rideRequests', 'ride1'), { fare: 0 }));
});

test('customer cannot mark own ride completed', async () => {
  await assertFails(updateDoc(doc(db(CUSTOMER), 'rideRequests', 'ride1'), { status: 'completed' }));
});

test('driver can assign and progress a ride (HomeScreenWithMap / RideInProgress)', async () => {
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride1'),
    { driverId: DRIVER2, selectedDriverId: DRIVER2, status: 'driver_selected', reassignmentAttempts: increment(1) }));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride1'),
    { status: 'completed', completedAt: new Date(), declinedDrivers: arrayUnion(DRIVER) }));
});

test('driver cannot change fare or customer', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride1'), { fare: 500 }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride1'), { userId: DRIVER }));
});

test('nobody can delete rides', async () => {
  await assertFails(deleteDoc(doc(db(CUSTOMER), 'rideRequests', 'ride1')));
  await assertFails(deleteDoc(doc(db(DRIVER), 'rideRequests', 'ride1')));
});

// ---------- rideRequestsDriver ----------
test('customer attaches contact info to own ride only', async () => {
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequestsDriver'), { rideRequestId: 'ride1', firstName: 'C' }));
  await assertFails(addDoc(collection(db(CUSTOMER2), 'rideRequestsDriver'), { rideRequestId: 'ride1', firstName: 'X' }));
});

// ---------- SelectedDriver ----------
test('only drivers touch SelectedDriver', async () => {
  await assertSucceeds(setDoc(doc(db(DRIVER), 'SelectedDriver', 'ride1'), { rideId: 'ride1', driverId: DRIVER2 }));
  await assertFails(getDoc(doc(db(CUSTOMER), 'SelectedDriver', 'ride1')));
});

// ---------- money ----------
test('moneyByRider: own ledger only', async () => {
  const id = `${DRIVER}_20261122`;
  await assertSucceeds(setDoc(doc(db(DRIVER), 'moneyByRider', id), { driverId: DRIVER, total: increment(20) }, { merge: true }));
  await assertSucceeds(getDoc(doc(db(DRIVER), 'moneyByRider', `${DRIVER}_20261101`))); // missing day still readable
  await assertFails(setDoc(doc(db(DRIVER2), 'moneyByRider', id), { driverId: DRIVER2, total: 1 }));
  await assertFails(getDoc(doc(db(DRIVER2), 'moneyByRider', id)));
});

test('Earnings / PaymentMethods / driverStats are owner-only', async () => {
  for (const c of ['Earnings', 'PaymentMethods', 'driverStats', 'DriverPushTokens']) {
    await assertSucceeds(setDoc(doc(db(DRIVER), c, DRIVER), { x: 1 }));
    await assertFails(getDoc(doc(db(DRIVER2), c, DRIVER)));
  }
});

test('OnlineDriver summary is read-only for clients', async () => {
  await assertSucceeds(getDoc(doc(db(DRIVER), 'OnlineDriver', 'summary')));
  await assertFails(setDoc(doc(db(DRIVER), 'OnlineDriver', 'summary'), { drivers: [] }));
});

// ---------- conversations ----------
test('participants read conversations, including driver-created shape', async () => {
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'conversations', 'conv1')));
  await assertSucceeds(getDoc(doc(db(DRIVER), 'conversations', 'conv2')));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'conversations', 'conv1')));
});

test('inbox query by participants (InboxScreen)', async () => {
  await assertSucceeds(getDocs(query(collection(db(CUSTOMER), 'conversations'),
    where('participants', 'array-contains', CUSTOMER))));
});

test('existing-conversation query (conversation.js)', async () => {
  await assertSucceeds(getDocs(query(collection(db(CUSTOMER), 'conversations'),
    where('driverId', '==', DRIVER), where('customerId', '==', CUSTOMER))));
});

test('messages: participants only', async () => {
  await assertSucceeds(addDoc(collection(db(DRIVER), 'conversations', 'conv1', 'messages'), { text: 'hi' }));
  await assertFails(addDoc(collection(db(CUSTOMER2), 'conversations', 'conv1', 'messages'), { text: 'spam' }));
});

test('cannot hijack a conversation', async () => {
  await assertFails(updateDoc(doc(db(CUSTOMER), 'conversations', 'conv1'), { driverId: DRIVER2 }));
  await assertSucceeds(updateDoc(doc(db(CUSTOMER), 'conversations', 'conv1'), { lastMessage: 'ok' }));
});

// ---------- default deny ----------
test('unlisted collections are closed', async () => {
  await assertFails(setDoc(doc(db(DRIVER), 'test', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(db(DRIVER), 'SystemMetrics', 'driverOptimization')));
});
