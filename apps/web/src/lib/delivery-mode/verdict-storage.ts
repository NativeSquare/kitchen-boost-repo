/**
 * PWA-S5 (#453) — pure encode/decode helpers for the cached
 * `DeliveryQuoteVerdict` persisted to localStorage by `<AddressFirstForm>`
 * (S3, after this slice patches it) and consumed by
 * `<DeliveryModeProvider>` (S5).
 *
 * The functions are PURE (string ↔ verdict | null); the localStorage IO
 * lives in `<DeliveryModeProvider>`. Defensive parsing returns `null` on
 * any shape mismatch — the toggle then falls back to its « no S3 »
 * safe default (C&C, livraison disabled) instead of crashing.
 *
 * Same defensive pattern as `<CartProvider>.safeReadFromStorage` (S4)
 * for the cart payload — the verdict is a buffer, not a SoT (latching
 * mutation `recaptureQuoteAtPayment` is the true safety net at payment).
 */
import type {
  DeliveryQuoteReason,
  DeliveryQuoteVerdict,
} from "@/lib/address-first";

/** Single source of truth for the localStorage key. */
export const VERDICT_STORAGE_KEY = "kb-delivery-verdict-v1";

const KNOWN_REASONS: ReadonlySet<DeliveryQuoteReason> = new Set([
  "hors_zone",
  "hors_horaire",
  "surge",
]);

/** Serialise a verdict to its storage string. */
export function encodeVerdict(verdict: DeliveryQuoteVerdict): string {
  return JSON.stringify(verdict);
}

/**
 * Parse a verdict string back to a verdict, or return `null` if the
 * payload is missing / corrupted / shape-mismatched / has an unknown
 * reason / has a wrongly-typed fee/eta/quoteId.
 */
export function decodeVerdict(raw: string | null): DeliveryQuoteVerdict | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.deliverable !== "boolean") return null;
  if (obj.deliverable === true) {
    if (
      typeof obj.fee !== "number" ||
      typeof obj.eta !== "number" ||
      typeof obj.quoteId !== "string"
    ) {
      return null;
    }
    return {
      deliverable: true,
      fee: obj.fee,
      eta: obj.eta,
      quoteId: obj.quoteId,
    };
  }
  if (typeof obj.reason !== "string") return null;
  if (!KNOWN_REASONS.has(obj.reason as DeliveryQuoteReason)) return null;
  return {
    deliverable: false,
    reason: obj.reason as DeliveryQuoteReason,
  };
}
