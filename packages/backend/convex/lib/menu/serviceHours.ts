import { ConvexError, v } from "convex/values";
import { type ServiceWindow, serviceWindow } from "../../table/serviceHours";
import {
  listTenantServiceWindows,
  publicTenantQuery,
  tenantMutation,
  tenantQuery,
  upsertTenantServiceHours,
} from "../tenancy";

/**
 * 2.2-E — Plage horaire de service + `isOpenNow` (PRD 10 §4 / edge "resto fermé",
 * delivery CONTEXT "Plage horaire de service", client-ordering CONTEXT, ADR 0010).
 * OWNED by this chantier (the term is defined in the Delivery glossary but the
 * source of truth — read + write — lives here).
 *
 * KB is the SOURCE OF TRUTH of the resto's opening. The kb_manager edits the
 * windows from KB Admin (`set` / `get`, tenant-scoped); the PWA checkout reads
 * `isOpenNow` (PUBLIC, unauthenticated) to gate payment — out of window ⇒ checkout
 * BLOCKED (the blocking UX itself is out of scope here, PRD).
 *
 * V1 = a SINGLE shared slot for BOTH delivery AND click & collect (Q40-Q acté
 * 2026-05-24), timezone `Europe/Paris` (FR-only). Windows do NOT span midnight.
 *
 * The open/closed decision is a PURE function (`isWithinServiceHours`: windows +
 * clock → boolean), so it is testable deterministically on injected timestamps
 * (never the real wall-clock). The Convex `isOpenNow` simply feeds it the tenant's
 * persisted windows + `Date.now()`.
 *
 * Timezone handling: the local Europe/Paris day-of-week + minute-of-day are
 * derived with the built-in `Intl.DateTimeFormat({ timeZone: "Europe/Paris" })`,
 * which reads the same IANA tz database `date-fns-tz` (STACK §4.1) wraps and
 * handles the CET/CEST DST transition automatically — so no extra dependency is
 * pulled into the Convex V8 runtime for what the platform already does natively.
 * No holiday/exception rules are applied (none are specified in the PRD — not
 * invented).
 */

const PARIS_TZ = "Europe/Paris";

/** JS `Date.getDay()` order, indexed by `Intl`'s English short weekday. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Minutes in a full day; the exclusive upper bound for a window minute. */
const MINUTES_PER_DAY = 1440;

/** The local Europe/Paris wall-clock derived from a UTC instant. */
export type ParisLocalParts = {
  /** 0 = Sunday … 6 = Saturday (JS `Date.getDay()` convention). */
  dayOfWeek: number;
  /** Minutes from local midnight (0–1439). */
  minuteOfDay: number;
};

/**
 * Project a UTC timestamp (ms) to the local Europe/Paris day-of-week +
 * minute-of-day. Deterministic for a given instant (no hidden wall-clock): the
 * tz offset (CET/CEST) is resolved from the instant itself via the IANA tz data,
 * so DST is handled correctly without any per-window tz field.
 */
export function parisLocalParts(nowMs: number): ParisLocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  let weekday = "";
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === "weekday") weekday = part.value;
    else if (part.type === "hour") {
      // `Intl` can emit "24" for midnight in some engines; normalise to 0.
      hour = Number(part.value) % 24;
    } else if (part.type === "minute") minute = Number(part.value);
  }

  return {
    dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
  };
}

/**
 * Whether `nowMs` falls inside any open window, evaluated in Europe/Paris. PURE
 * (no I/O, no wall-clock) — the single decision point gated by the checkout.
 *
 * A window matches when the local day equals `dayOfWeek` AND the local
 * minute-of-day is in `[startMinute, endMinute)` — start INCLUSIVE, end
 * EXCLUSIVE (at the closing minute the resto no longer accepts orders). No
 * windows ⇒ always closed (a non-configured resto never opens).
 */
export function isWithinServiceHours(
  windows: ServiceWindow[],
  nowMs: number,
): boolean {
  const { dayOfWeek, minuteOfDay } = parisLocalParts(nowMs);
  return windows.some(
    (w) =>
      w.dayOfWeek === dayOfWeek &&
      minuteOfDay >= w.startMinute &&
      minuteOfDay < w.endMinute,
  );
}

/**
 * Save-time validation of a windows list (the ONLY product rules, NOT invented):
 * `dayOfWeek` ∈ 0..6, `startMinute` / `endMinute` integers in 0..1440, and
 * `startMinute < endMinute` (V1 windows do not span midnight). An EMPTY list is
 * valid (a resto with no hours yet = always closed). Throws a typed
 * `ConvexError` the front can branch on.
 */
export function assertServiceWindows(windows: ServiceWindow[]): void {
  for (const w of windows) {
    if (!Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6) {
      throw new ConvexError({
        code: "INVALID_SERVICE_HOURS",
        message: "dayOfWeek must be an integer in 0..6 (0=Sunday).",
      });
    }
    for (const [label, value] of [
      ["startMinute", w.startMinute],
      ["endMinute", w.endMinute],
    ] as const) {
      if (!Number.isInteger(value) || value < 0 || value > MINUTES_PER_DAY) {
        throw new ConvexError({
          code: "INVALID_SERVICE_HOURS",
          message: `${label} must be an integer in 0..${MINUTES_PER_DAY} (minutes from midnight).`,
        });
      }
    }
    if (w.startMinute >= w.endMinute) {
      throw new ConvexError({
        code: "INVALID_SERVICE_HOURS",
        message:
          "startMinute must be strictly before endMinute (V1 windows do not span midnight).",
      });
    }
  }
}

/** A tenant's service hours as the editor / PWA consume them. */
export type ServiceHours = { windows: ServiceWindow[] };

// --- Convex surface ----------------------------------------------------------

/**
 * Read the calling tenant's service hours (kb_manager). Returns an EMPTY windows
 * list when none configured yet — the front renders "no hours set".
 */
export const get = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<ServiceHours> => ({
    windows: await listTenantServiceWindows(ctx, ctx.tenantId),
  }),
});

/**
 * Replace the calling tenant's service hours (kb_manager). UPSERT (one row per
 * tenant). Refuses invalid windows BEFORE writing. Audited (a schedule change
 * gates whether the resto can take orders at all).
 */
export const set = tenantMutation()({
  args: { windows: v.array(serviceWindow) },
  audit: true,
  action: "serviceHours.set",
  handler: async (ctx, args): Promise<void> => {
    assertServiceWindows(args.windows);
    await upsertTenantServiceHours(ctx, ctx.tenantId, args.windows);
  },
});

/**
 * PUBLIC, unauthenticated read consumed by the PWA checkout to gate payment:
 * `true` iff the tenant is currently within a service window (Europe/Paris), else
 * `false` (incl. a tenant with no hours configured). Tenant-scoped by
 * construction (windows read through the sanctioned store seam keyed on
 * `ctx.tenantId`), so a tenant's hours can NEVER gate another tenant (ADR 0010).
 */
export const isOpenNow = publicTenantQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const windows = await listTenantServiceWindows(ctx, ctx.tenantId);
    return isWithinServiceHours(windows, Date.now());
  },
});
