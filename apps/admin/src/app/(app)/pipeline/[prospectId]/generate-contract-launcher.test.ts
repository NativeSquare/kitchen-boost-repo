/**
 * F-CONTRATS slice 3/4 (#174) — `GenerateContractLauncher` wiring contract.
 *
 * Pinned at the source-file level (same discipline as `page.test.ts` /
 * `provision/layout.test.ts`). The launcher is the Convex-wired wrapper
 * around the pure `GenerateContractModal` (already exhaustively pinned
 * by `generate-contract-modal.test.tsx`). The integration concerns this
 * matrix locks down are:
 *
 *   - The launcher fires the canonical mutation
 *     `api.lib.admin.contracts.generateContract` (NOT
 *     `sendContract`/`refreshContractStatus`/`expireContract` — those are
 *     V2, issue spec « Out of scope explicite »).
 *   - The trigger button copy is « Générer contrat » verbatim (issue AC).
 *   - The pure decision helper is re-derived at submit time (the
 *     launcher imports `decideGenerateContract`, so a future refactor
 *     that bypasses the decision and rebuilds the partner payload by
 *     hand fails here loudly).
 *   - The error path fires a `toast.error` (issue AC : « toast d'erreur,
 *     pas d'iframe blanche »).
 *   - The success path forwards the new `contractId` via the
 *     `onGenerated` callback (the page consumes it to drive the
 *     `ContractIframe` hydration).
 *   - The launcher uses `useMutation` (Convex's reactive mutation hook)
 *     so dependent `useQuery`s (the slice-1 contracts list) auto-refresh
 *     without manual refetch — issue AC « la liste se met à jour
 *     automatiquement ».
 *   - Scope discipline : the file imports NOTHING from `apps/web` or
 *     `apps/native` (defensive — the lint rule would catch a real
 *     import but this pins the intent).
 *
 * The launcher itself is NOT exercised as a runtime component here
 * (calling `useMutation` / `useState` out of a React render context
 * needs a real React renderer or a heavier hooks shim). The pure
 * modal's runtime branches are covered by `generate-contract-modal
 * .test.tsx`; the pure decision's branches by `generate-contract
 * .decision.test.ts`. This file locks the WIRING — what the launcher
 * imports and which APIs it calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE = readFileSync(
  path.resolve(__dirname, "./generate-contract-launcher.tsx"),
  "utf8",
);

/**
 * Strip block + line comments + backtick template literals before checking
 * executable code, so a docstring referring to (say) `sendContract` doesn't
 * false-positive — only actual code matters (mirror of `page.test.ts`).
 */
function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

const CODE = stripNonCode(SOURCE);

describe("GenerateContractLauncher — F-CONTRATS slice 3/4 (#174) wiring", () => {
  it("AC — fires the canonical mutation `api.lib.admin.contracts.generateContract`", () => {
    expect(CODE).toMatch(/api\.lib\.admin\.contracts\.generateContract/);
    // Uses Convex's reactive `useMutation` (drives `useQuery` auto-refresh).
    expect(CODE).toMatch(/useMutation\(/);
  });

  it("AC negative — never calls any V2 contract action (sendContract / refreshContractStatus / expireContract)", () => {
    expect(CODE).not.toMatch(/sendContract/);
    expect(CODE).not.toMatch(/refreshContractStatus/);
    expect(CODE).not.toMatch(/expireContract/);
  });

  it("AC — exposes the « Générer contrat » trigger button (verbatim copy)", () => {
    // Trigger copy is asserted at the source level so a future copy tweak
    // is explicit. The runtime test sees the trigger via its data-slot.
    expect(SOURCE).toMatch(/G[ée]n[ée]rer contrat/);
    expect(CODE).toMatch(/data-slot="generate-contract-trigger"/);
  });

  it("AC — re-derives the pure decision (`decideGenerateContract`) at submit time, not a hand-built payload", () => {
    expect(CODE).toMatch(/decideGenerateContract/);
    // The mutation call MUST forward `decision.partner` (the pure decision
    // builds the trimmed normalised payload — no hand-rolled rebuild).
    expect(CODE).toMatch(/decision\.partner/);
  });

  it("AC — surfaces a toast.error on failure (« pas d'iframe blanche silencieuse »)", () => {
    expect(CODE).toMatch(/toast\.error/);
    expect(CODE).toMatch(/from\s+["']sonner["']/);
  });

  it("AC — forwards the new contractId via the `onGenerated` callback so the page can render the iframe", () => {
    expect(CODE).toMatch(/onGenerated\(contractId\)/);
  });

  it("AC — mounts the pure `GenerateContractModal` (open/close + prestation picker delegated)", () => {
    expect(CODE).toMatch(/GenerateContractModal/);
  });

  it("AC scope — never imports from `apps/web` or `apps/native`", () => {
    expect(CODE).not.toMatch(/apps\/web/);
    expect(CODE).not.toMatch(/apps\/native/);
  });

  it('marked `"use client"` (uses useMutation + useState — client hooks)', () => {
    expect(SOURCE).toMatch(/^["']use client["']/m);
  });
});
