import { BottomSheetModal } from "@/components/custom/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useDeviceId } from "@/hooks/use-device-id";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetFlatList,
  BottomSheetModal as GorhomBottomSheetModal,
} from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import {
  decideTenantSwitcher,
  resolveActiveTenantId,
  type TenantOption,
} from "./decide-tenant-switcher";

/**
 * #399 — Header tenant switcher (PRD 20 §1b, §12 + AC7).
 *
 * Mounted in the `(app)` shell above every authenticated route. Renders a
 * chip-like trigger labelled with the active tenant's name; tapping it opens
 * a bottom sheet listing every attached tenant for the caller. Picking one
 * persists it via `setMyDeviceLastSelectedTenant` so the same tenant reopens
 * by default on the next launch (#393 already pinned the backend contract).
 *
 * The visibility verdict + active-tenant resolution live in the pure
 * `decideTenantSwitcher` / `resolveActiveTenantId` (same split as
 * `decideForceUpdate` / `decidePushPermissionBanner` / `decideOnboardingStep`).
 * This component is a thin adapter:
 *
 *  - Resolve `getMyDevice` (mode, pinnedTenantId, lastSelectedTenantId) via
 *    Convex `useQuery` — only when authenticated + deviceId resolved.
 *  - Resolve `getSession` (tenants + isAdmin) the same way.
 *  - Pass both to `decideTenantSwitcher` for the visible/hidden verdict.
 *  - When visible, render the chip + bottom sheet + commit the user's pick.
 *
 * Why a bottom sheet instead of a dropdown : NativeTabs lives at the bottom
 * of the screen, the existing `@gorhom/bottom-sheet` provider is already
 * mounted in `_layout.tsx`, and the team's `ConfirmationSheet` UX vocabulary
 * for "pick from a closed set" is the bottom sheet. Less re-invention.
 *
 * Push notification title hint (PRD 20 §1b + Edge cases): NOT this component's
 * job — that's enforced by the backend push template (titre = tenant explicite
 * « Thai Street Châtelet — Nouvelle commande 22 € »). This component only
 * handles in-app switching.
 */
/**
 * Internal hook — wraps the two Convex `useQuery`s and maps their raw
 * responses to the input shape both `decideTenantSwitcher` and
 * `resolveActiveTenantId` consume. Shared by `<TenantSwitcher />` (header
 * chip) and `useActiveTenantId` (query-scoping consumers) so they always
 * see a coherent frame (same Convex subs, same mapping).
 *
 * `device === null` (no row yet) is mapped to "phone, no pin, no hint" so
 * downstream rules treat it as a known-but-empty state rather than loading.
 * The root layout already gates `(device-setup)` while no row exists; this
 * is defense in depth.
 */
function useTenantSwitcherInputs() {
  const deviceId = useDeviceId();
  // `getMyDevice` returns `null` for "no row yet"; the gate at the root layout
  // keeps the splash up until either a row or null resolves. We pass
  // `undefined` (= loading) to the pure decision when either input is still
  // resolving so the switcher stays hidden until everything is known.
  const device = useQuery(
    api.lib.devices.devices.getMyDevice,
    deviceId !== null ? { deviceId } : "skip",
  );
  // `getSession` throws Unauthenticated on signed-out callers; the `(app)`
  // shell is mounted only when authenticated so we don't catch here. Errors
  // surface naturally to the Convex error boundary.
  const session = useQuery(api.lib.auth.getSession.getSession);

  const mappedDevice =
    device === undefined
      ? undefined
      : device === null
        ? {
            mode: undefined,
            pinnedTenantId: undefined,
            lastSelectedTenantId: undefined,
          }
        : {
            mode: device.mode,
            pinnedTenantId: device.pinnedTenantId,
            lastSelectedTenantId: device.lastSelectedTenantId,
          };

  return {
    deviceId,
    inputs: {
      device: mappedDevice,
      tenants: session?.tenants,
      isAdmin: session?.isAdmin ?? false,
    },
  };
}

