# Archive — PRDs obsolètes

Ce dossier contient des PRDs qui ont été remplacés par des PRDs unifiés suite au refactor sémantique du 2026-05-23.

| Ancien PRD | Statut | Remplacé par |
|------------|--------|--------------|
| `20_kds_resto.md` | ⛔ Archivé | [docs/prd/20_kb_orders.md](../prd/20_kb_orders.md) (fusion KDS + app native) |
| `70_admin_backoffice_kb.md` | ⛔ Archivé | [docs/prd/70_kb_admin.md](../prd/70_kb_admin.md) (renommé + absorbe 75) |
| `75_dashboard_resto.md` | ⛔ Archivé | [docs/prd/70_kb_admin.md](../prd/70_kb_admin.md) (absorbé via RBAC) |
| `76_app_native_resto.md` | ⛔ Archivé | [docs/prd/20_kb_orders.md](../prd/20_kb_orders.md) (fusion KDS + app native) |

## Pourquoi ces fusions ?

**20 + 76 → KB Orders** : la PWA KDS tablette n'existe plus comme produit séparé. Le workflow cmd cuisinier (nouvelle → prep → prête → remise) tourne sur une **app native** unique iOS + Android, installable au choix sur téléphone perso du gérant ou sur tablette en cuisine. Push fiables APNs/FCM des deux côtés. La PWA reste **uniquement côté client final** ([10_pwa_client_commande.md](../prd/10_pwa_client_commande.md)).

**75 → 70 KB Admin** : il n'y a plus 2 apps web (Merchant Dashboard côté resto + Admin KB côté interne). Il y a **1 seule app web `KitchenBoost Admin`** dont la vue est scopée par RBAC : un user KB Admin (root) voit tous les tenants, un user KB Manager voit ses tenants à lui.

## Note de récupération

Ces fichiers contiennent du contenu détaillé (edge cases, flows, open questions) qui a été migré dans les PRDs cibles. Si tu cherches une info historique, regarde d'abord le PRD cible. Si rien n'y figure, le contenu original est ici en lecture seule.

Ne pas modifier ces fichiers — ils sont gelés au 2026-05-23.
