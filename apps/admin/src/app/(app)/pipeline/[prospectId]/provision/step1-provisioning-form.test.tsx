/**
 * F-WIZARD [3/10] (#267) — `Step1ProvisioningForm` test matrix.
 *
 * Pure presentational form for Step 1 of the provisioning wizard. The Convex
 * wiring (read prospect via `api.lib.onboarding.crm.getProspect`, mutation
 * `api.lib.onboarding.provisioning.provisionTenant`) is owned by `page.tsx`
 * and threaded down as props (`prospect`, `onProvision`, `isSubmitting`,
 * `submitError`). This keeps the form testable under the lean `node` vitest
 * env using the same React-tree serializer pattern as the wizard view.
 *
 * Acceptance criteria covered (issue #267):
 *   - 6 champs (nom, SIRET, adresse, contact, email gérant, slug) avec
 *     pré-remplissage depuis le prospect.
 *   - Slug auto-pré-rempli depuis le nom (tant que le slug n'est pas édité
 *     manuellement), éditable.
 *   - Validation client-side : SIRET 14 chiffres, email format, slug regex,
 *     nom non vide. Le bouton « Créer le tenant » est désactivé tant que le
 *     payload n'est pas valide.
 *   - Submit appelle `onProvision` avec le payload normalisé.
 *   - Erreur backend propagée → message inline + valeurs préservées (la
 *     préservation est garantie par le fait que la form garde son état local
 *     même quand `submitError` arrive).
 *   - Re-visite après création (`prospect.tenantId !== undefined`) → form en
 *     read-only avec message d'explication.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import {
  Step1ProvisioningForm,
  type Step1ProvisioningFormProps,
  type Step1ProvisioningPayload,
} from "./step1-provisioning-form";

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as wizard-view.test.tsx.
// ---------------------------------------------------------------------------
type SerializedNode =
  | { type: string; props: Record<string, unknown>; children: SerializedNode[] }
  | { text: string }
  | null;

function isReactElement(node: unknown): node is ReactElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
}

function typeName(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "function") {
    return (
      (t as { displayName?: string; name?: string }).displayName ??
      (t as { name?: string }).name ??
      "Anonymous"
    );
  }
  if (typeof t === "object" && t !== null) {
    const obj = t as { displayName?: string; render?: { name?: string } };
    return obj.displayName ?? obj.render?.name ?? "ForwardRef";
  }
  return String(t);
}

function unwrap(type: unknown): { fn: (props: unknown) => ReactNode } | null {
  if (typeof type === "function") {
    return { fn: type as (p: unknown) => ReactNode };
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as {
      render?: (props: unknown, ref: unknown) => ReactNode;
    };
    if (typeof obj.render === "function") {
      const render = obj.render;
      return { fn: (props) => render(props, null) };
    }
    const memo = type as { type?: unknown };
    if (memo.type !== undefined) {
      return unwrap(memo.type);
    }
  }
  return null;
}

function serialize(node: ReactNode): SerializedNode {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return { text: String(node) };
  }
  if (Array.isArray(node)) {
    return {
      type: "ArrayFragment",
      props: {},
      children: node
        .map((c) => serialize(c))
        .filter((c): c is SerializedNode => c !== null),
    };
  }
  if (isReactElement(node)) {
    const unwrapped = unwrap(node.type);
    if (unwrapped !== null) {
      try {
        return serialize(unwrapped.fn(node.props));
      } catch {
        const props = { ...(node.props as Record<string, unknown>) };
        const rawChildren = props.children as ReactNode | undefined;
        delete props.children;
        const children: SerializedNode[] = [];
        if (rawChildren !== undefined) {
          const list = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
          for (const c of list) {
            const s = serialize(c);
            if (s !== null) children.push(s);
          }
        }
        return { type: typeName(node.type), props, children };
      }
    }
    const props = { ...(node.props as Record<string, unknown>) };
    const rawChildren = props.children as ReactNode | undefined;
    delete props.children;
    const children: SerializedNode[] = [];
    if (rawChildren !== undefined) {
      const list = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
      for (const c of list) {
        const s = serialize(c);
        if (s !== null) children.push(s);
      }
    }
    return { type: typeName(node.type), props, children };
  }
  return null;
}

function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

function allText(n: SerializedNode): string {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null)
    .join(" ");
}

function findAll(
  n: SerializedNode,
  predicate: (n: NonNullable<SerializedNode>) => boolean,
): SerializedNode[] {
  return flatten(n).filter(
    (x): x is NonNullable<SerializedNode> => x !== null && predicate(x),
  );
}

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const matches = findAll(
    n,
    (x) =>
      "props" in x &&
      (x.props as { "data-slot"?: string })["data-slot"] === slot,
  );
  return matches[0] ?? null;
}

function findInputByName(
  n: SerializedNode,
  name: string,
): SerializedNode | null {
  const matches = findAll(
    n,
    (x) => "props" in x && (x.props as { name?: string }).name === name,
  );
  return matches[0] ?? null;
}

function findButtonByText(
  n: SerializedNode,
  label: RegExp,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const text = allText(x);
    return label.test(text);
  });
  // Prefer interactive nodes carrying an onClick (the actual <button>).
  const withHandler = candidates.find(
    (x) =>
      x !== null &&
      "props" in x &&
      typeof (x.props as { onClick?: unknown }).onClick === "function",
  );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;

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

function defaultProps(
  overrides: Partial<Step1ProvisioningFormProps> = {},
): Step1ProvisioningFormProps {
  return {
    prospect: makeProspect({
      name: "L'Artisan",
      siret: "12345678901234",
      address: "1 rue de la Paix, 75001 Paris",
      contactName: "Yanis",
      email: "yanis@artisan.fr",
    }),
    onProvision: vi.fn().mockResolvedValue(undefined),
    isSubmitting: false,
    submitError: null,
    onPrev: () => {},
    onNext: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step1ProvisioningForm — F-WIZARD [3/10] (#267)", () => {
  it("renders the 6 fields (nom, SIRET, adresse, contact, email gérant, slug)", () => {
    const tree = serialize(Step1ProvisioningForm(defaultProps()));
    // The fields are identified by their `name` attribute so the lean
    // serializer can find them without depending on label text.
    expect(findInputByName(tree, "name")).not.toBeNull();
    expect(findInputByName(tree, "siret")).not.toBeNull();
    expect(findInputByName(tree, "address")).not.toBeNull();
    expect(findInputByName(tree, "contactName")).not.toBeNull();
    expect(findInputByName(tree, "emailManager")).not.toBeNull();
    expect(findInputByName(tree, "slug")).not.toBeNull();
  });

  it("pre-fills every field from the prospect (nom, SIRET, adresse, contact, email gérant) and auto-derives the slug from the name", () => {
    const tree = serialize(Step1ProvisioningForm(defaultProps()));
    const nameInput = findInputByName(tree, "name") as {
      props: { value?: string };
    } | null;
    const siretInput = findInputByName(tree, "siret") as {
      props: { value?: string };
    } | null;
    const addressInput = findInputByName(tree, "address") as {
      props: { value?: string };
    } | null;
    const contactInput = findInputByName(tree, "contactName") as {
      props: { value?: string };
    } | null;
    const emailInput = findInputByName(tree, "emailManager") as {
      props: { value?: string };
    } | null;
    const slugInput = findInputByName(tree, "slug") as {
      props: { value?: string };
    } | null;
    expect(nameInput?.props.value).toBe("L'Artisan");
    expect(siretInput?.props.value).toBe("12345678901234");
    expect(addressInput?.props.value).toBe("1 rue de la Paix, 75001 Paris");
    expect(contactInput?.props.value).toBe("Yanis");
    expect(emailInput?.props.value).toBe("yanis@artisan.fr");
    // Slug auto-derived from the name via `generateSlug`: « L'Artisan » →
    // « l-artisan ».
    expect(slugInput?.props.value).toBe("l-artisan");
  });

  it("missing optional prospect fields → form renders with empty inputs (no crash, no « undefined » leakage)", () => {
    // A bare-bones prospect (only the schema-required fields).
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({
            name: "",
            siret: undefined,
            address: undefined,
            contactName: undefined,
            email: undefined,
          }),
        }),
      ),
    );
    const text = allText(tree);
    expect(text).not.toContain("undefined");
    const siretInput = findInputByName(tree, "siret") as {
      props: { value?: string };
    } | null;
    expect(siretInput?.props.value).toBe("");
  });

  it("submit button is disabled when the payload is invalid (e.g. SIRET not 14 digits)", () => {
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({
            name: "Bon Resto",
            siret: "1234", // too short
            email: "x@y.fr",
          }),
        }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit).not.toBeNull();
    expect(submit?.props.disabled).toBe(true);
  });

  it("submit button is disabled when nom is empty", () => {
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({
            name: "",
            siret: "12345678901234",
            email: "x@y.fr",
          }),
        }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("submit button is disabled when email gérant has an invalid format", () => {
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({
            name: "Bon Resto",
            siret: "12345678901234",
            email: "not-an-email",
          }),
        }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("submit button is enabled when every validation passes (nom OK, SIRET 14, email OK, slug regex OK)", () => {
    const tree = serialize(Step1ProvisioningForm(defaultProps()));
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit).not.toBeNull();
    expect(submit?.props.disabled).toBe(false);
  });

  it("clicking submit calls `onProvision` with the normalised payload (nom, siret, address, contactName, emailManager, slug, prospectId)", async () => {
    const onProvision = vi
      .fn<(p: Step1ProvisioningPayload) => Promise<void>>()
      .mockResolvedValue(undefined);
    const tree = serialize(
      Step1ProvisioningForm(defaultProps({ onProvision })),
    );
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { onClick?: () => void };
    } | null;
    submit?.props.onClick?.();
    expect(onProvision).toHaveBeenCalledTimes(1);
    const payload = onProvision.mock.calls[0]?.[0];
    expect(payload).toEqual({
      prospectId: PROSPECT_ID,
      name: "L'Artisan",
      siret: "12345678901234",
      address: "1 rue de la Paix, 75001 Paris",
      contactName: "Yanis",
      emailManager: "yanis@artisan.fr",
      slug: "l-artisan",
    });
  });

  it("submit button is disabled while `isSubmitting` is true (prevents double-submit)", () => {
    const tree = serialize(
      Step1ProvisioningForm(defaultProps({ isSubmitting: true })),
    );
    const submit = findBySlot(tree, "wizard-step1-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("backend error (`submitError !== null`) → renders the error inline (e.g. « Slug déjà pris »)", () => {
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({ submitError: "Slug « l-artisan » déjà pris." }),
      ),
    );
    const errorEl = findBySlot(tree, "wizard-step1-submit-error");
    expect(errorEl).not.toBeNull();
    expect(allText(errorEl)).toMatch(/d[ée]j[àa] pris/i);
  });

  it("read-only mode: when the prospect already carries a `tenantId`, the form renders a clear message and no submit button", () => {
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({
            name: "L'Artisan",
            siret: "12345678901234",
            email: "x@y.fr",
            tenantId: TENANT_ID,
          }),
        }),
      ),
    );
    const text = allText(tree);
    // Explanatory message — issue spec verbatim («  Compte créé, modifications
    // via Paramètres tenant »).
    expect(text).toMatch(/Compte cr[ée][ée]/i);
    expect(text).toMatch(/Param[èe]tres tenant/i);
    // No submit button visible in read-only mode.
    expect(findBySlot(tree, "wizard-step1-submit")).toBeNull();
  });

  it("read-only mode still surfaces the « Suivant » button so the operator can move on", () => {
    const onNext = vi.fn();
    const tree = serialize(
      Step1ProvisioningForm(
        defaultProps({
          prospect: makeProspect({ tenantId: TENANT_ID }),
          onNext,
        }),
      ),
    );
    const nextBtn = findButtonByText(tree, /Suivant/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(nextBtn).not.toBeNull();
    nextBtn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.resolve(__dirname, "./step1-provisioning-form.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/apps\/web/);
    expect(source).not.toMatch(/apps\/native/);
  });
});
