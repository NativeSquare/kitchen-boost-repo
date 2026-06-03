import { afterEach, describe, expect, it, vi } from "vitest";
import { printOrderTicket } from "./print-order-helper";

/**
 * #412 — Acceptance-level tests for `printOrderTicket`, the single entry
 * point the order detail screen consumes for BOTH auto-print on
 * `acknowledge` AND the « Réimprimer » button.
 *
 * These three scenarios mirror the PRD 20 §14 acceptance criteria for #412
 * (« 1-3 tests E2E contre le simulator Star WebPRNT ») — we substitute the
 * Star simulator with a `fetch` spy so the test runs in CI without LAN
 * hardware. The wire format + the verdict matrix are exhaustively pinned in
 * `decide-star-printer.test.ts` / `print-order.test.ts`; this suite pins
 * the END-TO-END contract the React layer relies on:
 *
 *  (a) ack → ticket envoyé au printer + contenu vérifié (tenant name,
 *      order id tail, items, total) ;
 *  (b) reprint depuis détail cmd (same call, separate verdict surface) ;
 *  (c) pas d'imprimante configurée → no-op silencieux (PRD 20 §14) ;
 *  (d) IP invalide / unreachable → verdict error → toast erreur, pas de crash.
 */

const baseTicket = {
  tenantName: "Buns and Bao",
  orderId: "ord-abc1234",
  mode: "delivery" as const,
  createdAtMs: new Date(2026, 0, 15, 19, 5, 0, 0).getTime(),
  items: [
    {
      quantity: 2,
      itemName: "Smash Double",
      modifiers: [{ groupName: "Sauce", optionName: "Ketchup", priceDelta: 0 }],
    },
  ],
  restaurantNote: "Sans oignon svp",
  totalCents: 2580,
};

describe("#412 printOrderTicket — end-to-end auto-print + Réimprimer contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) ack → POST au printer avec un body contenant tenant + items + total (acceptance #412 a)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const verdict = await printOrderTicket({
      starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: baseTicket,
      timeoutMs: 5_000,
    });

    expect(verdict.kind).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    // The form body carries an URL-encoded SBP envelope — once decoded,
    // every PRD 20 §14 contract field must be present.
    const body = init?.body as string;
    expect(body).toMatch(/^request=/);
    const decoded = decodeURIComponent(body.slice("request=".length));
    expect(decoded).toContain("Buns and Bao");
    expect(decoded).toContain("Cmd #1234");
    expect(decoded).toContain("LIVRAISON");
    expect(decoded).toContain("2 x Smash Double");
    expect(decoded).toContain("Sauce: Ketchup");
    expect(decoded).toContain("Sans oignon svp");
    expect(decoded).toContain("25,80");
  });

  it("(b) reprint depuis détail cmd → même contrat (le helper est l'unique chemin)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    // Two consecutive calls — the « Réimprimer » button re-fires the same
    // payload (PRD 20 §4 « Bouton Réimprimer »). The helper has no internal
    // state, so 2 calls = 2 fetches, both succeed independently.
    const first = await printOrderTicket({
      starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: baseTicket,
      timeoutMs: 5_000,
    });
    const second = await printOrderTicket({
      starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: baseTicket,
      timeoutMs: 5_000,
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("(c) pas d'imprimante configurée → no-op silencieux (PRD 20 §14)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const verdict = await printOrderTicket({
      starWebPrntUrl: null,
      ticket: baseTicket,
      timeoutMs: 5_000,
    });

    expect(verdict.kind).toBe("no-printer");
    // PRD 20 §14 « fire-and-forget HTTP POST vers l'imprimante » — if no
    // printer is configured, we MUST NOT issue any HTTP call. The acknowledge
    // mutation has committed regardless, so the cmd is en préparation.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("(d) IP invalide / unreachable → verdict error (host surfaces non-blocking toast)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Network request failed"),
    );

    const verdict = await printOrderTicket({
      starWebPrntUrl: "http://192.168.0.99/StarWebPRNT/SendMessage",
      ticket: baseTicket,
      timeoutMs: 1_000,
    });

    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("network");
    }
    // The host (OrderDetailScreen) catches `kind === "error"` and surfaces
    // an Alert.alert « Impression échouée — vérifie l'imprimante ». PRD 20
    // §14 « pas un blocker pour accepter la cmd »: the helper returns —
    // doesn't throw — so the workflow control flow is untouched.
  });
});
