import { Slot } from "expo-router";
import { View } from "react-native";

/**
 * #393 — `(device-setup)` route group, mounted between `(auth)` and
 * `(onboarding)` / `(app)`.
 *
 * Runs ONCE per (user, device) pair: at the first login on a device, the user
 * picks kiosque or téléphone (PRD 20 §1a step 3, §12). The gate in
 * `_layout.tsx` mounts this group only when the Convex `device` row is absent
 * OR `device.mode` has never been set; on every subsequent launch the gate
 * skips straight to `(onboarding)` / `(app)`. TB-6 (#398) layers the rest of
 * the post-login sequence (push prompt + device checklist) around this same
 * group.
 */
export default function DeviceSetupLayout() {
  return (
    <View className="flex-1 bg-background">
      <Slot />
    </View>
  );
}
