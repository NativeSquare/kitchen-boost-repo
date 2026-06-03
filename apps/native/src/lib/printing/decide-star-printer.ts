import type {
  FrozenModifier,
  OrderMode,
} from "@packages/backend/convex/lib/orders";

/**
 * #412 — pure helpers for Star Micronics WebPRNT (PRD 20 §14 + kb-orders
 * CONTEXT « Impression thermique cuisine »). No React, no Convex, no Expo —
 * same `decide-*` convention as `decideForceUpdate` (#394),
 * `decideTenantSwitcher` (#399), `decidePauseControl` (#406). Truth tables
 * are pinned in `decide-star-printer.test.ts`.
 *
 * The Star printer lives on the resto's LAN. The native auto-print at
 * `acknowledge` reads the URL from `getPrinterConfig`, builds a ticket via
 * `buildStarWebPrntTicket`, then POSTs it via `sendStarWebPrntTicket`
 * (`print-order.ts`). The « Tester l'impression » button posts a
 * `buildStarWebPrntTestTicket(tenantName)` payload through the same wrapper.
 */

/**
 * The canonical Star WebPRNT POST path (Star « WebPRNT Browser SDK » Manual
 * §4). The gérant pastes the URL from the printer's web UI; we derive this
 * suffix when they only supply a bare IP (`buildStarWebPrntEndpoint`).
 */
export const STAR_WEB_PRNT_PATH = "/StarWebPRNT/SendMessage";

/**
 * Trim + lowercase the scheme, leave the rest untouched. `HTTP://192…` is a
 * common iOS keyboard auto-capitalize artefact; without this the comparator
 * `currentUrl === input` would diverge on cosmetics.
 */
export function normaliseStarWebPrntUrl(input: string): string {
  const trimmed = input.trim();
  return trimmed.replace(/^https?:\/\//i, (m) => m.toLowerCase());
}

/**
 * Gérant input gate — accepts http/https URLs, rejects everything else.
 *
 * This is the SAME guard the backend `setPrinterConfig` enforces upstream
 * (PRD 20 §14): keeping the rule on BOTH surfaces means a request crafted
 * outside the native form still hits the server check. The URL itself is
 * NOT fetched here — the printer is on a private LAN, and the validation
 * runs synchronously in the form (no network round-trip on every keystroke).
 */
export function isValidStarWebPrntUrl(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed === "") return false;
  return /^https?:\/\//i.test(trimmed);
}

/**
 * Derive `http://<ip>/StarWebPRNT/SendMessage` from a bare IP. Used by the
 * Settings form to suggest a sane default when the gérant types only the
 * printer's address — the suggestion is editable, the gérant can still
 * paste the full URL the printer's web UI advertises.
 */
export function buildStarWebPrntEndpoint(ip: string): string {
  return `http://${ip.trim()}${STAR_WEB_PRNT_PATH}`;
}

/** Settings form inputs the decision function reads. */
export type PrinterConfigFormInputs = {
  /** Raw value of the text field (may contain whitespace / uppercase scheme). */
  input: string;
  /** The URL currently persisted on the tenant (or `null` if none). */
  currentUrl: string | null;
};

/** Verdict consumed by the Settings React surface. */
export type PrinterConfigFormDecision = {
  /** `true` iff the input is valid AND different from `currentUrl`. */
  canSubmit: boolean;
  /** `true` iff the input is valid (irrespective of whether it equals current). */
  canTest: boolean;
  /** What the « URL imprimante » row should display below the input. */
  displayUrl: string;
  /** Human-readable error message, or `null` when the input is valid. */
  error: string | null;
};

/**
 * Pure form-state decider — pinned in `decide-star-printer.test.ts`. Read by
 * `PrinterSettingsScreen` so the React layer stays a thin adapter (Save +
 * Test buttons enabled/disabled state, inline error message).
 *
 * NOTE: an EMPTY input maps to `error: « obligatoire »` only when the gérant
 * is configuring for the first time — but the screen also exposes a separate
 * « Retirer l'imprimante » button bound to `clearPrinterConfig`, so the
 * "delete" path bypasses this form entirely (the form is about SET).
 */
export function decidePrinterConfigForm(
  inputs: PrinterConfigFormInputs,
): PrinterConfigFormDecision {
  const trimmed = inputs.input.trim();

  if (trimmed === "") {
    return {
      canSubmit: false,
      canTest: false,
      displayUrl: "",
      error: "L'adresse de l'imprimante est obligatoire.",
    };
  }

  const normalised = normaliseStarWebPrntUrl(inputs.input);

  if (!isValidStarWebPrntUrl(normalised)) {
    return {
      canSubmit: false,
      canTest: false,
      displayUrl: normalised,
      error:
        "L'adresse doit commencer par http:// ou https:// (ex http://192.168.1.42/StarWebPRNT/SendMessage).",
    };
  }

  const matchesCurrent = inputs.currentUrl === normalised;
  return {
    canSubmit: !matchesCurrent,
    canTest: true,
    displayUrl: normalised,
    error: null,
  };
}

/** One line item the ticket builder reads — flat shape mirroring `orderItems`. */
export type StarPrintItem = {
  quantity: number;
  itemName: string;
  modifiers: readonly FrozenModifier[];
};

