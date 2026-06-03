/**
 * F-SHELL-06 + E2E manuel SUP — rendering test for `AppSidebar`.
 *
 * The decision logic is pinned by `app-sidebar.decision.test.ts`. This file
 * pins the React rendering contract of the new "Support" entry that landed
 * after Alex's E2E manuel SUP feedback :
 *
 *   « pourquoi support n'est pas accessible depuis un onglet bien défini ?
 *     par exemple au-dessus de l'endroit du profil en bas de la sidebar ? »
 *
 * The route `/support` (KB Admin supervision) and `/t/[id]/support`
 * (KB Manager / KB Admin sur tenant) existaient déjà mais n'étaient PAS
 * linkées depuis la sidebar — l'utilisateur devait forger l'URL.
 *
 * What we pin:
 *   - L'entrée Support apparaît dans le DOM avec un `data-slot="sidebar-support-item"`.
 *   - Elle est positionnée APRÈS le bloc nav principal (assertion ordre DOM).
 *   - Le wrapper `data-slot="sidebar-support-group"` porte la classe `mt-auto`
 *     qui pousse le bloc en bas de `SidebarContent` (au-dessus de `SidebarFooter`).
 *   - L'URL est contextuelle : `/support` en supervision, `/t/<id>/support` en
 *     opérationnel.
 *   - `isActive=true` SEULEMENT sur la route Support exacte.
 *
 * Pattern : même React-tree serializer que `support/page.test.tsx` et
 * `impersonation-banner.render.test.tsx` — vitest `environment: "node"`, pas
 * de jsdom, pas de Testing Library. `next/navigation` et `@/lib/session`
 * sont mockés à module-level pour piloter `usePathname` + `useSession`.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

// ---- Mocks -----------------------------------------------------------------
//
// `usePathname` et `useSession` sont les seules sources externes consommées
// par AppSidebar. Les mocker à module-level laisse chaque `it()` réinjecter
// la valeur voulue via `vi.mocked(...).mockReturnValue(...)`.

const usePathnameMock = vi.fn<() => string | null>();
const useSessionMock = vi.fn<() => SessionState>();

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("@/lib/session", () => ({
  useSession: () => useSessionMock(),
}));

// `next/link` rend un `<a>` natif — pas besoin du runtime Next pour ce test.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// `NavUser` lit un client Convex en réalité — pour le rendu sidebar on en a
// pas besoin, on stub avec un marker qu'on peut localiser dans l'arbre.
vi.mock("@/components/nav-user", () => ({
  NavUser: ({ user }: { user: { name: string; email: string } }) => (
    <div data-slot="nav-user-stub">
      {user.name} {user.email}
    </div>
  ),
}));

// L'import doit venir APRÈS les `vi.mock(...)` pour que la résolution des
// modules pioche les stubs.
import { AppSidebar } from "./app-sidebar";

// ---- Fixtures --------------------------------------------------------------

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;
const FIXTURE_USER_ID = "users_xxx" as unknown as Id<"users">;
const FIXTURE_USER = {
  userId: FIXTURE_USER_ID,
  name: "Alex",
  email: "alex@kb.test",
};

function adminSession(): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: true,
      tenants: [],
      user: FIXTURE_USER,
    },
  };
}

function managerSession(tenantId: Id<"tenants">): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId,
          slug: "lartisan",
          name: "L'Artisan",
          role: "kb_manager",
        },
      ],
      user: FIXTURE_USER,
    },
  };
}

// ---- React-tree serializer (même shape que support/page.test.tsx) ---------

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
        // Radix / shadcn primitives peuvent utiliser des hooks (Context, etc.)
        // qui requièrent un renderer. On les traite comme opaques et on
        // surface leur nom + leurs enfants statiques — c'est suffisant pour
        // les assertions de structure (slots + ordre DOM).
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

type NamedNode = {
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
};

function flattenNamed(n: SerializedNode): NamedNode[] {
  return flatten(n).filter(
    (x): x is NamedNode =>
      x !== null && "type" in x && typeof (x as NamedNode).type === "string",
  );
}

function findBySlot(n: SerializedNode, slot: string): NamedNode[] {
  return flattenNamed(n).filter(
    (x) => (x.props as Record<string, unknown>)["data-slot"] === slot,
  );
}

function findIndexBySlot(n: SerializedNode, slot: string): number {
  const all = flattenNamed(n);
  return all.findIndex(
    (x) => (x.props as Record<string, unknown>)["data-slot"] === slot,
  );
}

// ---- Tests -----------------------------------------------------------------

describe("AppSidebar — Support entry (E2E manuel SUP)", () => {
  it("KB Admin hors tenant → entrée Support visible avec href `/support`", () => {
    useSessionMock.mockReturnValue(adminSession());
    usePathnameMock.mockReturnValue("/");

    const tree = serialize(AppSidebar({}));
    const supportItems = findBySlot(tree, "sidebar-support-item");

    expect(supportItems.length).toBe(1);
    // L'item contient le label « Support »...
    expect(allText(supportItems[0])).toContain("Support");
    // ...et un lien dont le href pointe sur `/support`.
    const links = flattenNamed(supportItems[0]).filter((x) => x.type === "a");
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].props.href).toBe("/support");
  });

  it("KB Manager sur tenant → entrée Support avec href `/t/<id>/support`", () => {
    useSessionMock.mockReturnValue(managerSession(TENANT_A));
    usePathnameMock.mockReturnValue(`/t/${TENANT_A}/menu`);

    const tree = serialize(AppSidebar({}));
    const supportItems = findBySlot(tree, "sidebar-support-item");

    expect(supportItems.length).toBe(1);
    const links = flattenNamed(supportItems[0]).filter((x) => x.type === "a");
    expect(links[0].props.href).toBe(`/t/${TENANT_A}/support`);
  });

  it("entrée Support rendue APRÈS le bloc nav principal (ordre DOM : nav → support → footer)", () => {
    useSessionMock.mockReturnValue(adminSession());
    usePathnameMock.mockReturnValue("/");

    const tree = serialize(AppSidebar({}));

    const supportIdx = findIndexBySlot(tree, "sidebar-support-item");
    const footerIdx = findIndexBySlot(tree, "sidebar-footer");
    // L'un des nav items principaux (Pipeline) sert d'ancre haute.
    const navItemsIdx = flattenNamed(tree).findIndex((x) =>
      allText(x).includes("Pipeline"),
    );

    expect(supportIdx).toBeGreaterThan(-1);
    // Le bloc Support vient APRÈS les items de nav principaux.
    expect(supportIdx).toBeGreaterThan(navItemsIdx);
    // Et — quand le SidebarFooter est résolu jusqu'au div natif (i.e. quand
    // le serializer n'a pas dû le traiter comme opaque) — il vient AVANT.
    if (footerIdx !== -1) {
      expect(supportIdx).toBeLessThan(footerIdx);
    }
  });

  it("le wrapper Support porte `mt-auto` (pousse le bloc en bas de SidebarContent)", () => {
    useSessionMock.mockReturnValue(adminSession());
    usePathnameMock.mockReturnValue("/");

    const tree = serialize(AppSidebar({}));
    const supportGroups = findBySlot(tree, "sidebar-support-group");

    expect(supportGroups.length).toBe(1);
    const className = supportGroups[0].props.className;
    expect(typeof className).toBe("string");
    expect(className as string).toContain("mt-auto");
  });

  it("Support est `isActive` SEULEMENT sur la route Support exacte", () => {
    // Sur `/support` exact → actif.
    useSessionMock.mockReturnValue(adminSession());
    usePathnameMock.mockReturnValue("/support");
    let tree = serialize(AppSidebar({}));
    let supportItem = findBySlot(tree, "sidebar-support-item")[0];
    // Le SidebarMenuButton (ou son fallback opaque) reçoit `isActive`.
    const activeOn = flattenNamed(supportItem).some(
      (x) => (x.props as { isActive?: boolean }).isActive === true,
    );
    expect(activeOn).toBe(true);

    // Sur `/pipeline` (autre route) → PAS actif.
    usePathnameMock.mockReturnValue("/pipeline");
    tree = serialize(AppSidebar({}));
    supportItem = findBySlot(tree, "sidebar-support-item")[0];
    const activeOff = flattenNamed(supportItem).some(
      (x) => (x.props as { isActive?: boolean }).isActive === true,
    );
    expect(activeOff).toBe(false);
  });

  it("session=loading → pas d'entrée Support (hidden)", () => {
    useSessionMock.mockReturnValue({ status: "loading" });
    usePathnameMock.mockReturnValue("/");

    const tree = serialize(AppSidebar({}));
    const supportItems = findBySlot(tree, "sidebar-support-item");
    expect(supportItems.length).toBe(0);
  });
});
