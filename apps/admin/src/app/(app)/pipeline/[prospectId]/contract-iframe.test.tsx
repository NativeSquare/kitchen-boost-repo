/**
 * F-CONTRATS slice 2/4 (#165) — `ContractIframe` test matrix.
 *
 * Isolated, pure component that takes a static HTML string (already generated
 * by `api.lib.admin.contracts.generateContract` upstream) and renders it
 * inside a sandboxed `<iframe>` with a « Télécharger HTML » action. The
 * parent epic is #136 ; this slice delivers ONLY the iframe + download
 * controls — it is NOT yet wired to the contracts list (slice 1, #158
 * already merged) nor to the generation modal (slice 3, future).
 *
 * Decisions pinned (from issue body + parent epic #136 / PRD 70 §3.5) :
 *
 *   - The HTML is rendered via `<iframe sandbox srcDoc={html}>` — sandbox
 *     attribute MUST be present but MUST NOT include `allow-scripts` (the
 *     generated HTML is static, no JS needed).
 *   - The `srcDoc` value MUST be the HTML passed in as a prop (faithful
 *     pass-through, no rewriting).
 *   - A « Télécharger HTML » button MUST be present and clicking it MUST
 *     trigger a blob download with a reasonable filename pattern
 *     (`contrat-<timestamp>.html`).
 *   - The « Télécharger PDF » button is OPTIONAL nice-to-have. This slice
 *     ships the « Télécharger HTML » baseline only ; the PDF flavour is
 *     not in this matrix (the PR comments justify the choice).
 *   - On empty / null / undefined `html`, a CLEAR error message MUST
 *     surface — NOT a silent blank iframe (« pas d'iframe blanche
 *     silencieuse » — issue AC + PRD §3.5 fallback erreur).
 *
 * Same lean-node test pattern as `prospect-fiche-view.test.tsx` /
 * `contracts-block.test.tsx` / `provision-launcher-button.test.tsx` : the
 * React tree is serialised by hand (no jsdom, no RTL, no Convex test
 * harness) so every branch — error / hydrated — pins cleanly.
 *
 * Why this matters
 * ----------------
 * V1 read-only requirement (PRD 70 §3.5, acté 2026-05-29) explicitly
 * outlaws « allow-scripts » : the contract HTML is statically rendered
 * from a markdown template, executing arbitrary JS in that iframe would
 * be a vulnerability if the template upstream ever ingested user input.
 * The sandbox attribute (without `allow-scripts`) is the load-bearing
 * security invariant — pin it explicitly.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { ContractIframe } from "./contract-iframe";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as contracts-block.test.tsx /
// prospect-fiche-view.test.tsx / provision-launcher-button.test.tsx.
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

function findAllByType(n: SerializedNode, type: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } => x !== null && "type" in x && x.type === type,
  );
}

function findFirstByType(
  n: SerializedNode,
  type: string,
):
  | { type: string; props: Record<string, unknown>; children: SerializedNode[] }
  | undefined {
  return findAllByType(n, type)[0] as
    | {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      }
    | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ContractIframe — F-CONTRATS slice 2/4 (#165)", () => {
  it("AC — renders an <iframe> with the sandbox attribute when html is provided", () => {
    const html = "<html><body><h1>Contrat A</h1></body></html>";
    const tree = serialize(ContractIframe({ html }));
    const iframe = findFirstByType(tree, "iframe");
    if (iframe === undefined) {
      throw new Error("expected an iframe to be rendered");
    }
    // The sandbox attribute MUST be present. It is rendered as a string
    // attribute on the iframe — React passes it straight through. The
    // attribute can be empty-string (`sandbox=""`) which is the most
    // restrictive setting, or a space-separated allow-list.
    expect(iframe.props.sandbox).toBeDefined();
    expect(typeof iframe.props.sandbox).toBe("string");
  });

  it("AC — the iframe sandbox MUST NOT include `allow-scripts` (PRD §3.5 — static HTML, no JS needed)", () => {
    const html = "<html><body><h1>Contrat A</h1></body></html>";
    const tree = serialize(ContractIframe({ html }));
    const iframe = findFirstByType(tree, "iframe");
    if (iframe === undefined) {
      throw new Error("expected an iframe to be rendered");
    }
    // Pin the security invariant : NEVER `allow-scripts`. The HTML is
    // generated from a markdown template upstream, no script execution
    // is needed inside the preview iframe.
    const sandbox = iframe.props.sandbox as string;
    expect(sandbox).not.toMatch(/allow-scripts/);
  });

  it("AC — the iframe `srcDoc` attribute contains the HTML passed as a prop (faithful pass-through)", () => {
    const html =
      "<html><body><h1>Contrat A&B — Restaurant Le Test</h1><p>Article 1…</p></body></html>";
    const tree = serialize(ContractIframe({ html }));
    const iframe = findFirstByType(tree, "iframe");
    if (iframe === undefined) {
      throw new Error("expected an iframe to be rendered");
    }
    // React's lowercase DOM attribute is `srcDoc` (it maps to the HTML
    // `srcdoc` attribute). The component MUST pass the prop through
    // verbatim — no rewriting, no sanitising (the template upstream
    // is trusted, this iframe is the security boundary).
    expect(iframe.props.srcDoc).toBe(html);
  });

  it("AC — renders a « Télécharger HTML » button when html is provided", () => {
    const html = "<html><body><h1>Contrat A</h1></body></html>";
    const tree = serialize(ContractIframe({ html }));
    const text = allText(tree);
    expect(text).toMatch(/T[ée]l[ée]charger HTML/i);
    // The button must be a real `<button>` element (not just text). Pinned
    // so a future « swap to <a download> » isn't silent.
    const buttons = findAllByType(tree, "button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  describe("download HTML button", () => {
    // Hand-roll a minimal `URL.createObjectURL` / `revokeObjectURL` / `Blob`
    // stub since the vitest env is `node` (no DOM). The button handler
    // creates an anchor, sets `download`, clicks it, then revokes — we
    // observe the side-effects via these spies. Tests run on the original
    // component handler ; no jsdom, no jsdom-style click simulation.
    let createObjectURLSpy: ReturnType<typeof vi.fn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
    let originalURL: typeof globalThis.URL;
    let originalDocument: typeof globalThis.document;
    let appended: HTMLElement[] = [];
    let clicked: HTMLElement[] = [];

    beforeEach(() => {
      createObjectURLSpy = vi.fn(() => "blob:mock-url");
      revokeObjectURLSpy = vi.fn();
      originalURL = globalThis.URL;
      originalDocument = globalThis.document;

      // Replace just the static methods we need ; keep the rest of `URL`.
      // The cast goes via `unknown` because we are assembling an object
      // literal that doesn't carry the `URL` constructor signature ; we
      // only need the two static methods the component invokes
      // (`createObjectURL` / `revokeObjectURL`).
      globalThis.URL = {
        ...originalURL,
        createObjectURL: createObjectURLSpy,
        revokeObjectURL: revokeObjectURLSpy,
      } as unknown as typeof globalThis.URL;

      appended = [];
      clicked = [];

      // Minimal `document` stub : `createElement` returns a fake anchor that
      // records `click()` calls and the `download` / `href` assigned to it.
      // The component appends to `document.body` ; we record those calls
      // too so the test can assert the lifecycle (append → click → remove).
      globalThis.document = {
        createElement: (tag: string) => {
          const fake = {
            tagName: tag.toUpperCase(),
            href: "",
            download: "",
            style: {} as Record<string, string>,
            click: function () {
              clicked.push(this as unknown as HTMLElement);
            },
            remove: function () {
              const i = appended.indexOf(this as unknown as HTMLElement);
              if (i !== -1) appended.splice(i, 1);
            },
          };
          return fake as unknown as HTMLElement;
        },
        body: {
          appendChild: (n: HTMLElement) => {
            appended.push(n);
            return n;
          },
          removeChild: (n: HTMLElement) => {
            const i = appended.indexOf(n);
            if (i !== -1) appended.splice(i, 1);
            return n;
          },
        },
      } as unknown as typeof globalThis.document;
    });

    afterEach(() => {
      globalThis.URL = originalURL;
      globalThis.document = originalDocument;
    });

    it("clicking « Télécharger HTML » triggers a blob download with a `contrat-<timestamp>.html` filename", () => {
      const html =
        "<html><body><h1>Contrat A — Restaurant Le Test</h1></body></html>";
      const tree = serialize(ContractIframe({ html }));
      // Locate the download button via its visible label (defensive — the
      // serializer may render multiple buttons in a future iteration ; we
      // pick the one whose text matches « Télécharger HTML »).
      const buttons = findAllByType(tree, "button").filter((b) => {
        return /T[ée]l[ée]charger HTML/i.test(allText(b));
      });
      expect(buttons.length).toBe(1);
      const button = buttons[0] as {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      };
      const onClick = button.props.onClick as (() => void) | undefined;
      expect(typeof onClick).toBe("function");
      if (onClick === undefined) {
        throw new Error("expected an onClick handler on the download button");
      }
      onClick();

      // The handler MUST have created a blob URL.
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
      expect(blobArg).toBeDefined();
      // Blob type MUST be `text/html` so the browser downloads it as HTML.
      // (Node's Blob has a `.type` getter.)
      expect(blobArg.type).toMatch(/text\/html/);

      // Anchor MUST have been appended → clicked → removed (or revoked).
      expect(clicked.length).toBe(1);
      const anchor = clicked[0] as unknown as {
        href: string;
        download: string;
      };
      expect(anchor.href).toBe("blob:mock-url");
      // Filename pattern : `contrat-<timestamp>.html`. The exact timestamp
      // is implementation detail (`Date.now()` flavour) — pin the SHAPE
      // (prefix + `.html` suffix + non-empty middle), not the value.
      expect(anchor.download).toMatch(/^contrat-.+\.html$/);

      // Blob URL MUST be revoked to avoid leaking.
      expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
    });
  });

  it("AC — renders a clear error message when html is the empty string (no silent blank iframe)", () => {
    const tree = serialize(ContractIframe({ html: "" }));
    const text = allText(tree);
    // Some non-empty error copy must surface — the user must know the
    // contract HTML failed to generate, not stare at a blank rectangle.
    // The exact copy is implementation detail ; pin the SEMANTIC : the
    // user-visible text mentions an error or absent contract.
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(/erreur|aucun|impossible|indisponible/i);
    // No iframe must be rendered at all in the error branch (« pas
    // d'iframe blanche silencieuse »).
    expect(findAllByType(tree, "iframe").length).toBe(0);
  });

  it("AC — renders a clear error message when html is null (no silent blank iframe)", () => {
    // The prop type accepts `string | null | undefined` (Convex tri-state)
    // — null is the « no row » case the upstream caller may forward as-is.
    const tree = serialize(ContractIframe({ html: null }));
    const text = allText(tree);
    expect(text).toMatch(/erreur|aucun|impossible|indisponible/i);
    expect(findAllByType(tree, "iframe").length).toBe(0);
  });

  it("AC — renders a clear error message when html is undefined (no silent blank iframe)", () => {
    // The prop type accepts `string | null | undefined` (Convex tri-state)
    // — undefined is the « in-flight » case the upstream caller may
    // forward as-is.
    const tree = serialize(ContractIframe({ html: undefined }));
    const text = allText(tree);
    expect(text).toMatch(/erreur|aucun|impossible|indisponible/i);
    expect(findAllByType(tree, "iframe").length).toBe(0);
  });

  it("AC negative — the error branch MUST NOT render the « Télécharger HTML » button (nothing to download)", () => {
    const tree = serialize(ContractIframe({ html: "" }));
    const text = allText(tree);
    // The download CTA is only meaningful when there IS content. The
    // error branch shows no button (and no anchor either).
    expect(text).not.toMatch(/T[ée]l[ée]charger HTML/i);
    expect(findAllByType(tree, "button").length).toBe(0);
  });
});
