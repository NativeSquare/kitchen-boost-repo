/**
 * F-PIPELINE-CRM 09 (#264) — `TenantPanel` test matrix.
 *
 * Pure presentational panel: takes `prospect` + the resolved `tenant` query
 * value (tri-state: `undefined` in-flight | `null` not-found | hydrated)
 * and renders one of four shapes :
 *
 *   - no `prospect.tenantId`                          → NOTHING rendered.
 *   - `tenantId` present + tenant `undefined`         → skeleton.
 *   - `tenantId` present + tenant `null`              → « Tenant introuvable
 *                                                       (id: …) ».
 *   - `tenantId` present + tenant hydrated            → slug + nom + statut
 *                                                       (badge) + bouton
 *                                                       « Ouvrir la vue resto »
 *                                                       (href `/t/<id>`).
 *
 * Same React-tree-serializer pattern as the rest of the pipeline
 * `_components/*` tests (lean `node` env — no jsdom).
 */
import { describe, expect, it } from "vitest";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { TenantPanel, type TenantPanelTenant } from "./tenant-panel";
import {
  allText,
  findFirstByName,
  flatten,
  serialize,
} from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_yyy" as unknown as Id<"tenants">;

type SerializedShape = ReturnType<typeof serialize>;

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "L'Artisan",
    phone: "0612345678",
    phase: "preparation",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function findSlot(
  tree: SerializedShape,
  slot: string,
): {
  type: string;
  props: Record<string, unknown>;
  children: SerializedShape[];
} | null {
  const matches = flatten(tree).filter(
    (
      n,
    ): n is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedShape[];
    } =>
      n !== null &&
      "type" in n &&
      (n.props as Record<string, unknown>)["data-slot"] === slot,
  );
  return matches[0] ?? null;
}

describe("TenantPanel — F-PIPELINE-CRM 09 (#264)", () => {
  it("renders NOTHING when prospect.tenantId is absent (no placeholder)", () => {
    const tree = serialize(
      TenantPanel({ prospect: makeProspect(), tenant: undefined }),
    );
    // `serialize` returns `null` for a component that returns `null`.
    expect(tree).toBeNull();
  });

  it("renders a skeleton when the tenantId is set but the tenant query is in-flight (undefined)", () => {
    const tree = serialize(
      TenantPanel({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant: undefined,
      }),
    );
    expect(findSlot(tree, "tenant-panel-skeleton")).not.toBeNull();
    // The other branches are absent in this state.
    expect(findSlot(tree, "tenant-panel-not-found")).toBeNull();
    expect(findSlot(tree, "tenant-panel-content")).toBeNull();
  });

  it("renders a clear not-found message (with the id) when the tenant query resolved to null", () => {
    const tree = serialize(
      TenantPanel({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant: null,
      }),
    );
    const nf = findSlot(tree, "tenant-panel-not-found");
    expect(nf).not.toBeNull();
    expect(allText(tree)).toContain("Tenant introuvable");
    expect(allText(tree)).toContain(TENANT_ID as unknown as string);
    expect(findSlot(tree, "tenant-panel-content")).toBeNull();
  });

  it("renders slug, name, status badge and the « Ouvrir la vue resto » button when the tenant is hydrated", () => {
    const tenant: TenantPanelTenant = {
      tenantId: TENANT_ID,
      slug: "lartisan",
      name: "L'Artisan",
      status: "active",
    };
    const tree = serialize(
      TenantPanel({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant,
      }),
    );
    expect(findSlot(tree, "tenant-panel-content")).not.toBeNull();
    const text = allText(tree);
    expect(text).toContain("lartisan");
    expect(text).toContain("L'Artisan");

    const link = findSlot(tree, "tenant-panel-open-link");
    expect(link).not.toBeNull();
    expect(link?.props["href"]).toBe(`/t/${TENANT_ID as unknown as string}`);
    expect(findFirstByName(tree, "Badge")).not.toBeNull();
    expect(text).toContain("Actif");
  });

  it("renders the « pending » badge label when the tenant is provisioned but not yet activated", () => {
    const tenant: TenantPanelTenant = {
      tenantId: TENANT_ID,
      slug: "fresh",
      name: "Fresh Resto",
      status: "pending",
    };
    const tree = serialize(
      TenantPanel({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant,
      }),
    );
    expect(allText(tree)).toContain("En attente");
  });

  it("renders the « suspended » badge label when the tenant is suspended", () => {
    const tenant: TenantPanelTenant = {
      tenantId: TENANT_ID,
      slug: "off",
      name: "Off Resto",
      status: "suspended",
    };
    const tree = serialize(
      TenantPanel({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant,
      }),
    );
    expect(allText(tree)).toContain("Suspendu");
  });
});
