import { afterEach, describe, expect, it, vi } from "vitest";
import { sendStarWebPrntTicket } from "./print-order";

/**
 * #412 — `sendStarWebPrntTicket` is the thin fetch wrapper consumed by the
 * native auto-print (on `acknowledge`), the « Réimprimer » button on the
 * order detail, AND the « Tester l'impression » button in Settings.
 *
 * The contract is intentionally minimal — PRD 20 §14 « fire-and-forget HTTP
 * POST » + « pas de retry auto V1 ». The wrapper returns a verdict the host
 * matches on:
 *
 *  - `ok`        — HTTP 2xx, the ticket reached the printer (probably 200).
 *  - `error`     — anything else: network down, IP unreachable, timeout,
 *                  HTTP 4xx/5xx, abort. The host surfaces a non-blocking
 *                  toast/Alert « Impression échouée, vérifie l'imprimante »
 *                  and the workflow continues uninterrupted (PRD 20 §14).
 *
 * The implementation uses an `AbortController` so a printer that hangs the
 * TCP connection beyond `timeoutMs` does NOT block the cuisinier — the
 * acknowledge mutation already committed, so the cmd is en préparation even
 * if the print never arrives.
 */

describe("#412 sendStarWebPrntTicket — fire-and-forget HTTP POST contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the URL with a `request=` form body carrying the ticket", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const verdict = await sendStarWebPrntTicket({
      url: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: "<data><text>cmd #1234</text></data>",
      timeoutMs: 5_000,
    });

    expect(verdict.kind).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("http://192.168.1.42/StarWebPRNT/SendMessage");
    expect(init?.method).toBe("POST");
    // Headers may be a Record or Headers — both are acceptable in fetch init.
    const headersRecord =
      init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init?.headers as Record<string, string> | undefined);
    expect(headersRecord?.["Content-Type"]).toMatch(
      /application\/x-www-form-urlencoded/i,
    );
    expect(typeof init?.body).toBe("string");
    expect(init?.body as string).toMatch(/^request=/);
    expect(init?.body as string).toContain(encodeURIComponent("<data>"));
    expect(init?.signal).toBeDefined();
  });

  it("returns an error verdict on a network exception (offline LAN, IP unreachable)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Network request failed"),
    );

    const verdict = await sendStarWebPrntTicket({
      url: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: "<data></data>",
      timeoutMs: 1_000,
    });

    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("network");
    }
  });

  it("returns an error verdict on a non-2xx response (printer rejected the payload)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad", { status: 500 }),
    );

    const verdict = await sendStarWebPrntTicket({
      url: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: "<data></data>",
      timeoutMs: 1_000,
    });

    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("http");
      expect(verdict.status).toBe(500);
    }
  });

  it("returns an error verdict on AbortError (timeout fired before printer answered)", async () => {
    // Simulate the AbortController firing — the real implementation calls
    // `setTimeout(() => controller.abort(), timeoutMs)` and fetch rejects
    // with AbortError when the signal aborts.
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    });

    const verdict = await sendStarWebPrntTicket({
      url: "http://192.168.1.42/StarWebPRNT/SendMessage",
      ticket: "<data></data>",
      timeoutMs: 1, // doesn't matter — we abort synchronously in the mock
    });

    expect(verdict.kind).toBe("error");
    if (verdict.kind === "error") {
      expect(verdict.reason).toBe("timeout");
    }
  });
});
