/**
 * 1.x-E — envelope encryption of per-tenant secrets (e.g. Uber Direct
 * credentials), the in-house alternative to an external KMS for V1 (STACK.md
 * §2.5; an external KMS is deferred to V2 past ~5 tenants, §8).
 *
 * One master key lives in the Convex deployment env var `KMS_MASTER_KEY` (a
 * 32-byte / 256-bit key, base64-encoded — STACK.md §4.6). Each secret is sealed
 * with AES-256-GCM via the Web Crypto API (`crypto.subtle`), which is available
 * in the Convex V8 runtime and in the edge-runtime test environment (verified).
 * No Node `crypto` and no `"use node"` action are needed — AES-GCM here is light
 * Web Crypto, NOT the heavy native crypto (PKCS#7 `.pkpass`, web-push ECDH) that
 * STACK.md §2.3 offloads to Next.js Node routes.
 *
 * A blob is the structured `{ iv, authTag, ciphertext, keyVersion }`; the same
 * four parts also serialise to a single packed string in the order
 * `iv(12B) + authTag(16B) + ciphertext(nB) + keyVersion(4B)` (`packBlob` /
 * `unpackBlob`). The persisted `tenantCredentials` row stores the structured
 * form (one column each); the packed form is offered for callers that want a
 * single opaque token.
 *
 * SECURITY: this module only ever returns ciphertext from `encryptForTenant` and
 * only ever returns plaintext from `decryptForTenant`. `decryptForTenant` MUST
 * be called from a Convex action only (never an exposed query) — see
 * `credentials.ts`. GCM's auth tag makes any tampering (ciphertext, tag, or iv)
 * fail decryption rather than yield garbage.
 */

/** Current master-key version, stamped on every blob for future rotation. */
export const KEY_VERSION = 1;

/** Byte lengths of the fixed-size GCM parameters. */
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const TAG_BYTES = 16; // 128-bit auth tag
const KEY_VERSION_BYTES = 4; // uint32, big-endian, trailer of the packed blob

/** The structured, at-rest representation of one sealed secret. */
export type EncryptedBlob = {
  /** base64 of the 12-byte random nonce. */
  iv: string;
  /** base64 of the 16-byte GCM authentication tag. */
  authTag: string;
  /** base64 of the AES-GCM ciphertext (tag NOT included). */
  ciphertext: string;
  /** Master-key version used to seal this blob. */
  keyVersion: number;
};

// --- base64 <-> bytes (runtime-agnostic: atob/btoa exist in V8 + edge) -------
//
// Helpers return/accept `Uint8Array<ArrayBuffer>` (an ArrayBuffer-backed view)
// so they satisfy `crypto.subtle`'s `BufferSource` parameter under TS strict
// (a plain `Uint8Array` is typed as `ArrayBufferLike`, which TS rejects because
// it could be a `SharedArrayBuffer`).

type Bytes = Uint8Array<ArrayBuffer>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Bytes {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length)) as Bytes;
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- master key --------------------------------------------------------------

/**
 * Load + import the master key from `KMS_MASTER_KEY` (base64, exactly 32 bytes).
 * Throws (rather than silently weakening to a shorter key) if the env var is
 * absent or the wrong size — a misconfiguration must fail loud, not produce
 * undecryptable data.
 */
async function importMasterKey(): Promise<CryptoKey> {
  const raw = process.env.KMS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "KMS_MASTER_KEY is not set — cannot encrypt/decrypt tenant secrets.",
    );
  }
  const keyBytes = base64ToBytes(raw);
  if (keyBytes.length !== 32) {
    throw new Error(
      `KMS_MASTER_KEY must decode to 32 bytes (AES-256); got ${keyBytes.length}.`,
    );
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// --- encrypt / decrypt --------------------------------------------------------

/**
 * Seal `plaintext` under the current master key. Returns the structured blob
 * (never the plaintext). A fresh random 96-bit nonce is drawn per call, so
 * encrypting the same value twice yields different ciphertext (no nonce reuse).
 */
export async function encryptForTenant(
  plaintext: string,
): Promise<EncryptedBlob> {
  const key = await importMasterKey();
  const iv = crypto.getRandomValues(
    new Uint8Array(new ArrayBuffer(IV_BYTES)) as Bytes,
  );
  const data = new Uint8Array(
    new TextEncoder().encode(plaintext),
  ) as unknown as Bytes;

  // crypto.subtle returns ciphertext WITH the auth tag appended (last 16 bytes).
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
      key,
      data,
    ),
  );
  const cipherBytes = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tagBytes = sealed.subarray(sealed.length - TAG_BYTES);

  return {
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(tagBytes),
    ciphertext: bytesToBase64(cipherBytes),
    keyVersion: KEY_VERSION,
  };
}

/**
 * Open a sealed blob and return the original plaintext. Throws if the blob has
 * been tampered with (GCM verifies the auth tag) or if the key version is
 * unknown. CALL FROM A CONVEX ACTION ONLY — never an exposed query.
 */
export async function decryptForTenant(blob: EncryptedBlob): Promise<string> {
  if (blob.keyVersion !== KEY_VERSION) {
    throw new Error(`Unknown KMS key version: ${blob.keyVersion}.`);
  }
  const key = await importMasterKey();
  const iv = base64ToBytes(blob.iv);
  const cipherBytes = base64ToBytes(blob.ciphertext);
  const tagBytes = base64ToBytes(blob.authTag);

  // Re-join ciphertext + tag in the layout crypto.subtle.decrypt expects.
  const sealed = new Uint8Array(
    new ArrayBuffer(cipherBytes.length + tagBytes.length),
  ) as Bytes;
  sealed.set(cipherBytes, 0);
  sealed.set(tagBytes, cipherBytes.length);

  // Throws OperationError on any tamper (ciphertext / tag / iv) — we let it
  // propagate so a forged secret can never decrypt to a usable value.
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: TAG_BYTES * 8 },
    key,
    sealed,
  );
  return new TextDecoder().decode(opened);
}

// --- packed single-string form: iv + authTag + ciphertext + keyVersion -------

/** Serialise a structured blob to one base64 string (the documented layout). */
export function packBlob(blob: EncryptedBlob): string {
  const iv = base64ToBytes(blob.iv);
  const tag = base64ToBytes(blob.authTag);
  const cipher = base64ToBytes(blob.ciphertext);

  const out = new Uint8Array(
    IV_BYTES + TAG_BYTES + cipher.length + KEY_VERSION_BYTES,
  );
  let offset = 0;
  out.set(iv, offset);
  offset += IV_BYTES;
  out.set(tag, offset);
  offset += TAG_BYTES;
  out.set(cipher, offset);
  offset += cipher.length;
  // keyVersion as a big-endian uint32 trailer.
  new DataView(out.buffer).setUint32(offset, blob.keyVersion, false);

  return bytesToBase64(out);
}

/** Parse a packed string back to the structured blob. */
export function unpackBlob(packed: string): EncryptedBlob {
  const bytes = base64ToBytes(packed);
  const min = IV_BYTES + TAG_BYTES + KEY_VERSION_BYTES;
  if (bytes.length < min) {
    throw new Error("Malformed packed blob: too short.");
  }
  const cipherLen = bytes.length - min;

  let offset = 0;
  const iv = bytes.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = bytes.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const cipher = bytes.subarray(offset, offset + cipherLen);
  offset += cipherLen;
  const keyVersion = new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    KEY_VERSION_BYTES,
  ).getUint32(0, false);

  return {
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(tag),
    ciphertext: bytesToBase64(cipher),
    keyVersion,
  };
}
