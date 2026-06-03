import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * #393 — `deviceId`, the stable per-installation identifier the KB Orders
 * native app sends to Convex (PRD 20 §1a / §1b / §12) so the backend can hold
 * the (user, device) preference row (mode kiosque/téléphone, pinnedTenantId,
 * lastSelectedTenantId, onboardingCompleted).
 *
 * Generated once at first launch (UUIDv4) and persisted in `SecureStore` (iOS
 * keychain / Android EncryptedSharedPreferences) — survives uninstall on iOS
 * (keychain) but typically NOT on Android. That is acceptable: a fresh
 * deviceId on a reinstall just means the user re-takes the kiosque toggle
 * (the existing Convex rows from the old deviceId are harmless leftovers,
 * never selected again — they are not personal data on their own).
 *
 * On Web (Expo Web fallback), `SecureStore` is not available — we fall back
 * to `localStorage` so the existing template's web preview keeps working.
 */
const DEVICE_ID_KEY = "kb.deviceId";

async function readStoredId(): Promise<string | null> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(DEVICE_ID_KEY);
  }
  return SecureStore.getItemAsync(DEVICE_ID_KEY);
}

async function writeStoredId(id: string): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return;
  }
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
}

/**
 * Return the persisted `deviceId`, generating + storing a fresh UUID on first
 * call. Safe to call from concurrent components — `SecureStore` is a single
 * keychain entry, so the last writer wins; the worst case is two UUIDs being
 * generated in parallel during the very first launch, where one ends up
 * stored and the other is discarded silently on the next read.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await readStoredId();
  if (existing !== null && existing.length > 0) return existing;
  const fresh = Crypto.randomUUID();
  await writeStoredId(fresh);
  return fresh;
}
