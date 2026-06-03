import { buildStarWebPrntRequestBody } from "./decide-star-printer";

/**
 * #412 — `sendStarWebPrntTicket` — the thin fetch wrapper consumed by every
 * native print surface (auto-print on `acknowledge`, « Réimprimer » button on
 * the order detail, « Tester l'impression » button in Settings).
 *
 * PRD 20 §14 « pas de retry auto V1 » — the wrapper does NOT retry; it
 * returns a verdict the host matches on:
 *
 *  - `ok`        — HTTP 2xx, the ticket reached the printer.
 *  - `error`     — anything else: network down, IP unreachable, timeout,
 *                  HTTP 4xx/5xx. The host surfaces a non-blocking
 *                  Alert / toast « Impression échouée, vérifie l'imprimante »
 *                  and the workflow continues uninterrupted.
 *
 * The cuisinier safety property: even if the print never arrives, the
 * underlying mutation (`acknowledge`) has already committed BEFORE we call
 * this wrapper, so the order is in `en préparation` whether or not the LAN
 * POST succeeds. The « Réimprimer » button on the order detail is the
 * manual recourse (PRD 20 §14 « Khan peut lire la cmd à l'écran »).
 *
 * `AbortController` + `setTimeout(controller.abort, timeoutMs)` guards the
 * Star printer that hangs the TCP connection beyond the timeout — without
 * this, a frozen `fetch` would leak indefinitely after the React component
 * unmounts (the cuisinier moved off the home / detail).
 */

export type StarWebPrntSendInput = {
  url: string;
  ticket: string;
  /** Milliseconds before the fetch is aborted with AbortError. */
  timeoutMs: number;
};

export type StarWebPrntSendVerdict =
  | { kind: "ok" }
  | { kind: "error"; reason: "network" | "http" | "timeout"; status?: number };

export async function sendStarWebPrntTicket(
  input: StarWebPrntSendInput,
): Promise<StarWebPrntSendVerdict> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs);

  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildStarWebPrntRequestBody(input.ticket),
      signal: controller.signal,
    });

    if (response.ok) {
      return { kind: "ok" };
    }
    return { kind: "error", reason: "http", status: response.status };
  } catch (err) {
    // AbortError → timeout fired. AbortController.abort() rejects fetch
    // with an Error named "AbortError" (RN/Web), or a DOMException with
    // the same name — match on name to keep platform-independence.
    if (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      return { kind: "error", reason: "timeout" };
    }
    return { kind: "error", reason: "network" };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** Default timeout: 5s — same order of magnitude as a Star LAN print. */
export const DEFAULT_STAR_PRINT_TIMEOUT_MS = 5_000;
