# POC #2 — `web-push` (VAPID) dans une action `"use node"`

**Question.** Une action Convex `"use node"` supporte-t-elle le package `web-push` — c.-à-d. la
génération de clés VAPID et le chiffrement de payload (ECDH P-256 + HKDF + AES-128-GCM) requis par le
Web Push Protocol (RFC 8291) ?

**Gate.** Envoi web-push transactionnel + marketing 2.7 (#54). La route Next.js Node reste le canal
réseau final, mais le **chiffrement** doit tourner quelque part dans la stack.

## Spike (throwaway)

Action `"use node"` (`convex/spikeNode.ts`) important `web-push` et générant une **vraie** paire ECDH
P-256 côté client (sinon `http_ece` rejette la clé) pour exercer tout le chemin de chiffrement :

```ts
"use node";
import nodeCrypto from "node:crypto";
import webpush from "web-push";

export const pocWebPush = action({
  args: {},
  handler: async () => {
    const vapid = webpush.generateVAPIDKeys();
    webpush.setVapidDetails(
      "mailto:ops@kitchen-boost.com",
      vapid.publicKey,
      vapid.privateKey,
    );
    const client = nodeCrypto.createECDH("prime256v1");
    client.generateKeys();
    const sub = {
      endpoint: "https://example.com/push/abc",
      keys: {
        p256dh: client.getPublicKey().toString("base64url"),
        auth: nodeCrypto.randomBytes(16).toString("base64url"),
      },
    };
    const details = webpush.generateRequestDetails(
      sub,
      JSON.stringify({ title: "spike" }),
    );
    return {
      vapidPublicKeyLen: vapid.publicKey.length,
      vapidPrivateKeyLen: vapid.privateKey.length,
      encryptedBodyBytes: details.body.length,
      headerKeys: Object.keys(details.headers),
    };
  },
});
```

## Exécution (dev, 2026-05-26)

```
$ npx convex run spikeNode:pocWebPush
{
  "vapidPublicKeyLen": 87,        ← base64url d'un point P-256 non compressé (65 o)
  "vapidPrivateKeyLen": 43,       ← 32 o
  "encryptedBodyBytes": 135,      ← payload chiffré ECDH+HKDF+AES-128-GCM
  "headerKeys": ["TTL","Content-Length","Content-Type","Content-Encoding","Authorization","Urgency"]
}
```

> Note : un 1ᵉʳ essai avec un `p256dh` bidon avait échoué (`Public key is not valid for specified curve`
> dans `http_ece`) — **la lib tournait**, c'était ma fausse clé. Avec une vraie clé P-256, tout passe.

## Verdict : ✅ OK

- `generateVAPIDKeys` et `setVapidDetails` fonctionnent.
- `generateRequestDetails` produit un corps **chiffré** (135 o) + les headers du Web Push Protocol,
  dont `Authorization` (JWT VAPID) et `Content-Encoding` (aes128gcm) → tout le chemin crypto tourne en `"use node"`.

**Implication 2.7 (#54).** Le chiffrement web-push vit dans une action Convex `"use node"`. La route
Next.js Node (déclenchée par l'action via HMAC) reste le point d'émission réseau vers les endpoints push
navigateur, et c'est elle qui gère le **410 Gone** → opt-out (retour vers 2.1, story #103/#107).
