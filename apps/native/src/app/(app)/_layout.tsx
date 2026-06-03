import { PushPermissionBanner } from "@/lib/push-permission";
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
