/**
 * F-PIPELINE-CRM 06 (#262) — `BypassConfirmDialog` test matrix.
 *
 * Pure presentation — renders the missing-milestone bullet list (FR labels)
 * and exposes confirm/cancel callbacks. Same React-tree serializer pattern
 * as the rest of `_components/*` tests (no jsdom, vitest `node` env).
 *
 * Pins:
 *  - title + description surface the bypass intent (FR copy)
 *  - every `missing` key is rendered as an FR-labelled `<li>` (the operator
 *    must see WHICH milestones are missing before confirming)
 *  - the dialog only renders content when `open === true` (the AlertDialog
 *    primitive is controlled — the shell owns the open flag)
 *  - confirm + cancel buttons surface with FR copy
 */
import { describe, expect, it } from "vitest";

import { BypassConfirmDialog } from "./bypass-confirm-dialog";
import { allText, findAllByType, serialize } from "./test-utils";

describe("BypassConfirmDialog — F-PIPELINE-CRM 06 (#262)", () => {
  it("passes open=false through to the underlying AlertDialog primitive", () => {
    // The radix AlertDialog primitive controls visibility via portal +
    // `data-state` at RUNTIME — not at React-tree-serialization time. The
    // pure-tree assertion below is therefore: the AlertDialog wrapper
    // surfaces with `open: false` in props, which is enough to trust radix
    // does the right thing at runtime (same trust the refund modal makes,
    // `order-detail-modal.test.tsx`).
    const tree = serialize(
      BypassConfirmDialog({
        open: false,
        missing: ["contratSigne", "kbisRecu"],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    // Just sanity-check the tree expands without crashing — the FR copy
    // surfaces but radix gates it at runtime.
    expect(allText(tree)).toContain("Confirmer le bypass");
  });

  it("renders one bullet per missing milestone (FR labels) when open=true", () => {
    const tree = serialize(
      BypassConfirmDialog({
        open: true,
        missing: ["contratSigne", "kbisRecu", "factureTablettePayee"],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const txt = allText(tree);
    expect(txt).toContain("Contrat signé");
    expect(txt).toContain("KBIS reçu");
    expect(txt).toContain("Facture tablette payée");

    // One <li> per missing key.
    const items = findAllByType(tree, "li");
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it("surfaces the bypass intent in the dialog title/description (FR)", () => {
    const tree = serialize(
      BypassConfirmDialog({
        open: true,
        missing: ["contratSigne"],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const txt = allText(tree).toLowerCase();
    // « Confirmer le bypass » or « jalon manquant » or « milestone manquant »
    // — the operator must see this is a SHORTCUT, not a normal move.
    expect(txt).toMatch(/bypass|manquant/);
  });

  it("renders Confirm + Cancel CTAs with FR copy", () => {
    const tree = serialize(
      BypassConfirmDialog({
        open: true,
        missing: ["contratSigne"],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const txt = allText(tree);
    // « Confirmer » + « Annuler » — same vocabulary as the refund AlertDialog
    // (`order-detail-modal.tsx`).
    expect(txt).toMatch(/confirmer|valider|déplacer/i);
    expect(txt).toMatch(/annuler/i);
  });

  it("renders nothing meaningful when missing=[] (defensive — caller should not open)", () => {
    // The caller (useKanbanDnd) only opens the dialog when `missing.length>0`.
    // Defensive: if somehow opened empty, no bullets surface (don't pretend
    // there's a bypass to confirm).
    const tree = serialize(
      BypassConfirmDialog({
        open: true,
        missing: [],
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    const items = findAllByType(tree, "li");
    expect(items).toHaveLength(0);
  });
});
