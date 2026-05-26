# Phase B — signature Wallet réelle (Apple `.pkpass` + Google JWT) → #68

**Question.** Avec les **vrais** certificats (Apple Pass Type ID + WWDR G4 ; service account Google
Wallet), peut-on produire (a) un `.pkpass` Apple signé et (b) un JWT « Save to Google Wallet » signé,
end-to-end ?

**Gate.** Toute la chaîne Wallet 2.8 (#68 → #69 → #70 → #71 → #72).

> Complète le [POC #3](poc-3-passkit-use-node.md) (qui prouvait le _runtime_ `"use node"`). Ici on
> valide la **signature réelle** avec les credentials de prod. Exécuté en local (scripts throwaway),
> secrets lus depuis `packages/backend/.env.local` (gitignored), jamais commités.

## Apple `.pkpass` — ✅ OK

- Certificat Pass Type ID **`pass.com.kitchen-boost.card`** (team `NPRZX7J97G`, ALBELO DESIGNS LLC),
  émis par **Apple WWDR G4**, valide jusqu'en 2027. Clé privée chiffrée par passphrase.
- `WALLET_PASS_CERT_P12_BASE64` + `WALLET_PASS_CERT_PASSWORD` décodés depuis `.env.local` → round-trip OK
  (p12 3181 o, RSA key ok, modulus == cert).
- `passkit-generator` (la lib retenue) + WWDR G4 → `.pkpass` **signé de 4541 octets**.
- Le bundle contient `manifest.json`, **`signature`** (PKCS#7 détaché), `pass.json`, `icon.png`.
- passkit-generator valide que `passTypeIdentifier`/`teamIdentifier` du pass correspondent au cert **et**
  que le cert est bien émis par le WWDR fourni — la construction réussit donc = chaîne de confiance OK.

**Reste pour #68 (non bloquant pour coder/merger) :** l'**install device manuelle** (scanner le `.pkpass`
sur un vrai iPhone) = dernière validation e2e hors CI.

## Google Wallet — ✅ OK

- Service account **`kitchenboost-wallet@kitchen-boost.iam.gserviceaccount.com`** (projet `kitchen-boost`).
- `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` (base64) décodé → JWT « Save to Google Wallet » signé **RS256**
  avec la clé privée du SA, puis **signature vérifiée** avec la clé publique dérivée (970 o, 3 parts).
- Le lien d'ajout final = `https://pay.google.com/gp/v/save/<jwt>`.

**Reste pour la prod :** activer l'**accès Issuer** (pay.google.com/business/console) + créer une
`GenericClass` — l'`issuerId` rend la carte réclamable. Non bloquant pour valider la signature.

## Implication 2.8 (#68)

Génération `.pkpass` (PKCS#7) en action `"use node"` (POC #3) avec les certs réels → **OK, pas de plan B
Next.js Node**. Google Wallet (JWT RS256) idem. Secrets en env vars serveur (jamais via une query Convex).

> ⚠️ **Runtime** : pour que la génération tourne sur le déploiement Convex, les secrets doivent être
> poussés dans l'**env du déploiement** (`npx convex env set WALLET_PASS_CERT_P12_BASE64 …`, etc.) — pas
> seulement dans `.env.local` (qui ne sert qu'au CLI/local). Étape de config déploiement, pas de code.
