import {
  buildStarWebPrntTicket,
  type StarPrintInput,
} from "./decide-star-printer";
import {
  DEFAULT_STAR_PRINT_TIMEOUT_MS,
  sendStarWebPrntTicket,
  type StarWebPrntSendVerdict,
} from "./print-order";

/**
 * #412 — `printOrderTicket` — single entry point both the auto-print on
 * `acknowledge` AND the « Réimprimer » button on the order detail consume.
 *
 * The function:
 *  1. early-returns `{ kind: "no-printer" }` if the tenant has no
 *     `starWebPrntUrl` configured (PRD 20 §14 « no-op silencieux »);
 *  2. builds the ESC/POS ticket via `buildStarWebPrntTicket` (pure);
 *  3. POSTs the WebPRNT payload via `sendStarWebPrntTicket` (timeout-guarded);
 *  4. returns the verdict so the host can surface the non-blocking toast.
 *
 * Keeping the orchestration HERE (and not inline in the detail screen) means
 * the auto-print and the manual reprint share IDENTICAL behaviour — same
 * payload shape, same timeout, same skip-when-no-printer logic. The host
 * only decides « when to fire » and « how to surface a failure to the
 * cuisinier ». PRD 20 §14 « pas de retry auto V1 » lives here too: the
 * wrapper doesn't retry, the host doesn't either.
 */

export type PrintOrderInput = {
  /** The Star WebPRNT URL persisted on the tenant, or `null` (no printer). */
  starWebPrntUrl: string | null;
  /** The order payload — same shape as `StarPrintInput`. */
  ticket: StarPrintInput;
  /** Override the default 5s timeout (rarely needed; tests inject smaller). */
  timeoutMs?: number;
};

export type PrintOrderVerdict =
  | { kind: "no-printer" }
  | { kind: "ok" }
  | { kind: "error"; reason: "network" | "http" | "timeout"; status?: number };

export async function printOrderTicket(
  input: PrintOrderInput,
): Promise<PrintOrderVerdict> {
  if (input.starWebPrntUrl === null || input.starWebPrntUrl === "") {
    return { kind: "no-printer" };
  }
  const ticketBody = buildStarWebPrntTicket(input.ticket);
  const verdict: StarWebPrntSendVerdict = await sendStarWebPrntTicket({
    url: input.starWebPrntUrl,
    ticket: ticketBody,
    timeoutMs: input.timeoutMs ?? DEFAULT_STAR_PRINT_TIMEOUT_MS,
  });
  if (verdict.kind === "ok") return { kind: "ok" };
  return { kind: "error", reason: verdict.reason, status: verdict.status };
}
