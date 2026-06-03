import { getOrCreateDeviceId } from "@/lib/device-id";
import { useEffect, useState } from "react";

/**
 * #393 — `useDeviceId`, the React hook that resolves the persisted
 * SecureStore-backed `deviceId` of the current installation. Returns `null`
 * until the SecureStore read completes (one-shot async, no auth involved); UI
 * gates that depend on the device row should render a splash / spinner while
 * `deviceId === null`.
 */
export function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void getOrCreateDeviceId().then((id) => {
      if (mounted) setDeviceId(id);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return deviceId;
}
