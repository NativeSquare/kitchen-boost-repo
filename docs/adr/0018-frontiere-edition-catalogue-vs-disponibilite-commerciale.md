---
status: accepted
date: 2026-06-03
context: KB Orders (PRD 20), KB Admin (PRD 70)
---

# 0018 — Frontière édition catalogue (KB Admin seul) vs disponibilité commerciale (KB Admin + KB Orders)

## Décision

Les actions du KB Manager sur la **disponibilité commerciale "ici et maintenant"** d'un tenant sont accessibles **depuis les deux apps** (KB Admin web + KB Orders native), avec synchro temps réel Convex. Les actions d'**édition catalogue** (le menu en tant qu'objet) restent **KB Admin seul** en V1 et V2.

**Disponibilité commerciale** (les deux apps, V1) :

- Pause exceptionnelle (15 / 30 / 60 min, ETA reprise figée)
- Fermeture exceptionnelle (1+ jour : vacances, panne frigo, intempéries)
- Toggle item "indisponible" (par item, granularité fine — pas catégorie entière en V1, acté Q3.7a)
- Modification horaires d'ouverture du jour / de la semaine (créneaux)

**Édition catalogue** (KB Admin seul) :

- Création / suppression d'item
- Prix d'un item
- Description, allergens, photo
- Ordre des catégories, ajout / suppression de catégorie
- Modifiers / options de personnalisation
- Toggle catégorie entière (V1)

## Pourquoi cette frontière

Profil opérateur radicalement différent :

- **Disponibilité commerciale** : Khan doit agir **en 5 secondes depuis la cuisine** (frigo cassé à 19h, rupture inopinée, un seul cuisinier ce soir → ferme tôt). Tablette gants potentiels, lumière variable, écran small/medium, contexte stressé. Doit être atomique, irréversible si voulu, traçable.
- **Édition catalogue** : travail **posé**, sur grand écran (catégorisation, ordre, prix réfléchis, photo bien shootée). Hors service. Doit voir le contexte global du menu, comparaisons cross-items, etc.

Mélanger les deux dans KB Orders V1 introduirait :

- Surface d'erreur opérateur (Khan modifie un prix par erreur en pleine course)
- Coût UI mobile élevé (champs prix, validation, gestion modifiers)
- Surface de bug cross-app à tester
- Confusion de mission de l'app native (n'est plus "Uber Eats Orders for KB" — c'est "KB Admin mini")

La frontière par "**fréquence d'usage × urgence × granularité**" est claire :

- Action faite quotidiennement en pleine activité → KB Orders
- Action faite ponctuellement au calme → KB Admin

## Implications

- **Toggle dispo item** dans KB Orders V1 (était V2) : un tooltip obligatoire au premier usage explique la frontière (_"Ce toggle masque l'item du menu côté client. Pas de modification permanente — il restera disponible dans ton catalogue KB Admin."_). Évite la confusion "j'ai supprimé l'item" vs "je l'ai juste rendu indispo".
- **Pas de modif prix** dans KB Orders V1 ou V2 (acté Q3.7b) — la décision de modifier un prix est business, posée, et n'a pas sa place en cuisine.
- **Synchro Convex** : 1 source de vérité par tenant, les deux apps subscribent aux mêmes tables. Pas de cache local, pas de conflit V1 (audit monolithique, 1 KB Manager actif, cf. ADR à venir Axe 2 si formalisé).
- **V2 réouvre étroitement** : si staff cuisinier arrive (Q20-Q3), on peut potentiellement étendre KB Orders avec des toggles plus larges (catégorie entière) mais **pas** déplacer l'édition catalogue. La frontière reste.

## Conséquences pour le PRD

- PRD 20 §7 expand en sous-sections (7a pause / 7b fermeture / 7c toggle item / 7d horaires)
- PRD 70 KB Admin doit refléter la même frontière côté web : ces 4 surfaces sont accessibles aussi côté admin, même état Convex partagé.
- Le code mobile native KB Orders n'a **jamais** de formulaire de création/édition de menu — uniquement vue lecture + toggles dispo.

## Rejet

- ❌ "Tout faire faisable depuis l'app native" : trop d'UI mobile + risque opérateur en cuisine
- ❌ "Rien dans l'app native (tout via KB Admin web)" : impossible en pratique de switch d'app au milieu d'un service, frigo cassé à 19h doit pouvoir être adressé en 5 sec