/** Inputs `buildStarWebPrntTicket` reads — flat copy of the order detail. */
export type StarPrintInput = {
  tenantName: string;
  /** The order id — its 4-char tail surfaces in the ticket header. */
  orderId: string;
  mode: OrderMode;
  createdAtMs: number;
  items: readonly StarPrintItem[];
  /** Customer note (« sans oignon svp »), optional. */
  restaurantNote?: string;
  /**
   * Total charged amount in CENTS (the `pricingSnapshot.total` of the order).
   * Omitted (`undefined`) for orders without a pricing snapshot yet — the
   * ticket then omits the Total line entirely.
   */
  totalCents?: number;
};

/** Escape XML-significant chars so a customer note can't break the SBP doc. */
function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** fr-FR HH:MM formatter (mirror of `formatPauseEta` for consistency). */
function formatHhMm(ms: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

/** Derive the same 4-char tail the home card surfaces (« Cmd #ABCD »). */
function shortOrderTail(orderId: string): string {
  return orderId.slice(-4).toUpperCase();
}

/** Mode tag rendered above the items (no emoji on the ticket — ESC/POS-safe). */
function modeTagLine(mode: OrderMode): string {
  // Pas d'emoji sur l'imprimante thermique — la plupart des imprimantes Star
  // utilisent du CP437 / Windows-1252 et rendent les caractères non-ASCII en
  // glyphes aléatoires. On garde le mot-clé textuel (PRD 20 §11 « tag
  // visuel »), sans accent pour les imprimantes très basiques.
  return mode === "delivery" ? "*** LIVRAISON ***" : "*** A EMPORTER ***";
}

/** Render one item line + its modifier sub-lines. */
function renderItem(item: StarPrintItem): string {
  const head = `${item.quantity} x ${item.itemName}`;
  if (item.modifiers.length === 0) return escapeXml(head);
  const subs = item.modifiers
    .map((m) => `  - ${m.groupName}: ${m.optionName}`)
    .map(escapeXml)
    .join("\n");
  return `${escapeXml(head)}\n${subs}`;
}

/**
 * Build the ESC/POS-friendly ticket body for ONE order. Returns a
 * `<data>…</data>` XML document — the WebPRNT « SBP » envelope wrapping
 * `<text>…</text>` chunks (Star « WebPRNT Browser SDK » Manual §6).
 *
 * The output is intentionally LINE-ORIENTED ASCII so a Star TSP143 / mC-Print3
 * (the canonical kitchen printers, PRD 20 §14) renders it cleanly without
 * encoding negotiation. A future enhancement could embed boldface / cut
 * commands via raw `<binary>` chunks, but V1 is text-only — Khan's first
 * win is « le ticket sort tout court », polish comes after the field test.
 */
export function buildStarWebPrntTicket(input: StarPrintInput): string {
  const lines: string[] = [];
  lines.push("================================");
  lines.push(escapeXml(input.tenantName));
  lines.push(`Cmd #${shortOrderTail(input.orderId)}`);
  lines.push(formatHhMm(input.createdAtMs));
  lines.push(modeTagLine(input.mode));
  lines.push("--------------------------------");

  for (const item of input.items) {
    lines.push(renderItem(item));
  }

  if (input.restaurantNote !== undefined && input.restaurantNote !== "") {
    lines.push("--------------------------------");
    lines.push("Note client:");
    lines.push(escapeXml(input.restaurantNote));
  }

  if (input.totalCents !== undefined) {
    lines.push("--------------------------------");
    const euros = (input.totalCents / 100).toFixed(2).replace(".", ",");
    lines.push(`Total: ${euros} EUR`);
  }

  lines.push("================================");
  // Wrap the body in the SBP envelope. `\n` at end ensures the printer
  // advances paper one line past the last marker before cutting.
  const body = lines.join("\n") + "\n";
  return `<data><text>${body}</text></data>`;
}

/**
 * Build the test ticket the « Tester l'impression » button POSTs. Same
 * envelope as `buildStarWebPrntTicket` so the gérant sees the same shape
 * appear on the printer — only with a giant « TEST » header so they don't
 * mistake it for a real cmd.
 */
export function buildStarWebPrntTestTicket(tenantName: string): string {
  const body =
    [
      "================================",
      escapeXml(tenantName),
      "*** TEST IMPRESSION ***",
      formatHhMm(Date.now()),
      "--------------------------------",
      "Impression de test depuis KB Orders.",
      "Si tu vois ce ticket, l'imprimante",
      "Star est correctement configuree.",
      "================================",
    ].join("\n") + "\n";
  return `<data><text>${body}</text></data>`;
}

/**
 * Build the URL-encoded form body the WebPRNT endpoint expects. Star's
 * SendMessage handler reads `request=<urlencoded XML>` (« Browser SDK »
 * Manual §4). Returns a string ready to feed `fetch(..., { body })`.
 */
export function buildStarWebPrntRequestBody(ticket: string): string {
  return `request=${encodeURIComponent(ticket)}`;
}

/** Alias kept for the « Tester l'impression » call-site readability. */
export function buildStarWebPrntTestRequestBody(tenantName: string): string {
  return buildStarWebPrntRequestBody(buildStarWebPrntTestTicket(tenantName));
}
