# POC #3 — `passkit-generator` + PKCS#7 dans une action `"use node"`

**Question.** Une action Convex `"use node"` peut-elle charger `passkit-generator` et exécuter une
signature **PKCS#7 détachée** (le mécanisme qui signe le `manifest.json` d'un `.pkpass` Apple) ?

**Gate.** Génération de la carte Wallet 2.8 (#68 → toute la chaîne #69–#72).

## Spike (throwaway)

Action `"use node"` (`convex/spikeNode.ts`) : (1) import de `passkit-generator`, (2) exécution d'une
signature PKCS#7 détachée via `node-forge` (la dépendance crypto **pur JS** que `passkit-generator`
utilise — pas de binding OpenSSL natif), avec un cert auto-signé jetable :

```ts
"use node";
import forge from "node-forge";

export const pocPasskit = action({
  args: {},
  handler: async () => {
    const pk = await import("passkit-generator");
    const hasPKPass = typeof pk.PKPass === "function";

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const attrs = [{ name: "commonName", value: "kb-spike" }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer("manifest-sha1-hash", "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key: keys.privateKey,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
    });
    p7.sign({ detached: true });
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return {
      hasPKPass,
      pkcs7DerBytes: der.length,
      ok: hasPKPass && der.length > 0,
    };
  },
});
```

## Exécution (dev, 2026-05-26)

```
$ npx convex run spikeNode:pocPasskit
{ "hasPKPass": true, "pkcs7DerBytes": 1062, "ok": true }
```

## Verdict : ✅ OK (signature réelle = e2e device, Phase B)

- `passkit-generator` se charge sous `"use node"` (`PKPass` est bien une fonction).
- La signature PKCS#7 détachée (node-forge, pur JS) produit un DER de **1062 octets** → le chemin de
  signature tourne dans le runtime Node de Convex. Aucun binding OpenSSL natif requis.
- **Ce que ce POC ne prouve PAS** (et n'a pas à prouver) : un `.pkpass` _valide pour Apple Wallet_. Ça
  exige les **vrais certs** (Pass Type ID + WWDR) et une **install device manuelle** — c'est le
  prérequis HITL de #68 (Phase B, certs fournis par Alex). La structure du pass reste mergeable/testable
  en CI sans signature réelle.

**Implication 2.8 (#68).** La génération `.pkpass` (PKCS#7) vit dans une action `"use node"` —
**pas besoin du plan B route Next.js Node** (STACK §2.3). Google Wallet (JWT service account) est encore
plus léger (pas de PKCS#7). Certs réels en env vars serveur (`WALLET_PASS_CERT_P12_BASE64`, etc.),
jamais exposés via une query.
