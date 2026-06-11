# Migration legacy — adresse Google Places 4-tuple

## Pourquoi

Avant les PRs #484/#485/#486 (juin 2026), `tenants.address` ne portait qu'une chaîne libre tapée par le gérant. Le devis Uber Direct exige un `pickup_address` structuré (rue / ville / CP / pays + lat/lng), donc on a élargi le schéma au 4-tuple :

- `address` (chaîne d'affichage)
- `addressLat` / `addressLng` (coordonnées Google Places)
- `addressComponents` (`{ streetAddress, city, zipCode, country }`)

PR #486 verrouille toute NOUVELLE activation sur ce 4-tuple (`tenant.activate` jette `ACTIVATION_BLOCKED_NO_ADDRESS` si incomplet). Mais les tenants déjà actifs avant ce verrou portent encore une adresse partielle — la slice 4 (cette migration) les remonte pour qu'ops les contacte et fasse re-saisir l'adresse au gérant.

## Comment retrouver les tenants concernés

1. Connecte-toi à `kitchen-boost.com/monitoring` avec ton compte `kb_admin`.
2. Sous le tableau des incidents, déroule la section **« Tenants sans adresse configurée »**. Chaque ligne correspond à un tenant `active` dont au moins une partie du 4-tuple manque ; les badges orange listent quels champs (`address` / `lat` / `lng` / `components`).
3. La colonne **« Lien »** ouvre la page Paramètres du tenant en un clic.

Côté backend, la même donnée est exposée par `api.lib.admin.addressAudit.listTenantsWithMissingAddress` (root-only) et par son jumeau internal `internal.lib.admin.addressAudit.auditTenantsWithMissingAddress` (pour script ops one-shot).

## Que faire

Pour chaque ligne :

1. **Contacter le resto** (téléphone / WhatsApp). Le pitch : « pour que la livraison Uber fonctionne, il faut qu'un manager re-saisisse l'adresse une fois depuis l'interface ».
2. **Demander à un manager** de se connecter à son admin tenant et d'aller dans **Paramètres → Coordonnées**. Il tape les premières lettres de l'adresse, choisit la suggestion Google Places, puis sauvegarde. La sauvegarde persiste les 4 champs en une seule mutation (`tenant.updateSettings` — all-or-nothing).
3. **Vérifier** que la bannière rouge « adresse incomplète » a disparu de la page Paramètres, et recharger `/monitoring`. Le tenant doit avoir disparu de la section « Tenants sans adresse configurée ».

Aucune migration automatique côté code : re-géocoder une chaîne libre nécessite la SDK Google Places navigateur (`@googlemaps/js-api-loader` casse le runtime Convex, cf. memory `googlemaps-loader-ssr-bug`). C'est volontairement un workflow humain.
