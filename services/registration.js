// Driver sign-up: the login, then the driver profile (photo, carte grise, car,
// payout methods). New drivers start "pending" until the Caval team approves them.
//
// If Supabase asks people to confirm their email first, there is no session
// right after sign-up, so nothing can be saved yet. The form is kept on the
// phone and finished automatically at the first sign-in (HomeScreen).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, me, check, fileBody } from "../config/supabase";

const KEY = "pendingDriverRegistration";

/** → { needsEmailConfirmation: boolean } */
export async function registerDriver(form) {
  const { data, error } = await supabase.auth.signUp({
    email: form.email.trim().toLowerCase(),
    password: form.password,
    options: { data: { role: "driver", first_name: form.firstName.trim() } },
  });
  if (error) throw error;
  if (!data.session) {
    const { password, ...rest } = form;
    await AsyncStorage.setItem(KEY, JSON.stringify(rest));
    return { needsEmailConfirmation: true };
  }
  await createDriverProfile(form);
  return { needsEmailConfirmation: false };
}

export async function createDriverProfile(form) {
  const id = me() || (await supabase.auth.getUser()).data.user?.id;
  if (!id) throw new Error("not signed in");
  const upload = async (bucket, path, uri) => {
    if (!uri) return null;
    check(await supabase.storage.from(bucket).upload(path, await fileBody(uri), { contentType: "image/jpeg", upsert: true }));
    return path;
  };
  const photoPath = await upload("avatars", `${id}/photo.jpg`, form.facePhotoUri);
  const photoUrl = photoPath ? `${supabase.storage.from("avatars").getPublicUrl(photoPath).data.publicUrl}?v=${Date.now()}` : null;
  const cardPath = await upload("driver-documents", `${id}/registration.jpg`, form.carteGrisePhotoUri);

  check(await supabase.from("drivers").upsert({
    id,
    first_name: form.firstName.trim(), last_name: form.lastName.trim(),
    driver_type: /moto/i.test(form.vehicleType) ? "Caval moto" : "Caval Privé",
    car_make: form.carMake?.trim() || null, car_model: form.carModel?.trim() || null, car_color: form.carColor?.trim() || null,
    plate: form.plate?.trim().toUpperCase() || null,
    city: form.city?.trim() || null, country: form.country?.trim() || null,
    photo_url: photoUrl,
  }));
  check(await supabase.from("driver_private").upsert({
    driver_id: id, email: form.email.trim().toLowerCase(), phone: form.phone.replace(/\s/g, ""),
    registration_card_url: cardPath, payout: form.paymentMethods || null,
  }));
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Called after sign-in when there is no driver profile yet. → true if one was created. */
export async function finishPendingRegistration() {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!raw) return false;
  const form = JSON.parse(raw);
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.email?.toLowerCase() !== String(form.email).toLowerCase()) return false;
  await createDriverProfile(form);
  return true;
}
