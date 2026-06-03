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
        {/* #401 — KB Orders detail screen pushed from the home card (PRD 20 §4
           « détail cmd »). Modal-like sheet animation keeps the home queue
           one tap away during the cuisinier's workflow. */}
        <Stack.Screen
          name="orders/[orderId]"
          options={{
            headerShown: false,
            presentation: "card",
          }}
        />
        {/* #408 — KB Orders « Disponibilité des items » screen (PRD 20 §7c +
           ADR 0018). Pushed from the home `<ItemAvailabilityEntry />` pill.
           Card presentation = same back-nav UX as the order detail screen. */}
        <Stack.Screen
          name="disponibilite-items"
          options={{
            headerShown: true,
            headerTitle: "Disponibilité des items",
            presentation: "card",
          }}
        />
        {/* #409 — KB Orders « Modif horaires d'ouverture » screen (PRD 20
           §7d + ADR 0018). Pushed from the home `<ServiceHoursEntry />`
           pill. Toggle Aujourd'hui / Cette semaine + per-day slot editor
           wired to the SAME backend mutation `api.lib.menu.serviceHours.set`
           the KB Admin mirror uses. Card presentation = same back-nav UX
           as the other dedicated screens. */}
        <Stack.Screen
          name="service-hours"
          options={{
            headerShown: true,
            headerTitle: "Horaires d'ouverture",
            presentation: "card",
          }}
        />
      </Stack>
    </View>
  );
}
