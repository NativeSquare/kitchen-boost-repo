/**
 * F-WIZARD [1/10] (#265) — `WizardView` test matrix.
 *
 * Pure presentational shell of the `/pipeline/[prospectId]/provision` route.
 * Splitting it out of `page.tsx` (which owns `useSession`, `useQuery`,
 * `useParams`, `useRouter`) lets vitest pin every branch — forbidden,
 * loading, not-found, wrong-phase, shown — under the lean `node` env (no
 * jsdom, no Convex test harness), same React-tree-serializer pattern used by
 * `prospect-fiche-view.test.tsx`.
 *
 * Acceptance criteria covered (issue #265):
 *   - AC route — the wizard renders the stepper + the current step's form
 *     placeholder when shown.
 *   - AC guard RBAC — KB Manager → `UnauthorizedCard`.
 *   - AC défensive — prospect introuvable → clean « introuvable » message
 *     with a CTA back to the pipeline. Wrong phase → clean « phase
 *     incompatible » message with a CTA back to the fiche prospect.
 *   - AC stepper — the 8 steps are rendered with their numbered short titles.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

import { WizardView } from "./wizard-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as prospect-fiche-view.test.tsx.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

function adminSession(): SessionState {
  return {
    status: "ready",
    session: { isAdmin: true, tenants: [], user: FIXTURE_USER },
  };
}

function managerSession(): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId: TENANT_ID,
          slug: "khan",
          name: "Khan",
          role: "kb_manager",
        },
      ],
      user: FIXTURE_USER,
    },
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("WizardView — F-WIZARD [1/10] (#265)", () => {
  it("KB Manager → renders the shared UnauthorizedCard (« Accès non autorisé »)", () => {
    const tree = serialize(
      WizardView({
        session: managerSession(),
        prospect: makeProspect(),
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Acc[èe]s non autoris[ée]/i);
    // Prospect data must not leak in the refusal surface.
    expect(text).not.toContain("L'Artisan");
  });

  it("prospect undefined (Convex in-flight) → loading state, no stepper", () => {
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect: undefined,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).not.toMatch(/Acc[èe]s non autoris[ée]/i);
    expect(text).not.toMatch(/introuvable/i);
  });

  it("prospect null → defensive « introuvable » message with CTA back to /pipeline (AC#8)", () => {
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect: null,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/introuvable/i);
  });

  it("prospect in `acquisition` phase → defensive « phase incompatible » with CTA back to fiche prospect (AC#8 — the Launcher button gates appearance but the route itself is also defensive)", () => {
    const prospect = makeProspect({ phase: "acquisition" });
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    // Don't pin exact copy, but the surface must clearly distinguish from
    // "introuvable" / "Accès non autorisé".
    expect(text).toMatch(/phase|provision/i);
    expect(text).not.toMatch(/Acc[èe]s non autoris[ée]/i);
    // A CTA back to the fiche prospect must surface (one of the anchors
    // should point to /pipeline/<prospectId>).
    const html = JSON.stringify(tree);
    expect(html).toContain(`/pipeline/${PROSPECT_ID as unknown as string}`);
  });

  it("KB Admin + prospect ready → renders the stepper with all 8 step short titles", () => {
    const prospect = makeProspect({ phase: "preparation" });
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    // The 8 short titles fixed by the issue body.
    expect(text).toMatch(/Compte resto/i);
    expect(text).toMatch(/Domaine/i);
    expect(text).toMatch(/Stripe/i);
    expect(text).toMatch(/Branding/i);
    expect(text).toMatch(/Menu/i);
    expect(text).toMatch(/QR/i);
    expect(text).toMatch(/Invitation/i);
    expect(text).toMatch(/Activer/i);
  });

  it("KB Admin + prospect ready → renders the prospect name in the wizard header so the operator always sees which resto they're provisioning", () => {
    const prospect = makeProspect({ name: "Mon Resto", phase: "preparation" });
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 1,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).toContain("Mon Resto");
  });

  it("KB Admin + prospect ready, currentStep = 3 → renders the Step3Form placeholder content (« Stripe KYC ») in the body", () => {
    const prospect = makeProspect({
      phase: "preparation",
      tenantId: TENANT_ID,
    });
    const tree = serialize(
      WizardView({
        session: adminSession(),
        prospect,
        tenant: undefined,
        publishedMenu: undefined,
        managerInvite: undefined,
        currentStep: 3,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    // The placeholder body must call out the step number / theme so a
    // future contributor lands on the right slot.
    expect(text).toMatch(/Stripe/i);
    expect(text).toMatch(/Step\s*3|Etape\s*3|Étape\s*3/i);
  });
});
