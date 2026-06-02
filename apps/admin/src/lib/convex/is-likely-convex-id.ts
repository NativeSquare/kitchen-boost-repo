/**
 * `isLikelyConvexId` — page-level guard for URL segments that get fed straight
 * into a `v.id("…")` validator on a Convex query.
 *
 * Without this guard, a syntactically invalid `[id]` segment (e.g. someone
 * hand-mangles the URL, or pastes a stale link from a v0 bookmark format)
 * makes Convex throw `ArgumentValidationError: Value does not match validator`
 * at the call site — the React tree crashes instead of rendering the regular
 * "not found" branch that we already show for resolved-null queries.
 *
 * The check is a CHEAP shape check, not a real verifier. The real validator
 * still lives in the backend (`v.id("foo")` enforces tableName + format on
 * the server). The only job of this function is to short-circuit at the
 * boundary so we can pass `"skip"` to `useTenantQuery` and render the same
 * "Lancement introuvable" / "Introuvable" UI we already show for a launchId
 * that belongs to another tenant.
 *
 * Format: Convex document IDs in this codebase are 32 lowercase alphanumeric
 * characters (e.g. `kn7bfqjem442c1dzqdjjmcfyxx87q53j`). We deliberately keep
 * the regex loose w.r.t. the alphabet (lowercase + digit) rather than pinning
 * the actual base32 alphabet — the goal is to reject obviously-malformed
 * strings (wrong length, uppercase, dashes, hex prefixes…), not to replicate
 * the server-side validator. Anything that passes this shape check and still
 * doesn't match a real document will resolve to `null` server-side, which the
 * UI already handles.
 *
 * Returned `true` ⇒ safe to cast to `Id<"…">` and forward to a Convex query.
 * Returned `false` ⇒ render the not-found branch directly, do NOT call the
 * query.
 */
const CONVEX_DOC_ID_SHAPE = /^[a-z0-9]{32}$/;

export function isLikelyConvexId(value: unknown): value is string {
  return typeof value === "string" && CONVEX_DOC_ID_SHAPE.test(value);
}
