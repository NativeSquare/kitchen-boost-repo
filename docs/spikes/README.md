# Spikes sprint 0 — verdicts (POC #25)

Validation de la **forme runtime** de la stack Phase 2 avant d'écrire le code métier des intégrations
(réf [STACK §7](../contexts/_architecture/STACK.md)). Chaque POC = une question runtime + un verdict
**OK** (la stack tient telle quelle) ou **fallback** (on offload sur Next.js Node, documenté).

Exécutés le **2026-05-26** contre le déploiement Convex **dev** (`impartial-goshawk-798`, eu-west-1),
Convex 1.31.7 / Node 22. Le code spike était throwaway : déployé sur le dev, exercé pour de vrai,
puis supprimé. `main` ne contient que ces docs verdict (la preuve), pas le code spike — chaque story
d'intégration (2.5–2.8) ré-ajoute ses propres deps via sa PR.

| POC                                   | Question                                                   | Gate                   | Verdict                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [#1](poc-1-httpaction-raw-body.md)    | `httpAction` préserve le raw body pour vérif HMAC ?        | webhooks 2.5 / 2.6     | ✅ **OK** (Web Crypto, runtime par défaut)                                                                                         |
| [#2](poc-2-web-push-use-node.md)      | `"use node"` supporte `web-push` (VAPID/ECDH/AES-GCM) ?    | envoi 2.7              | ✅ **OK**                                                                                                                          |
| [#3](poc-3-passkit-use-node.md)       | `"use node"` supporte `passkit-generator` (PKCS#7) ?       | génération 2.8         | ✅ **OK** (signature réelle = e2e device)                                                                                          |
| #4                                    | ~~cookie cross-sous-domaine~~                              | —                      | ⛔ **RETIRÉ 2026-05-25** (domaine de marque custom par resto — [ADR 0008](../adr/0008-identite-customer-cookie-device-only-v1.md)) |
| [#5](poc-5-httprouter-path-params.md) | `httpRouter` supporte les path params per-tenant ?         | webhook per-tenant 2.6 | ✅ **OK via `pathPrefix`** (`:param` natif non supporté)                                                                           |
| [W](poc-wallet-real-sign.md)          | signature Wallet **réelle** (Apple `.pkpass` + Google JWT) | génération 2.8 (#68)   | ✅ **OK** (vrais certs ; install device = e2e manuel)                                                                              |
| [#6](poc-6-stripe-clone.md)           | clone Stripe `PaymentMethod` cross-account ?               | saved-card 2.5 (#59)   | ✅ **OK** (Connect activé, profil platform ; #59 validé)                                                                           |

**Bilan : aucun POC en échec → aucun offload Next.js Node requis pour 2.5/2.6/2.7/2.8.**
La crypto webhook vit dans le runtime Convex par défaut (`httpAction` + `crypto.subtle`) ; web-push et
passkit-generator vivent dans des actions `"use node"`.

**Phase B (secrets réels, 2026-05-26) — TERMINÉE :**

- Signature Wallet Apple + Google validée avec les vrais certs → **#68 `ready-for-agent`** (chaîne Wallet ouverte).
- POC #6 clone Stripe cross-account validé (Stripe **Connect activé**, profil **platform** = frais à la charge du resto = direct charge) → **#59 `ready-for-agent`**.

**Tous les POCs sont tranchés. Aucun fallback Next.js Node requis.**
