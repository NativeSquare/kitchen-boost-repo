---
status: accepted
date: 2026-05-27
deciders: Alex
---

# Édition menu V1 — brouillon autosauvé + publication globale atomique

## Contexte

Le backend menu (chantier 2.2, contexte **Client Ordering**, PRD 10 §5/§6) a été construit **live-only** : les tables `menuCategories` / `menuItems` / `modifierGroups` n'ont **aucun état de publication** (juste `available` pour la rupture, `order` pour le tri), et `getPublicMenu` (la PWA mangeur) lit l'**état courant**. Toute édition est donc immédiatement publique.

La session de grilling du front [[Édition menu]] (KB Admin, PRD 70 §4.2) a tranché : on veut un **workflow brouillon → publication**, pas l'édition live. Le PRD le suggérait déjà (« Preview avant publication », « Publication = propagation < 30 sec »). Cette décision **rouvre le modèle de menu de Client Ordering** — ce n'est pas une décision purement front.

## Décision

**Le menu s'édite en brouillon autosauvé, et une action « Publier » globale et atomique le rend public.**

- **Les tables menu actuelles = le brouillon.** Le KB Manager édite en direct dedans (autosave, comme aujourd'hui) — aucune friction de « sauvegarde ».
- **Un instantané « publié » par tenant** est ce que `getPublicMenu` sert désormais (au lieu des tables live).
- **« Publier » = une mutation atomique et globale** : elle reconstruit l'instantané publié à partir du brouillon courant, **tout le menu d'un coup**. Pas de publication par item / par section.
- **« Aperçu »** lit le **brouillon** (les tables live) — c'est le rendu PWA de l'état non encore publié.
- **Pas de versioning complet V1** (historique des versions publiées = V2). **Pas d'« annuler mes modifications » (revert brouillon → publié) V1** (pour corriger, on republie) — V2.
- Un indicateur **« modifications non publiées »** est affiché dans l'éditeur.

## Considered options

1. **Brouillon + publication globale atomique via instantané publié (retenu)** — le moins cher qui satisfait l'intention : on garde les tables live comme brouillon, on ajoute un instantané + une action publish ; `getPublicMenu` change de source.
2. **Édition live (le défaut du backend tel que bâti)** — zéro chantier, mais aucun filet : une faute de frappe sur un prix part instantanément en ligne. Rejeté (l'intention produit est un garde-fou de publication).
3. **Publication par item / par section** — effondre le modèle « instantané » : il faudrait suivre l'état publié/non-publié de **chaque** entité (item, catégorie, groupe) + résoudre des états mixtes. Beaucoup plus lourd, pour un bénéfice marginal en V1. Rejeté.
4. **Versioning complet (snapshots horodatés, rollback)** — la forme « riche » du brouillon/publish. Déféré V2 (PRD « Versioning : V2 »).

## Pourquoi ce choix

- L'**atomicité globale** est ce qui rend le modèle « instantané » trivial : un seul instantané publié par tenant, reconstruit à chaque publish. La publication par entité aurait imposé un état par entité — disproportionné pour un soft-launch.
- Garder **les tables live comme brouillon** veut dire que l'éditeur ne change presque pas (il édite déjà ces tables) ; on **ajoute** une couche publish plutôt que de refondre l'édition.
- Le **filet de sécurité** (rien n'est public tant qu'on n'a pas publié) répond au risque réel du live (prix erroné en ligne) sans le coût du versioning complet.
- Cohérent avec l'existant : `orderItems` est déjà un **snapshot figé à la commande** (2.3-A) — les commandes passées ne bougent jamais quand le menu change ; la publication ne touche que ce que voit la PWA, pas l'historique.

## Conséquences

- **Story backend Client Ordering à créer** (dépendance dure du bouton « Publier » front) : un **instantané publié** par tenant (table/doc), une mutation `publishMenu` (root override pour l'assistance KB Admin) qui le reconstruit, et `getPublicMenu` qui lit l'instantané au lieu des tables live. `previewMenu` (ou un flag) lit le brouillon.
- **Edge tenant fraîchement provisionné** : tant qu'aucune publication n'a eu lieu, l'instantané publié est **vide → la PWA n'a pas de menu**. Le parcours de provisioning / onboarding ([[Wizard tenant]]) doit donc inclure une **première publication** avant la mise en ligne.
- L'éditeur affiche un indicateur **« modifications non publiées »** ; l'« annuler » et le versioning sont V2.
- Le `available` (rupture) reste un **toggle live** indépendant de la publication (il agit sur l'instantané publié sans republier tout le menu) — cohérent avec le besoin staff « 1-tap out of stock » : à préciser dans la story backend (la rupture ne doit pas exiger une republication globale).

## Hard to reverse pourquoi

La décision change la **source de lecture de la PWA** (tables live → instantané publié) et introduit la sémantique brouillon/publié dans toute la surface d'édition + le backend menu. Revenir au live, ou passer à une publication par entité, après coup = retoucher `getPublicMenu`, la couche publish, et chaque écran d'édition. C'est le socle du cycle de vie du menu V1.