export function TenantSwitcher() {
  const { deviceId, inputs } = useTenantSwitcherInputs();
  const setLastSelected = useMutation(
    api.lib.devices.devices.setMyDeviceLastSelectedTenant,
  );

  const decision = decideTenantSwitcher(inputs);

  const sheetRef = useRef<GorhomBottomSheetModal | null>(null);

  if (decision.kind === "hidden") return null;

  const activeTenant =
    decision.tenants.find((t) => t.tenantId === decision.activeTenantId) ??
    null;

  return (
    <>
      <View
        // Header strip above the (tabs) stack. Inside (app) so it sits below
        // the PushPermissionBanner (#395) and above NativeTabs. Pressable area
        // is the chip itself; the rest of the strip is layout breathing room.
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Changer de restaurant"
          accessibilityHint="Ouvre la liste des restaurants attachés à ton compte"
          onPress={() => sheetRef.current?.present()}
          className="flex-row items-center gap-2 rounded-full bg-secondary px-3 py-2"
        >
          <Ionicons
            name="storefront-outline"
            size={16}
            className="text-foreground"
          />
          <Text className="text-foreground text-sm font-semibold">
            {activeTenant?.name ?? "Sélectionner un restaurant"}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            className="text-muted-foreground"
          />
        </Pressable>
      </View>

      <TenantPickerSheet
        sheetRef={sheetRef}
        tenants={decision.tenants}
        activeTenantId={decision.activeTenantId}
        onPick={async (tenantId) => {
          // Optimistic close — the Convex sub will hydrate the new selection
          // on the next frame anyway. If the mutation fails (race: the user
          // lost access to this tenant between render and tap, backend throws
          // Forbidden), we surface an alert.
          sheetRef.current?.dismiss();
          if (deviceId === null) return;
          if (tenantId === decision.activeTenantId) return;
          try {
            await setLastSelected({ deviceId, tenantId });
          } catch (err) {
            Alert.alert("Erreur", getConvexErrorMessage(err));
          }
        }}
      />
    </>
  );
}

function TenantPickerSheet({
  sheetRef,
  tenants,
  activeTenantId,
  onPick,
}: {
  sheetRef: React.RefObject<GorhomBottomSheetModal | null>;
  tenants: TenantOption[];
  activeTenantId: Id<"tenants">;
  onPick: (tenantId: Id<"tenants">) => void | Promise<void>;
}) {
  // We use BottomSheetFlatList (not a plain map) because Walid is the upper
  // bound today (3 tenants) but KB plans suggest 5-10 tenants per power user
  // by V2; FlatList is the cheap insurance against a long sheet.
  return (
    <BottomSheetModal ref={sheetRef}>
      <View className="px-4 pb-2 pt-2 gap-2">
        <Text className="text-foreground text-lg font-semibold">
          Choisir un restaurant
        </Text>
        <Text className="text-muted-foreground text-sm">
          Tes restaurants attachés. Le choix est sauvegardé pour ce téléphone.
        </Text>
      </View>
      <BottomSheetFlatList<TenantOption>
        data={tenants}
        keyExtractor={(t: TenantOption) => t.tenantId as unknown as string}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        renderItem={({ item }: { item: TenantOption }) => {
          const isActive = item.tenantId === activeTenantId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Sélectionner ${item.name}`}
              accessibilityState={{ selected: isActive }}
              onPress={() => {
                void onPick(item.tenantId);
              }}
              className="flex-row items-center justify-between rounded-lg border border-border bg-card px-4 py-4 mb-2"
            >
              <Text className="text-foreground text-base font-medium">
                {item.name}
              </Text>
              {isActive ? (
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  className="text-primary"
                />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  className="text-muted-foreground"
                />
              )}
            </Pressable>
          );
        }}
      />
    </BottomSheetModal>
  );
}

/**
 * Hook re-export for surfaces that don't render the switcher itself but need
 * the active tenantId to scope their Convex queries (AC7 « tous les queries
 * Convex de l'app sont scopés au tenant courant »). Wraps `getMyDevice` +
 * `getSession` exactly like `<TenantSwitcher />` so the two stay coherent
 * frame-by-frame (same Convex subs).
 *
 * Returns `null` while either input loads, when the caller is kb_admin, when
 * there is no attached tenant, OR when the kiosque pin no longer matches the
 * attachment list (race: detached after pin — see `resolveActiveTenantId`).
 */
export function useActiveTenantId(): Id<"tenants"> | null {
  const { inputs } = useTenantSwitcherInputs();
  return resolveActiveTenantId(inputs);
}
