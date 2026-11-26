// Push notifications for drivers (Expo push service).
// The server sends them (supabase/migrations/…_notifications.sql → send_push):
//   type "offer"           new ride offered            → Home (the offer sheet is there)
//   type "ride"            change on a ride             → Ride
//   type "chat"            message from a customer      → chat screen
//   type "support"         reply from the Caval team    → Profile (help)
//   type "driver_approval" account approved            → Home
// Android channel "rides" (high importance) must match what the server sends.
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform, Linking } from "react-native";
import { CommonActions } from "@react-navigation/native";
import { savePushToken } from "./driverApi";
import { t } from "../utils/i18n/index";

const EXPO_PROJECT_ID = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function go(name, params) {
  const nav = global.navigationRef?.current;
  if (nav) nav.dispatch(CommonActions.navigate({ name, params }));
}

class NotificationService {
  initialized = false;
  token = null;

  async createAndroidChannels() {
    if (Platform.OS !== "android") return;
    await Notifications.setNotificationChannelAsync("rides", {
      name: t("Courses"),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF6F00",
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
    });
    await Notifications.setNotificationChannelAsync("general", {
      name: t("Général"),
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  async requestPermissions() {
    if (!Device.isDevice) return false;
    const current = await Notifications.getPermissionsAsync();
    if (current.status === "granted") return true;
    const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } });
    return asked.status === "granted";
  }

  openAppSettings() {
    return Linking.openSettings().catch(() => {});
  }

  /** Gets the Expo push token and stores it on the driver row (drivers.push_token). */
  async updatePushToken() {
    if (!(await this.requestPermissions())) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
    this.token = data;
    await savePushToken(data);
    return data;
  }

  handleTap(response) {
    const data = response?.notification?.request?.content?.data || {};
    switch (data.type) {
      case "offer": return go("Home");
      case "ride": return data.rideId ? go("Ride", { rideId: data.rideId }) : go("Home");
      case "chat": return data.conversationId ? go("DriverInboxScreen", { conversationId: data.conversationId }) : null;
      case "support": return go("Profile");
      case "driver_approval": return go("Home");
      default: return null;
    }
  }

  async initialize() {
    if (this.initialized) return { success: true };
    try {
      await this.createAndroidChannels();
      await this.updatePushToken();
      Notifications.addNotificationResponseReceivedListener((r) => this.handleTap(r));
      // Opened from a notification while the app was closed
      const last = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      if (last) setTimeout(() => this.handleTap(last), 600);
      this.initialized = true;
      return { success: true };
    } catch (error) {
      return { success: false, error };
    }
  }

  async checkNotificationStatus() {
    const { status } = await Notifications.getPermissionsAsync().catch(() => ({ status: "denied" }));
    return status === "granted";
  }
}

const notificationService = new NotificationService();
export default notificationService;
