/**
 * PWA-S6b (#456) — `urlBase64ToUint8Array` — convert the VAPID server public
 * key (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, RFC 8292) from its url-safe base64
 * encoding into the raw `Uint8Array` that `PushManager.subscribe` accepts in
 * `applicationServerKey`.
 *
 * Safari rejects the string form on iOS 16.4+ — the Uint8Array form is the
 * portable contract across Chromium / Safari / Firefox. The web-push lib
 * emits VAPID public keys in url-safe base64 (no padding); we re-pad and
 * substitute `-`/`_` before piping through `atob`.
 *
 * `atob` is in the global scope on Node 16+, so this file is node-pinnable
 * for vitest in addition to being usable in the browser bundle.
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array {
  if (base64UrlString === "") return new Uint8Array(0);
  // Re-pad to a multiple of 4 (atob requires padding).
  const padLen = (4 - (base64UrlString.length % 4)) % 4;
  const padded = base64UrlString + "=".repeat(padLen);
  // url-safe → standard base64 alphabet.
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(standard);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
