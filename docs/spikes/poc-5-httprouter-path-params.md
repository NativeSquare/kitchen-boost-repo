# POC #5 — `httpRouter` et routing per-tenant (`/webhooks/uber/:tenantId`)

**Question.** Le `httpRouter` de Convex supporte-t-il des path params nommés type Express
(`/webhooks/uber/:tenantId`) pour router un webhook Uber Direct vers le bon tenant ?

**Gate.** Webhook Uber Direct **per-tenant** 2.6 (#48) — chaque resto a son propre compte Uber, donc
chaque webhook doit identifier le tenant depuis l'URL.

## Constat sur l'API

`http.route(...)` n'accepte que **`path`** (match exact) **ou** **`pathPrefix`** (préfixe terminé par `/`).
Il n'y a **pas** de syntaxe `:param` nommée. → la question littérale = **NON**.

Mais l'objectif (router par tenant depuis l'URL) s'obtient trivialement avec `pathPrefix` + parse manuel.

## Spike (throwaway)

```ts
http.route({
  pathPrefix: "/webhooks/uber/",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const tenantId = new URL(req.url).pathname.split("/").pop() ?? "";
    return Response.json({ tenantId, matchedVia: "pathPrefix" });
  }),
});
```

## Exécution (dev, 2026-05-26)

```
$ curl $SITE/webhooks/uber/tenant_ABC123   → {"tenantId":"tenant_ABC123","matchedVia":"pathPrefix"}
$ curl $SITE/webhooks/uber/acct_resto_42   → {"tenantId":"acct_resto_42","matchedVia":"pathPrefix"}
```

## Verdict : ✅ OK via `pathPrefix` (fallback trivial, pas d'offload)

- Path param nommé natif : **non supporté**.
- Routing per-tenant : **oui**, via `pathPrefix: "/webhooks/uber/"` + `new URL(req.url).pathname` parse.
  Aucun offload Next.js Node nécessaire.

**Implication 2.6 (#48).** Adopter le pattern `pathPrefix` + extraction du `tenantId` en fin de path,
puis résolution du tenant + vérif de la signature Uber (cf. [POC #1](poc-1-httpaction-raw-body.md)) sur
le raw body **avant** parse. Valider que le `tenantId` extrait correspond à un tenant connu (sinon 404)
avant tout traitement.
