---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Push moat V1 = dual stack Wallet pass + A2HS PWA (bloquant à la validation paiement)

## Contexte

Le moat KitchenBoost repose sur la capacité de **recontacter** un client capté off-platform (cf. [Customer Data](../contexts/customer-data/CONTEXT.md)). La règle d'or : *tout client qui valide une cmd sur une PWA KB doit avoir au moins UN canal push enrollment actif (Wallet pass OU Web Push OU A2HS) + Email + Tel capturés. Sans push enrollment, pas de validation cmd possible (bouton "Payer" bloqué).*

Apple refuse toute API programmatique pour A2HS PWA sur iOS Safari (4+ taps manuels via Share menu, taux de conversion sur banner éducatif très faible). Google Wallet et Apple Wallet permettent un install en 2 taps avec push notifications lock-screen taux d'ouverture 85-99%.

## Décision

**V1 = dual stack push enrollment** :
1. **Wallet pass = canal PRIMARY** (Apple Wallet iOS / Google Wallet Android) — install 2 taps, bypass A2HS iOS, push lock-screen.
2. **A2HS PWA = canal SECONDARY** (full-app UX commande) — Android prompt natif 1 tap / iOS bottom sheet instructions post-cmd.
3. **Web push permission** = alternative Android sans A2HS.

**Push enrollment bloquant techniquement à la validation paiement** : bouton "Payer" disabled tant qu'au moins UN canal n'est pas actif. Fallback "Continuer sans notifs" ultra-frictionnel (3 niveaux de modal, lien microscopique, disclaimer fort) pour ~5-10% de blocages techniques irréductibles iOS (mode privé, MDM entreprise, iOS <16.4 + refus Wallet, bug device).

**Incentive Wallet paramétrée par le resto** depuis [[KB Admin]] en Phase C (texte libre + code promo généré uniquement si pass effectivement installé via webhook `pass_installed`).

## Considered options

1. **Web push standard seul (sans Wallet, sans A2HS bloquant)** — friction install nulle mais moat dégradé sur iOS où push web requiert A2HS (16.4+) qui lui-même requiert 4+ taps manuels. Drop iOS = trop élevé.
2. **A2HS PWA seul** — la PWA "obligatoire pour commander" sur iOS = mur d'instructions Apple bloquant le paiement. Drop conversion iOS massif (~50% trafic FR), techniquement infaisable proprement.
3. **Wallet pass seul** — manque la couche UX commande full-app pour les power users + le push web Android sans A2HS qui est gratuit en friction.
4. **Dual stack Wallet + A2HS (choix retenu)** — couvre les 2 plateformes asymétriquement avec friction minimale par device.

## Pourquoi ce choix

- **Wallet pass = seul vrai canal push lock-screen sans friction iOS** (2 taps vs 4+ A2HS). 99% open rate, 8× redemption vs email. Engagement 3-4× supérieur aux apps natives car Apple Wallet/Google Wallet ne sont jamais désinstallés.
- **A2HS reste utile** pour l'UX commande full-app (icône maison, full-screen sans Safari chrome) + le push web Android natif sans condition.
- **Push enrollment bloquant = règle d'or non négociable** pour préserver le moat 100%. Trade-off conversion iOS ~10-15% drop assumé. Fallback frictionnel uniquement pour blocages techniques irréductibles (~5%).
- **Variable incentive paramétrée par le resto** = chaque resto choisit son hook ("-10% prochaine cmd" / "1 Cristaline offerte") en fonction de son ticket moyen, sans intervention KB.

## Conséquences

- **Coût dev V1** : intégration Apple PassKit Web Service + Google Wallet API + certif Apple Developer NativeSquare + signature pass server-side + endpoints update push. Estimé ~3-5 jours dev cumulés mais critique pour le moat.
- **Risque conversion iOS** : ~10-15% drop estimé pour clients qui n'arrivent pas à installer le pass ni A2HS ni accepter web push. Mitigation = fallback frictionnel + wording incentive fort.
- **Asymétrie friction iOS/Android assumée** : on tolère 2 taps Wallet iOS vs 1 tap A2HS Android — pas de bidouille pour uniformiser.
- **Dépendance Apple/Google** : si Apple change ses règles PassKit ou Google Wallet, KB doit s'adapter rapidement (faible probabilité, ces APIs sont stables depuis 10+ ans).

## Hard to reverse pourquoi

Une fois N clients enrôlés sur le dual stack (Wallet + A2HS), les push channels enregistrés côté serveur sont attachés à ces installs. Basculer vers une autre architecture (genre app native) nécessiterait de re-onboarder chaque client = perte de moat. La décision conditionne aussi la structure de la table `wallet_passes` et toute l'infra notifications côté backend.

Doc de référence : [docs/research/wallet_pass_vs_pwa_a2hs.md](../research/wallet_pass_vs_pwa_a2hs.md).
