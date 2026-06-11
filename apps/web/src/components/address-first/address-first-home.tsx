"use client";

/**
 * FEATURE A (#closed-resto UX) — `<AddressFirstHome>`: the client wrapper around
 * the address-first form on `/` that surfaces the « Resto fermé » sheet at LOAD
 * when the resto is closed, BYPASSING the address form (a delivery quote is
 * pointless when closed). The sheet is dismissable — « Voir la carte » routes to
 * `/menu` so the customer can browse read-only (Uber-Eats behaviour); ordering /
 * checkout stays blocked by the `isOpenNow` / `hors_horaire` safety-net gate.
 *
 * When OPEN the closed sheet renders nothing, so the normal address-first flow
 * is entirely unchanged.
 */
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ServiceStatusProvider } from "@/components/availability/service-status-context";
import { ClosedRestoSheet } from "@/components/availability/closed-resto-sheet";
import { AddressFirstForm } from "./address-first-form";

export type AddressFirstHomeProps = {
  tenantId: Id<"tenants">;
  initialAddress?: string;
};

export function AddressFirstHome({
  tenantId,
  initialAddress,
}: AddressFirstHomeProps): React.JSX.Element {
  return (
    <ServiceStatusProvider tenantId={tenantId}>
      <ClosedRestoSheet browseHref="/menu" />
      <AddressFirstForm tenantId={tenantId} initialAddress={initialAddress} />
    </ServiceStatusProvider>
  );
}
