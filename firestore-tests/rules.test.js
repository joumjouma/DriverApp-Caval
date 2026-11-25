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
    await setDoc(doc(a, 'rideRequests', 'ride2'), {
      userId: CUSTOMER, status: 'driver_selected', fare: 900, rideType: 'Caval Privé',
      selectedDriverId: DRIVER, driverId: null, fareSource: 'server' });
    await setDoc(doc(a, 'SelectedDriver', 'ride2'), { rideId: 'ride2', selectedDriverId: DRIVER, status: 'selected' });
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

test('driver documents live in a private subdoc only the driver can read', async () => {
  await assertFails(setDoc(doc(db('new'), 'Drivers', 'new'), { isApproved: false, carteGrisePhoto: 'https://x' }));
  await assertSucceeds(setDoc(doc(db(DRIVER), 'Drivers', DRIVER, 'private', 'profile'), { carteGrisePhoto: 'https://x' }));
  await assertSucceeds(getDoc(doc(db(DRIVER), 'Drivers', DRIVER, 'private', 'profile')));
  await assertFails(getDoc(doc(db(CUSTOMER), 'Drivers', DRIVER, 'private', 'profile')));
  await assertFails(getDoc(doc(db(DRIVER2), 'Drivers', DRIVER, 'private', 'profile')));
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { carteGrisePhoto: 'https://x' }));
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

test('customers cannot edit drivers or write ratings directly (rateDriver function only)', async () => {
  await assertFails(updateDoc(doc(db(CUSTOMER), 'Drivers', DRIVER), { ratings: [5, 4], averageRating: 4.5, totalRatings: 2 }));
  await assertFails(updateDoc(doc(db(CUSTOMER), 'Drivers', DRIVER), { isApproved: false }));
  await assertFails(setDoc(doc(db(CUSTOMER), 'driverRatings', `ride1_${CUSTOMER}`), { rating: 5, driverId: DRIVER, customerId: CUSTOMER }));
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { averageRating: 5 }));
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

test('offered driver can accept and progress the ride (acceptRide / RideInProgress)', async () => {
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'),
    { status: 'assigned', driverId: DRIVER, driverName: 'D', driverPhone: '1' }));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'),
    { status: 'completed', completedAt: new Date() }));
});

test('drivers cannot assign rides (assignment is server-only)', async () => {
  // not offered to them
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride1'),
    { driverId: DRIVER, selectedDriverId: DRIVER, status: 'driver_selected' }));
  await assertFails(updateDoc(doc(db(DRIVER2), 'rideRequests', 'ride2'), { status: 'assigned', driverId: DRIVER2 }));
  // offered to them, but can't hand it to someone else
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { driverId: DRIVER2 }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { selectedDriverId: DRIVER2 }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { declinedDrivers: arrayUnion(DRIVER2) }));
});

test('driver cannot change fare, customer, or server fields', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { fare: 5000 }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { userId: DRIVER }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { earningsRecordedAt: new Date() }));
});

test('customer cannot pre-set server-only ride fields', async () => {
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'),
    { userId: CUSTOMER, status: 'waiting', fare: 1, fareSource: 'server' }));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'),
    { userId: CUSTOMER, status: 'waiting', selectedDriverId: DRIVER }));
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
test('SelectedDriver: offered driver updates status only; nobody creates offers', async () => {
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'SelectedDriver', 'ride2'), { status: 'assigned', assignedAt: new Date() }));
  await assertFails(updateDoc(doc(db(DRIVER), 'SelectedDriver', 'ride2'), { selectedDriverId: DRIVER2 }));
  await assertFails(updateDoc(doc(db(DRIVER2), 'SelectedDriver', 'ride2'), { status: 'assigned' }));
  await assertFails(setDoc(doc(db(DRIVER), 'SelectedDriver', 'ride1'), { rideId: 'ride1', selectedDriverId: DRIVER }));
  await assertFails(getDoc(doc(db(CUSTOMER), 'SelectedDriver', 'ride2')));
});

// ---------- money ----------
test('moneyByRider: read own ledger, nobody writes from the app', async () => {
  const id = `${DRIVER}_20261122`;
  await assertFails(setDoc(doc(db(DRIVER), 'moneyByRider', id), { driverId: DRIVER, total: increment(20) }, { merge: true }));
  await assertSucceeds(getDoc(doc(db(DRIVER), 'moneyByRider', `${DRIVER}_20261101`))); // missing day still readable
  await assertFails(getDoc(doc(db(DRIVER2), 'moneyByRider', id)));
});

