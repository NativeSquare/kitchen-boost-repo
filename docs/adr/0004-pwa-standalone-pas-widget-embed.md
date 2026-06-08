---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Surface client final V1 = PWA standalone (pas widget embed)

## Contexte

La surface client final V1 KitchenBoost peut prendre deux formes :

- **PWA standalone** : `<slug>.kitchen-boost.com` (ou domaine custom resto), site complet branded resto géré par KB
- **Module widget embed** : KB livre un widget JS/iframe que le resto colle dans son site existant (Wix, Wordpress, etc.) — panier/checkout en overlay

Choix actait initialement vers PWA standalone, contesté en cours de session par Alex ("je voyais ça comme un module qui s'intègre à leur site"), tranché 2026-05-24.

## Décision

**V1 = PWA standalone sur sous-domaine KB** (ou domaine custom resto si configuré). **Pas de widget embed V1**.

**V2 envisagera un mode widget overlay** pour restos avec site fort qui veulent embed le commande sur leur domaine — mais sans push iOS dans ce mode (limite architecturale incontournable).

## Considered options

1. **PWA standalone V1 (choix retenu)** — site complet branded resto sur sous-domaine KB, contrôle total UX, push possible via A2HS + Wallet.
2. **Widget embed V1** — intégré au site host du resto, marque resto à 100%, mais [push web iOS impossible](0002-push-moat-dual-stack-wallet-a2hs.md) (A2HS requiert PWA standalone) → casse le [push moat V1](0002-push-moat-dual-stack-wallet-a2hs.md).
3. **Les deux V1** — flexibilité max mais N stacks CMS host à supporter (WordPress, Wix, Shopify, Webflow, site fait main) = irréaliste micro-équipe V1.

## Pourquoi ce choix

- **Push web V1 obligatoire** (cf. [ADR 0002](0002-push-moat-dual-stack-wallet-a2hs.md)) requiert A2HS PWA → impossible en widget embed dans un site host. Argument décisif.
- **Majorité TPE cible KB n'a pas de site existant** (ou un site obsolète) — KB devient leur "vitrine commande" en bonus, argument commercial fort en Phase 1.
- **Complexité support sur N stacks CMS host** (conflits CSS, JS, headers, polyfills) = irréaliste pour micro-équipe V1 (Alex terrain seul + 1 dev IA assist). Le standalone donne 1 codebase 1 stack à maintenir.
- **Cohérence avec le pivot Wallet pass commun** ([ADR 0003](0003-wallet-pass-commun-marque-neutre.md)) : la marque consumer-side neutre est portée par Wallet + le sous-domaine KB partagé, pas par un embed disparate dans des sites tiers.

## Conséquences

- **Resto avec site existant fort** doit redirect ses clients vers `<slug>.kitchen-boost.com` (lien "Commander" sur son site host). Friction perçue par certains restos qui voulaient embed.
- **Domain custom resto** restera supporté V1 (le resto peut configurer `commande.bunsbao.fr` qui pointe sur la PWA KB via DNS).
- **V2 widget embed envisageable** sans push iOS, pour les restos qui ont déjà un site fort et qui acceptent la limitation (push Android uniquement + Wallet pass).
- **Maintenance** : 1 codebase PWA + N tenants. Pas de N intégrations CMS différentes à maintenir.

## Hard to reverse pourquoi

Toute l'architecture multi-tenant (`tenant_id` extrait du hostname), le routing PWA, le manifest dynamique par tenant, l'A2HS install behavior, le push web subscription par origin — tout repose sur le modèle PWA standalone. Basculer V1 vers widget embed = re-architecturer le frontend complet + perdre le push iOS sur les clients embed = double coût.

À l'inverse, ajouter un mode widget V2 en parallèle de la PWA standalone V1 = trivial (extraire le composant panier+checkout en lib JS, le hoster sur CDN). La décision contraint le V1 mais préserve l'option V2.
