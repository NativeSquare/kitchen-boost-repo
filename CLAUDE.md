# KitchenBoost — Contexte projet

## Qui sommes-nous

KitchenBoost est une marque exploitee par **NativeSquare** (pas d'entite juridique separee). NativeSquare est un studio de developpement logiciel (3 personnes) qui genere ~15K€/mois via Upwork en developpement d'apps web et mobile. Le fondateur est Alex. Le studio dispose d'une **pipeline de developpement IA agentique** qui automatise 80-90% du code.

**Site :** nativesquare.studio
**Stack :** React, Next.js, React Native, TypeScript

**Domaines KitchenBoost :**
- kitchen-boost.fr
- kitchen-boost.com
- kitchen-boost.store
- kitchen-boost.org

**Direction artistique :**
- Palette : vert fonce (#1B7A3D), fond blanc, texte noir (#111111), accents jaune/or (#E5A100)
- Logo : typographique, "Kitchen" en noir + "Boost" en vert, sans-serif bold (Inter, Poppins ou Montserrat)
- Ton : pro, concret, resultats. Pas de fioritures.

## Le probleme

Les restaurants paient ~30% de commission a Uber Eats sur chaque commande et n'ont aucun contact avec leurs clients (pas d'email, pas de telephone). Les clients appartiennent a Uber, pas au restaurant.

## La solution KitchenBoost

Un systeme simple : **QR code dans les sacs de livraison Uber Eats** → le client scanne → landing page de capture (email/tel) → le client recommande directement chez le restaurateur la fois suivante. Le resto recupere sa marge et possede sa base clients.

## Pourquoi la restauration

1. **Pain point massif et quantifiable** : 30% de commission Uber Eats = ~3K€/mois perdu pour un restaurant moyen
2. **Owner.com** a valide le modele aux US (valorise $1B, 10K+ restaurants, $499/mois) — n'existe pas en France
3. **Le produit est templatisable** : un template brande differemment pour chaque resto
4. **Notre pipeline IA** permet de deployer chaque instance en 1-2 jours

## La validation terrain

### Yanis / Virtual Eats France

On a rejoint le **Club Virtual Eats** de Yanis (formation restaurants virtuels sur Uber Eats, 1500€). Enseignements cles :

- Il gere ~10 restaurants, ~400€/mois net par resto, ~1h/mois de gestion
- **Zero churn** — aucun restaurateur n'a arrete
- Taux de closing en physique : **~90%** pour les bons profils
- Cold calling : **30-35% de RDV bookes**
- Les restos virtuels sont un **"cheval d'entree"** : la vraie valeur c'est la relation restaurateur
- Autorisation d'utiliser ses case studies (L'Artisan, La Table Libanaise) dans nos supports

### La concurrence identifiee

| Acteur                 | Modele                                                            | En France ?             | Notre difference                                                              |
| ---------------------- | ----------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| **Owner.com**          | Template site + commande, $499/mois, $1B valorisation             | NON (US only)           | On est le Owner.com francais                                                  |
| **Taster / Guigny**    | Creation de marques virtuelles de A a Z (fournisseurs, packaging) | OUI                     | Modele different — ils creent la marque, nous on utilise la cuisine existante  |
| **Virtual Eats**        | Restaurants virtuels + upsell via tiers                           | OUI (petit, 20 membres) | On construit le produit nous-memes vs revendre un tiers                       |
| **Zelty / Innovorder** | Caisse + commande en ligne                                        | OUI                     | Pas d'app mobile native, pas de done-for-you, pas de prospection terrain      |
| **Zenchef**            | Reservation + site                                                | OUI                     | Pas de commande/livraison                                                     |

## Le business model — Phase 1 (validation)

### Philosophie

Phase 1 = valider deux hypotheses :
1. On arrive a acquerir des restaurateurs sur le terrain
2. On arrive a leur ramener du business

**Pas d'upsell agressif, pas de pricing high-ticket.** On construit la relation progressivement.

### Modele economique Phase 1

**2€ par client genere.** Si on ramene rien, le restaurateur paie rien. C'est un partenariat, pas une vente de produit cher.

```
QR code dans les sacs Uber Eats
  → Client scanne
    → Landing page capture (email/tel)
      → Client recommande directement chez le resto
        → KitchenBoost gagne 2€ par nouveau client
```

**Couts outils (a la charge du resto, avec accord ecrit) :** 354-444€ de setup (outils + mise en place). On ne marge pas dessus. Notre remuneration = performance uniquement.

### Vision long terme (pas pour maintenant)

A terme, KitchenBoost evoluera vers une suite complete :
- Site/app de commande directe + Uber Direct (livraison sans commission marketing)
- Programme fidelite + push notifications + CRM client
- QR code commande sur place
- Module facturation Factur-X (obligatoire sept 2026)
- Analytics (plats populaires, heures de pointe, panier moyen)

**Mais en Phase 1, on ne build rien de tout ca.** Le MVP c'est : QR code → landing page capture → le client revient directement.

