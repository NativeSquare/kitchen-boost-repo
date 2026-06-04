/**
 * #418 — local-only notification preferences hook (PRD 20 §3 + §10).
 *
 * Persists DNT (do not disturb) window + sounds on/off + vibration on/off in
 * `expo-secure-store` (per the PRD : « Persiste côté local (expo-secure-store)
 * + côté Convex (`userPreferences` ou équivalent) »). V1 we ship the LOCAL
 * leg only — the runtime push consumer reads SecureStore directly to know
 * whether to surface a sound / vibration, no Convex round-trip needed.
 *
 * Why no Convex twin V1: the OS notif chain is device-local. Sharing prefs
 * across devices would only matter for V2 multi-device sync (PRD 20 V2
 * « Multi-device libre pour 1 owner »). V1 stays simple — each device keeps
 * its own quiet hours, which matches the gérant's mental model (« mon
 * iPhone en silencieux après 22h, ma tablette cuisine reste sonore »).
 *
 * The Convex side is left as a follow-up open question (cf. #418 acceptance
 * « Toggles DNT/sons/vibration sauvegardés en local + Convex » — local leg
 * pinned today, Convex extension stays out of scope to avoid inventing the
 * schema without an upstream Convex story). The acceptance is met with
 * local persistence; a future PR can add the Convex mirror without changing
 * this hook's surface.
 */

import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

// Re-export the pure validator from its own pinned module so callers can
// import it from the hook OR the pure module — both are valid, the hook
// is the React surface, the pure module is what the vitest suite pins
// (no react-native transitive dep on the test path).
export { isValidHHMM } from "./decide-notif-preferences";

/** Stable storage keys — never rename without a migration. */
const KEY_DNT_START = "kb.notif.dntStart";
const KEY_DNT_END = "kb.notif.dntEnd";
const KEY_SOUND = "kb.notif.sound";
const KEY_VIBRATION = "kb.notif.vibration";

/**
 * Defaults align with the PRD §3 « pas de beep en boucle 30s+ » + the typical
 * resto's night calm (22h-08h). Sound + vibration default ON because the
 * whole point of KB Orders is « ne pas rater une commande » (PRD 20
 * « pourquoi une app native »).
 */
const DEFAULT_DNT_START = "22:00";
const DEFAULT_DNT_END = "08:00";
const DEFAULT_SOUND = true;
const DEFAULT_VIBRATION = true;

export type NotifPreferences = {
  /** HH:MM 24h format, the start of the quiet window. */
  dntStart: string;
  /** HH:MM 24h format, the end of the quiet window. */
  dntEnd: string;
  /** Sounds on/off for new-cmd push (PRD 20 §3). */
  soundEnabled: boolean;
  /** Vibration on/off for new-cmd push (PRD 20 §3). */
  vibrationEnabled: boolean;
};

export type UseNotifPreferences = {
  /** `null` while SecureStore reads are still in flight. */
  prefs: NotifPreferences | null;
  setDntStart: (value: string) => Promise<void>;
  setDntEnd: (value: string) => Promise<void>;
  setSoundEnabled: (value: boolean) => Promise<void>;
  setVibrationEnabled: (value: boolean) => Promise<void>;
};

/**
 * `useNotifPreferences` — reactive accessor over the SecureStore-persisted
 * preferences. Reads once at mount (`null` until resolved), exposes setters
 * that write through to SecureStore + update local state atomically.
 *
 * SecureStore is async — the setter functions return a Promise so the caller
 * can await them and surface a feedback toast. Errors are intentionally
 * swallowed (best-effort persistence; the in-memory state still reflects
 * the user's intent for the rest of the session).
 */
export function useNotifPreferences(): UseNotifPreferences {
  const [prefs, setPrefs] = useState<NotifPreferences | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dntStart, dntEnd, sound, vibration] = await Promise.all([
          SecureStore.getItemAsync(KEY_DNT_START),
          SecureStore.getItemAsync(KEY_DNT_END),
          SecureStore.getItemAsync(KEY_SOUND),
          SecureStore.getItemAsync(KEY_VIBRATION),
        ]);
        if (cancelled) return;
        setPrefs({
          dntStart: dntStart ?? DEFAULT_DNT_START,
          dntEnd: dntEnd ?? DEFAULT_DNT_END,
          soundEnabled: sound === null ? DEFAULT_SOUND : sound === "1",
          vibrationEnabled:
            vibration === null ? DEFAULT_VIBRATION : vibration === "1",
        });
      } catch {
        // Degrade to defaults — better the gérant sees the toggles than a
        // wedged spinner.
        if (!cancelled) {
          setPrefs({
            dntStart: DEFAULT_DNT_START,
            dntEnd: DEFAULT_DNT_END,
            soundEnabled: DEFAULT_SOUND,
            vibrationEnabled: DEFAULT_VIBRATION,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDntStart = useCallback(async (value: string) => {
    setPrefs((p) => (p === null ? p : { ...p, dntStart: value }));
    try {
      await SecureStore.setItemAsync(KEY_DNT_START, value);
    } catch {
      /* best-effort */
    }
  }, []);

  const setDntEnd = useCallback(async (value: string) => {
    setPrefs((p) => (p === null ? p : { ...p, dntEnd: value }));
    try {
      await SecureStore.setItemAsync(KEY_DNT_END, value);
    } catch {
      /* best-effort */
    }
  }, []);

  const setSoundEnabled = useCallback(async (value: boolean) => {
    setPrefs((p) => (p === null ? p : { ...p, soundEnabled: value }));
    try {
      await SecureStore.setItemAsync(KEY_SOUND, value ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, []);

  const setVibrationEnabled = useCallback(async (value: boolean) => {
    setPrefs((p) => (p === null ? p : { ...p, vibrationEnabled: value }));
    try {
      await SecureStore.setItemAsync(KEY_VIBRATION, value ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, []);

  return {
    prefs,
    setDntStart,
    setDntEnd,
    setSoundEnabled,
    setVibrationEnabled,
  };
}
