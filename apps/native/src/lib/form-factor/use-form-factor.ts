import { useDeviceId } from "@/hooks/use-device-id";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useWindowDimensions } from "react-native";

import {
  decideFormFactorShell,
  type FormFactorShell,
} from "./decide-form-factor";

/**
 * Hook the `(tabs)/_layout.tsx` consumes to pick between bottom-tabs and the
 * persistent drawer.
 *
 * Composes:
 *  - `useWindowDimensions().width` — RN built-in, updates on rotation /
 *    foldable hinge changes, so a rotation from portrait to landscape on a
 *    tablet flips the shell automatically (and vice versa on a phone).
 *  - `useQuery(getMyDevice)` — reads `device.mode` (kiosque vs téléphone,
 *    #393). `undefined` while the query is in flight, `null` if no row.
 *
 * The decision itself is delegated to `decideFormFactorShell` (pure,
 * unit-tested next door) so the hook stays thin.
 */
export function useFormFactorShell(): FormFactorShell {
  const { width } = useWindowDimensions();
  const deviceId = useDeviceId();
  const device = useQuery(
    api.lib.devices.devices.getMyDevice,
    deviceId !== null ? { deviceId } : "skip",
  );
  const deviceMode =
    device === undefined || device === null ? null : device.mode;
  return decideFormFactorShell({ width, deviceMode });
}