## Le funnel de prospection

### Phase 1 — Terrain (maintenant)

Alex se deplace personnellement dans les restaurants (Essonne / sud IdF). Objectif : 5 restaurants signes.

**Le pitch :**
- "On met un QR code dans vos sacs de livraison. Le client le scanne, et la prochaine fois il commande directement chez vous."
- "On se remunere 2€ par nouveau client qu'on vous ramene. Si on vous ramene rien, vous payez rien."

### Phase 2 — Scale semi-automatise (plus tard)

```
Google Maps scrape (restaurants par zone)
  → Tri par prefixe telephone (06/07 = patron, 01-05/09 = standard)
    ├─ PORTABLE → SMS personnalise → RDV physique
    ├─ Pas de reponse → Agent vocal IA (Vapi) → book RDV
    └─ FIXE → Visite physique directe
```

## Comment ca s'integre dans NativeSquare

### Court terme (maintenant)

- L'agence Upwork **continue** normalement (15K€/mois de base)
- KitchenBoost est un **projet startup studio** en parallele
- Alex fait le terrain seul, l'equipe dev n'est pas mobilisee en Phase 1

### Moyen terme (mois 3-6)

- KitchenBoost genere son propre CA (2€/client + upsells progressifs)
- Le template app est pret et deploye chez les premiers clients
- Le funnel automatise tourne

### Long terme

- KitchenBoost devient un **produit SaaS vertical** pour la restauration
- Le modele peut etre **replique** sur d'autres verticaux
- Vision finale : **Software Business as a Service**

### Le flywheel

```
BUILD (pipeline IA NativeSquare)
  → DEPLOY (systeme KitchenBoost chez chaque restaurant)
    → EARN (2€/client + MRR)
      → LEARN (donnees terrain, feedbacks, case studies)
        → PUBLISH (contenu SEO, temoignages, brand)
          → ATTRACT (nouveaux restaurants inbound)
            → recommence, plus fort a chaque tour
```

## Principes directeurs

1. **MVP partout** — On ne build pas plus que le strict necessaire pour aller sur le terrain
2. **On gagne ensemble** — "On vous ramene des clients, on est payes au resultat", pas "achetez notre outil"
3. **Le restaurateur comprend en 5 secondes** — Pas de jargon tech, pas de slides complexes
4. **Distribution is the moat** — La vraie barriere c'est la capacite a atteindre les restaurateurs
5. **$6, pas $1** — On vend l'outcome (clients recuperes) pas l'outil
6. **Build hard to go far** — On construit notre propre produit plutot que de revendre un tiers

## Documents de reference

### Source de verite produit (PRD)

- **`docs/prd/`** — **Source de verite produit canonique** (PRD master + 9 sous-PRDs par sous-domaine + roadmap). Toute decision produit y est tracee.
- `docs/prd/README.md` — Index navigable des PRDs avec statuts
- `docs/prd/00_master.md` — Vision, personas, business model, scope V1/V2/V3 argumente, architecture fonctionnelle, metriques, risques, open questions
- `docs/prd/roadmap.md` — Roadmap d'execution V1 (4 sprints) / V2 (4 phases) / V3 esquisse

### Commercial / vente

- `docs/commercial/COMMERCIAL.pdf` — Kit commercial complet (process 6 etapes, couts, psychologie, fidelisation)
- `docs/commercial/Pitch_Closer.pptx.pdf` — Pitch de closing avec simulateur ROI et case studies
- `docs/commercial/Plaquette_commerciale_-_Anti-Uber.pptx_(1).pdf` — Plaquette Anti-Uber
- `docs/vente/trames.md` — Trames de vente (cold call, physique, DM Instagram)

### Legal

- `docs/legal/contrat_template.md` — Template de contrat restaurateur (source canonique, regenere les contrats clients via `tools/generate_contract.py`)

### Notes / contexte

- `docs/notes/discussion-whatsapp.md` — Echange avec Yanis, reponses operationnelles
- `docs/plans/onboarding_restaurateur_process.md` — Process operationnel d'install resto par resto

### Archives / exploration (non-canonique)

- `docs/specs/` — Specifications preliminaires anterieures au PRD (a archiver / supprimer apres validation PRD)
- `docs/research/` — Documents d'exploration technique (Stripe, Uber Direct, web push, alternatives livraison, etc.). **Pas source de verite — referencees depuis les PRDs.**
- `docs/plans/` — Plans d'action operationnels (onboarding resto, uber direct action plan)

## Liens utiles

- **Uber Direct :** https://merchants.ubereats.com/us/en/services/uber-direct/ — livraison en marque blanche, 0% commission marketing
- **Owner.com :** https://www.owner.com — le modele qu'on replique pour la France ($1B valorisation)
- **Virtual Eats France :** Le Club dont on fait partie — formation + communaute restaurants virtuels
- **Vapi :** https://vapi.ai — agent vocal IA pour la prospection telephonique