test('Earnings: read own, nobody writes from the app', async () => {
  await assertSucceeds(getDoc(doc(db(DRIVER), 'Earnings', DRIVER)));
  await assertFails(setDoc(doc(db(DRIVER), 'Earnings', DRIVER), { totalEarnings: 999999 }));
  await assertFails(getDoc(doc(db(DRIVER2), 'Earnings', DRIVER)));
});

test('PaymentMethods / driverStats / push tokens are owner-only', async () => {
  for (const c of ['PaymentMethods', 'driverStats', 'DriverPushTokens']) {
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

// ---------- packages ----------
const pkg = { size: 'petit', description: 'Clés', recipientName: 'Amina', recipientPhone: '+25377123456', note: '', payer: 'sender' };
const delivery = (extra = {}) => ({ userId: CUSTOMER, status: 'waiting', serviceType: 'delivery', rideType: 'Caval moto',
  pickupLat: 11.58, pickupLng: 43.14, destinationLat: 11.6, destinationLng: 43.15, package: pkg, ...extra });

test('customer can order a valid delivery', async () => {
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery()));
});

test('delivery needs a valid package', async () => {
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ package: { ...pkg, size: 'énorme' } })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ package: { ...pkg, recipientName: '' } })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ package: { ...pkg, payer: 'recipient' } })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ package: { ...pkg, extra: 1 } })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ package: null })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ serviceType: 'food' })));
});

test('customer cannot pre-mark a delivery as verified', async () => {
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), delivery({ deliveryVerified: true })));
});

test('driver cannot complete a delivery without the code', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'rideRequests', 'del1'), delivery({ status: 'picked_up', driverId: DRIVER })));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'del1'), { pickupPhotoUrl: 'x' }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'del1'), { status: 'completed' }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'del1'), { deliveryVerified: true }));
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'del1'), { package: { ...pkg, size: 'grand' } }));
});

test('normal rides can still be completed by the driver', async () => {
  await env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'rideRequests', 'r9'), { userId: CUSTOMER, status: 'picked_up', driverId: DRIVER, rideType: 'Caval moto' }));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'r9'), { status: 'completed' }));
});

test('delivery code: sender only, nobody writes', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'rideRequests', 'del1'), delivery({ status: 'assigned', driverId: DRIVER }));
    await setDoc(doc(ctx.firestore(), 'rideRequests', 'del1', 'private', 'delivery'), { code: '1234' });
  });
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'rideRequests', 'del1', 'private', 'delivery')));
  await assertFails(getDoc(doc(db(DRIVER), 'rideRequests', 'del1', 'private', 'delivery')));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'rideRequests', 'del1', 'private', 'delivery')));
  await assertFails(setDoc(doc(db(CUSTOMER), 'rideRequests', 'del1', 'private', 'delivery'), { code: '0000' }));
});

test('app config: readable, not writable', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'appConfig', 'customer'), { packagesEnabled: false }));
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'appConfig', 'customer')));
  await assertFails(getDoc(doc(db(null), 'appConfig', 'customer')));
  await assertFails(setDoc(doc(db(CUSTOMER), 'appConfig', 'customer'), { packagesEnabled: true }));
});

// ---------- wave 2 ----------
const ride = (extra = {}) => ({ userId: CUSTOMER, status: 'waiting', rideType: 'Caval moto',
  pickupLat: 11.58, pickupLng: 43.14, destinationLat: 11.6, destinationLng: 43.15, ...extra });

test('scheduled ride: 20 min to 7 days ahead', async () => {
  const at = (min) => new Date(Date.now() + min * 60000);
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ status: 'scheduled', scheduledFor: at(60) })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ status: 'scheduled', scheduledFor: at(5) })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ status: 'scheduled', scheduledFor: at(60 * 24 * 8) })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ status: 'scheduled' })));
});

test('ride extras are validated', async () => {
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ stops: [{ latitude: 1, longitude: 2 }], preferFemaleDriver: true, promoCode: 'BIENVENUE' })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ stops: [{}, {}, {}] })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ serviceType: 'hourly', hours: 20 })));
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ serviceType: 'hourly', hours: 3 })));
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride({ discount: 500 })));
});

