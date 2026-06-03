import { PushPermissionBanner } from "@/lib/push-permission";
import { TenantSwitcher } from "@/lib/tenant-switcher";
import { Stack } from "expo-router";
import { View } from "react-native";

export default function AppLayout() {
  return (
    <View className="flex-1 bg-background">
      {/*
       * #395 — OS push permission banner (PRD 20 §3 + §13 + §15 edge case
       * « push refusé au niveau OS »). Mounted ABOVE the <Stack> so the red
       * sticky banner overlays every authenticated route whenever the
       * OS-level push permission is `denied`. Re-renders nothing
       * (decidePushPermissionBanner → "hidden") when the permission is
       * `granted` / `undetermined` / still loading.
       */}
      <PushPermissionBanner />
      {/*
       * #399 — Header tenant switcher (PRD 20 §1b + §12 + AC7). Mounted ABOVE
       * the <Stack> so the chip lives in a thin strip on top of every (tabs)
       * route in phone mode. Returns null and renders nothing in kiosque mode
       * (tenant pinné, switcher masqué), for kb_admin, for mono-tenant users,
       * and while inputs are still loading — defense in depth on top of the
       * root layout's splash gate.
       */}
      <TenantSwitcher />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}
