# POC #1 — `httpAction` préserve le raw body (vérif HMAC Stripe/Uber)

**Question.** Un `httpAction` Convex préserve-t-il le corps brut de la requête (`await request.text()`)
**avant** tout parse, pour qu'on puisse vérifier une signature HMAC (Stripe `Stripe-Signature`,
Uber webhook signature) sur les octets exacts reçus ?

**Gate.** Webhooks 2.5 (Stripe `payment_intent.*`, `account.updated`, `charge.dispute.created`)
et 2.6 (Uber Direct delivery status). Sans raw body fidèle, toute vérif de signature échoue.

## Spike (throwaway)

Route ajoutée dans `convex/http.ts` (runtime Convex **par défaut**, pas `"use node"` → pas de
`node:crypto`, mais **Web Crypto `crypto.subtle`** est dispo — c'est le chemin réel de prod) :

```ts
http.route({
  path: "/spike/rawbody",
  method: "POST",
  handler: httpAction(async (_ctx, req) => {
    const raw = await req.text(); // corps brut, pré-parse
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("spikesecret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(raw),
    );
    const hmac = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return Response.json({ rawLen: raw.length, raw, hmac });
  }),
});
```

## Exécution (dev, 2026-05-26)

Corps envoyé volontairement « sale » — espaces internes, ordre des clés `b` avant `a`, newline final —
de sorte qu'un `JSON.parse` → `JSON.stringify` le **modifierait** :

```
$ xxd body.json
7b22 6222 3a20 312c 2020 2022 6122 3a20 2032 7d0a   → {"b": 1,   "a":  2}\n   (20 octets)

$ curl -X POST $SITE/spike/rawbody --data-binary @body.json
{"rawLen":20,"raw":"{\"b\": 1,   \"a\":  2}\n","hmac":"0ce61095a47e861fa877f68e1f9953c41e7f37fbc1a90d2d7dc2a8fdd80be24c"}

$ openssl dgst -sha256 -hmac "spikesecret" body.json
0ce61095a47e861fa877f68e1f9953c41e7f37fbc1a90d2d7dc2a8fdd80be24c   ← MATCH
```

## Verdict : ✅ OK

- `await request.text()` renvoie les **20 octets exacts** envoyés (espaces + ordre + `\n` final préservés).
- Le HMAC-SHA256 calculé côté serveur (Web Crypto) est **identique** à celui calculé localement par
  openssl sur les mêmes octets → la vérif de signature webhook fonctionne.
- **Pas besoin de `"use node"`** : le runtime Convex par défaut suffit (`httpAction` + `crypto.subtle`).
  C'est aussi cohérent avec la crypto `crypto.subtle` déjà validée en foundation.

**Implication 2.5/2.6.** Vérifier la signature sur `await req.text()`, puis `JSON.parse` ensuite. Ne jamais
parser avant la vérif. Idempotence via la table `processedWebhookEvents` (déjà au schéma).