test('rewards: own doc read-only; promo codes closed', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'customerRewards', CUSTOMER), { credit: 500 }));
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'customerRewards', CUSTOMER)));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'customerRewards', CUSTOMER)));
  await assertFails(setDoc(doc(db(CUSTOMER), 'customerRewards', CUSTOMER), { credit: 99999 }));
  await assertFails(getDoc(doc(db(CUSTOMER), 'promoCodes', 'BIENVENUE')));
});

// ---------- wave 3 ----------
const adminDb = () => env.authenticatedContext('admin1', { admin: true }).firestore();

test('admin claim opens the dashboard collections', async () => {
  await assertSucceeds(setDoc(doc(adminDb(), 'promoCodes', 'BIENVENUE'), { active: true, type: 'amount', value: 200 }));
  await assertFails(getDoc(doc(db(CUSTOMER), 'promoCodes', 'BIENVENUE')));
  await assertSucceeds(setDoc(doc(adminDb(), 'appConfig', 'customer'), { packagesEnabled: true }));
  await assertFails(setDoc(doc(db(CUSTOMER), 'appConfig', 'customer'), { packagesEnabled: true }));
  await assertSucceeds(updateDoc(doc(adminDb(), 'Drivers', DRIVER), { isApproved: true, approvalStatus: 'approved' }));
  await assertSucceeds(getDoc(doc(adminDb(), 'rideRequests', 'ride1')));
});

test('support: own tickets, user messages only as user', async () => {
  await assertSucceeds(setDoc(doc(db(CUSTOMER), 'supportTickets', 't1'), { uid: CUSTOMER, subject: 'Objet oublié', status: 'open' }));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'supportTickets', 't1')));
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'supportTickets', 't1', 'messages'), { text: 'Bonjour', from: 'user', authorUid: CUSTOMER }));
  await assertFails(addDoc(collection(db(CUSTOMER), 'supportTickets', 't1', 'messages'), { text: 'fake', from: 'support', authorUid: CUSTOMER }));
  await assertSucceeds(addDoc(collection(adminDb(), 'supportTickets', 't1', 'messages'), { text: 'Réponse', from: 'support', authorUid: 'admin1' }));
});

test('businesses: members read, only admins write', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'businesses', 'b1'), { name: 'X', memberUids: [CUSTOMER], active: true }));
  await assertSucceeds(getDoc(doc(db(CUSTOMER), 'businesses', 'b1')));
  await assertFails(getDoc(doc(db(CUSTOMER2), 'businesses', 'b1')));
  await assertFails(updateDoc(doc(db(CUSTOMER), 'businesses', 'b1'), { memberUids: [CUSTOMER, CUSTOMER2] }));
});

// ---------- default deny ----------
test('unlisted collections are closed', async () => {
  await assertFails(setDoc(doc(db(DRIVER), 'test', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(db(DRIVER), 'SystemMetrics', 'driverOptimization')));
});

// ---------- Demo mode (appConfig/demo.testers) ----------
async function setTesters(list) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'appConfig', 'demo'), { testers: list });
  });
}

test('only listed testers can create demo rides', async () => {
  const ride = { userId: CUSTOMER, status: 'waiting', fare: 10, rideType: 'standard', driverId: null, demo: true };
  await assertFails(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride)); // no appConfig/demo yet
  await setTesters([CUSTOMER]);
  await assertSucceeds(addDoc(collection(db(CUSTOMER), 'rideRequests'), ride));
  await assertFails(addDoc(collection(db(CUSTOMER2), 'rideRequests'), { ...ride, userId: CUSTOMER2 }));
  // Real rides don't need the list
  await assertSucceeds(addDoc(collection(db(CUSTOMER2), 'rideRequests'), { ...ride, userId: CUSTOMER2, demo: false }));
});

test('only listed testers can put their driver profile in demo mode', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { demo: true }));
  await setTesters([DRIVER]);
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { demo: true }));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'Drivers', DRIVER), { demo: false }));
  await assertFails(updateDoc(doc(db(DRIVER2), 'Drivers', DRIVER2), { demo: true }));
});

test('the offered driver cannot change whether a ride is a demo', async () => {
  await assertFails(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { demo: true }));
  await assertSucceeds(updateDoc(doc(db(DRIVER), 'rideRequests', 'ride2'), { status: 'assigned', driverId: DRIVER }));
});
