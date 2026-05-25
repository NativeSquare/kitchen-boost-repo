# Audit du contrat KB — Gaps & recommandations

**Date** : 2026-05-21
**Périmètre** : `docs/legal/contrat_template.md` v courante vs stratégie SaaS multi-tenant (PWA + Uber Direct + Stripe Connect + push + QR + 15 restos pipeline)
**Statut** : audit consolidé de 2 sous-agents (économique/opérationnel + juridique/RGPD). **Aucune modification n'a été appliquée au contrat ni au script.**

---

## 1. Verdict global

Le contrat actuel a été conçu pour le **modèle Phase 1 initiale** (marque virtuelle Uber Eats only, à la Yanis). Il **ne couvre pas le pivot SaaS multi-tenant** (PWA + Stripe Connect + push + données clients finaux + domaine custom).

- **7 changements P0** à appliquer **avant le soft launch Buns & Bao** (~J11-J14 du plan)
- **5 changements P1** à appliquer **avant le 5e resto signé**
- **5 changements P2** à appliquer avant un resto "pro" (chaîne, franchise)
- **2 annexes obligatoires** à créer (Privacy Policy PWA + CGU PWA)
- **1 annexe optionnelle** (DPA) à créer Phase 2 si un resto "pro" la demande

**Risques majeurs si on ne fait pas les P0** :
1. Marge KB négative sur paniers >117€ (frais Stripe absorbent les 2€) — **financier**
2. Mandat ne couvre PAS la création du compte Stripe Connect au nom du resto → zone grise juridique sur le `POST /accounts` (potentiellement usurpation) — **juridique**
3. Aucune qualification RGPD des données clients finaux collectées via PWA (article 28 RGPD non respecté) → **conformité CNIL + blocage commercial si un resto pro demande un DPA**

---

## 2. Tableau récap de tous les gaps

### P0 — Avant soft launch Buns & Bao (J11-J14)

| # | Article | Gap | Fix |
|---|---|---|---|
| 1 | **Article 3 — Rémunération** | ~~2€ flat → marge négative >117€ panier~~ **SUPERSEDED** par modèle pass-through Stripe + `on_behalf_of` | ✅ **APPLIQUÉ 2026-05-21** : 2€ flat KB + frais Stripe (1,5% + 0,25€) pass-through au resto via `on_behalf_of`. Plus de grille progressive nécessaire. |
| 2 | **Article 3 — Modalités versement** | "Règlements chaque lundi" incompatible avec Stripe Connect daily auto | ✅ **APPLIQUÉ 2026-05-21** : reformulé en "prélèvement automatique via `application_fee_amount`" + payouts Stripe quotidiens par défaut |
| 3 | **Article 2 bis.1 — Mandat** | Ne couvre PAS Stripe Connect, IBAN via API, domaine, push | Étendre le mandat avec ces 4 prestations explicitement |
| 4 | **Article 2 ter** (NEW) | Aucune qualification RGPD des données clients finaux PWA | Nouvel article : KB sous-traitant art. 28 RGPD + finalités + sous-traitants + opt-in push ePrivacy |
| 5 | **Article 4 bis** (NEW) | Pas de distinction marque concédée vs données d'exploitation accumulées | Nouvel article : marque = KB, données vente/avis/historique = resto |
| 6 | **Article 5.4 — Résiliation** | Formulation "propriété des données" juridiquement vide (notion absente du RGPD) | Réécrire avec : export CSV/JSON 30j, sort domaine custom 90j, sort QR codes 90j, suppression def. 60j post-export |
| 7 | **Annexes 1+2** (NEW) | Pas de Privacy Policy PWA ni CGU PWA client final | Créer 2 docs courts (~2-3 pages chacun), liés au contrat |

### P1 — Avant 5e resto signé

| # | Article | Gap | Fix |
|---|---|---|---|
| 8 | **Article 1.2 — Prestations** | Manque PWA, Stripe Connect, push, QR stickers, domaine, RDV install | Ajouter 6 items aux prestations listées |
| 9 | **Article 3 ter** (NEW) | Setup costs 354-444€ (CLAUDE.md) absents du contrat | Nouvel article : chiffrage transparent + ventilation indicative + KB ne marge pas |
| 10 | **Article 3 quater** (NEW) | Refunds livraisons Uber Direct échouées non traités | Nouvel article : resto paie Uber quand même, refund client à sa charge, KB met à dispo logs |
| 11 | **Article 11.2 — Responsabilités** | N'exclut pas PWA KB downtime + suspension Stripe Connect | Ajouter alinéa : objectif SLA 99%/mois, exclusion downtime Vercel/Supabase, exclusion suspension Stripe |
| 12 | **Article 14 bis** (NEW) | CGU PWA + custom domain + cookies non traités | Nouvel article : CGU annexées, qui possède le domaine, cookies strictement nécessaires |

### P2 — Avant resto "pro" (chaîne, franchise)

| # | Article | Gap | Fix |
|---|---|---|---|
| 13 | **Article 8 bis** (NEW) | Pas d'exclusivité canal direct (resto peut signer avec LivePepper en //) | Clause exclu sur SaaS commande directe (Owner, LivePepper, Lightspeed, Zelty Online) |
| 14 | **Article 9 — Transparence** | Devenu obsolète (KB = admin Uber Eats via mandat) | Reformuler : KB a accès direct, fournit reporting mensuel consolidé |
| 15 | **Article 12 bis** (NEW) | Pas de fallback Stuart si Uber Direct kill | Engagement KB à activer Stuart sous 30 jours si Uber Direct indispo |
| 16 | **Article 13 — Communication** | "Toute communication validée" = ingérable | Assouplir : communication libre sur charte, validation seulement pour modifs substantielles |
| 17 | **Annexe 3** (NEW) | Pas de DPA séparé pour resto pro | Créer un DPA dédié RGPD (sera demandé par chaîne 3+ établissements) |

---

## 3. Formulations P0 prêtes à coller dans `contrat_template.md`

### P0 #1 + #2 — ✅ APPLIQUÉ 2026-05-21 — Réécriture intégrale Article 3

**Approche choisie après discussion** : on garde **2€ flat KB** mais on utilise `on_behalf_of=<acct_resto>` dans le PaymentIntent Stripe → le resto devient settlement merchant → **les frais Stripe (1,5% + 0,25€) sont prélevés directement sur son compte**, pas sur le compte plateforme KB. KB net = 2€ flat sur tous les paniers, sans grille progressive.

Le contrat mentionne explicitement les frais Stripe en pass-through pour la transparence.

```markdown
## **Article 3 – Rémunération de NativeSquare SAS**

**3.1 – Commission par commande**

En contrepartie de la licence de marque et des prestations fournies, le Partenaire s'engage à verser à NativeSquare SAS une commission forfaitaire de **2,00 € HT par commande** encaissée, applicable selon les canaux suivants :

* Via **Uber Eats** (marketplace) et **Deliveroo** : aux commandes passées sous la marque concédée,
* Via **Uber Direct** et le **canal de commande directe** (PWA / site KitchenBoost) : à toutes les commandes livrées ou retirées via ces canaux, qu'elles soient associées à la marque concédée ou à l'enseigne native du Partenaire.

**3.2 – Modalités de prélèvement (canal direct PWA)**

Pour les commandes encaissées via la PWA, la commission est prélevée automatiquement par le prestataire de services de paiement (Stripe Connect Express) au titre du paramètre `application_fee_amount` lors de chaque transaction. Le Partenaire reçoit instantanément sur son compte connecté Stripe le solde net (panier client – frais de paiement – commission KB), avec versement automatique sur son compte bancaire selon le calendrier de virement défini avec Stripe (par défaut quotidien, configurable en hebdomadaire ou mensuel).

**3.3 – Frais de paiement (transparence)**

En sus de la commission de NativeSquare SAS, des frais de traitement des paiements s'appliquent à chaque transaction, prélevés directement par le prestataire de paiement Stripe sur le compte du Partenaire. Le tarif standard Stripe France pour les cartes bancaires européennes est de **1,5 % du montant TTC de la transaction + 0,25 € fixes**. Ces frais ne sont pas perçus par NativeSquare SAS et peuvent évoluer selon les conditions générales de Stripe (consultables sur stripe.com/fr/pricing).

**3.4 – Modalités de versement (autres canaux)**

Pour les commandes encaissées hors prestataire de paiement intégré (Uber Eats marketplace, Deliveroo), NativeSquare SAS émet une facture mensuelle au Partenaire, payable à 15 jours net.

**3.5 – Évolution**

Les Parties pourront convenir, par accord écrit, d'une révision de la commission de l'Article 3.1 en fonction du volume mensuel atteint et des performances constatées.
```

**Implémentation tech requise** (cf [docs/research/uber_direct_deep_dive.md §2.3](../research/uber_direct_deep_dive.md)) :

```js
// Création PaymentIntent avec on_behalf_of pour que le resto paie les frais Stripe
const session = await stripe.checkout.sessions.create({
  payment_intent_data: {
    application_fee_amount: 200,                  // KB net 2€ flat
    transfer_data: { destination: acct_resto },
    on_behalf_of: acct_resto,                     // ← critique : resto = settlement merchant
  },
  // ...
});
```

### P0 #3 — Réécriture Article 2 bis.1

Remplacer le bloc bullets actuel par :

```markdown
**2 bis.1 – Mandat de représentation**

Le Partenaire donne mandat exprès à NativeSquare SAS pour, en son nom et pour son compte :

* Créer, paramétrer et administrer les comptes nécessaires à l'exécution du présent contrat, à savoir Uber Eats Manager (pour la marque concédée le cas échéant), Uber Direct (pour le canal de commande direct du Partenaire), et tout équivalent sur d'autres plateformes de livraison,
* Créer, paramétrer et administrer un compte auprès d'un prestataire de services de paiement agréé (notamment Stripe via son produit Connect Express), en qualité de mandataire technique, aux fins exclusives d'encaissement des commandes passées sur le canal direct du Partenaire, et notamment transmettre audit prestataire, via son interface ou son API, les informations bancaires du Partenaire (IBAN, BIC, raison sociale, SIRET) à partir des documents communiqués au titre de l'Article 2 bis.2,
* Transmettre aux plateformes et prestataires concernés les documents administratifs et justificatifs d'identité du Partenaire requis pour l'ouverture et la validation des comptes (KBIS, pièce d'identité du représentant légal, RIB, attestation d'assurance, etc.),
* Réserver, configurer et administrer, pour le compte du Partenaire, un sous-domaine de la marque KitchenBoost (`<slug>.kitchen-boost.fr`) ou, à défaut, l'enregistrement et la configuration DNS d'un sous-domaine du nom de domaine du Partenaire (`commandes.<resto>.fr`),
* Mettre en place, pour le compte du Partenaire, un système de notifications push (Web Push) à destination des clients finaux du Partenaire ayant donné leur consentement (opt-in explicite), dans les conditions de l'Article 2 ter,
* Gérer le menu, les visuels, les tarifs et les campagnes marketing associées à la marque concédée et au canal direct.

Le Partenaire reste seul titulaire des comptes ouverts en son nom. Il dispose à tout moment d'un droit d'accès direct à ces comptes (login, dashboard, factures, données) et conserve la faculté de révoquer le mandat à tout moment, sous réserve du préavis de l'Article 5.1.

Ce mandat est limité aux seules actions nécessaires à la bonne exécution du présent contrat. NativeSquare SAS ne signe en aucun cas, au nom du Partenaire, d'engagement financier non prévu au présent contrat, ni de contrat avec un tiers excédant la durée du présent contrat, sans accord écrit préalable du Partenaire.
```

### P0 #4 — Nouvel Article 2 ter

À insérer après Article 2 bis :

```markdown
## **Article 2 ter — Données personnelles des clients finaux (mangeurs)**

**2 ter.1 — Qualification RGPD**

Dans le cadre de l'exploitation de la PWA et des services associés (notifications push, historique de commandes, base clients), le Partenaire est qualifié de **responsable de traitement** au sens de l'article 4.7 du RGPD et NativeSquare SAS agit en qualité de **sous-traitant** au sens de l'article 4.8 du RGPD.

**2 ter.2 — Finalités du traitement**

NativeSquare SAS traite les données suivantes pour le compte du Partenaire :
- Identifiants clients (email, téléphone, prénom),
- Adresses de livraison,
- Historique de commandes (items, montants, dates),
- Abonnements aux notifications push (endpoint, clés cryptographiques),
- Données techniques de navigation (user-agent, type d'appareil),
- Avis et feedbacks privés.

Ces données sont traitées exclusivement aux fins suivantes :
- Exécution des commandes (paiement, livraison, suivi),
- Envoi de notifications push transactionnelles et marketing au nom du Partenaire,
- Suivi statistique anonymisé pour amélioration du service,
- Lutte contre la fraude et obligations légales (comptabilité, facturation).

**2 ter.3 — Sous-traitants ultérieurs**

NativeSquare SAS s'appuie sur les sous-traitants ultérieurs suivants, autorisés par le Partenaire au titre du présent contrat :

| Sous-traitant | Finalité | Localisation données |
|---|---|---|
| Supabase (Supabase Inc.) | Hébergement DB clients, auth | UE (Francfort) |
| Vercel Inc. | Hébergement PWA, edge computing | UE + USA (avec SCC) |
| Stripe Payments Europe Ltd. | Traitement paiements | UE (Irlande) |
| Uber Portier B.V. | Coursier livraison (data minimisée) | UE (Pays-Bas) |
| Resend Inc. | Emails transactionnels | USA (avec SCC) |
| Twilio Inc. | SMS optionnels | USA (avec SCC) |
| Google LLC (Places API) | Validation adresses | USA (avec SCC) |

Tout nouveau sous-traitant fera l'objet d'une information écrite au Partenaire, qui dispose d'un délai de 15 jours pour s'y opposer. À défaut, l'autorisation est réputée acquise.

**2 ter.4 — Engagements de NativeSquare SAS en tant que sous-traitant**

Conformément à l'article 28.3 du RGPD, NativeSquare SAS s'engage à :
- Ne traiter les données que sur instruction documentée du Partenaire,
- Garantir la confidentialité par engagement écrit de ses préposés,
- Mettre en œuvre les mesures techniques et organisationnelles appropriées (chiffrement at-rest, TLS en transit, Row Level Security Supabase, sauvegardes chiffrées, audit logs),
- Aider le Partenaire à répondre aux demandes d'exercice des droits des personnes concernées (accès, rectification, effacement, portabilité, opposition) dans un délai de 5 jours ouvrés,
- Notifier au Partenaire toute violation de données dans les 48 heures suivant sa prise de connaissance,
- À la fin du contrat, restituer ou supprimer les données conformément à l'Article 5.4.

**2 ter.5 — Consentement opt-in push (ePrivacy)**

Les notifications push étant assimilées à de la prospection électronique soumise à consentement préalable (Directive 2002/58/CE, art. L. 34-5 CPCE), le consentement est recueilli sur la PWA via un opt-in explicite (popup natif après geste utilisateur, conformément aux recommandations CNIL). NativeSquare SAS met en œuvre les mécanismes techniques de recueil, de traçabilité et de retrait du consentement. Le Partenaire est garant du respect des finalités et de la fréquence d'envoi (maximum 3 push marketing/semaine/utilisateur, plage horaire 8h-22h locale).

**2 ter.6 — Privacy Policy PWA**

NativeSquare SAS édite et maintient à jour la politique de confidentialité accessible depuis la PWA. Cette politique mentionne le Partenaire en tant que responsable de traitement et NativeSquare SAS en tant que sous-traitant. Le Partenaire reconnaît la version en vigueur jointe en Annexe 1.

**2 ter.7 — Registre et coopération autorités**

NativeSquare SAS tient à jour un registre des traitements (article 30.2 RGPD) et coopère avec la CNIL sur demande. Le Partenaire reconnaît son obligation de tenue de son propre registre en tant que responsable de traitement.
```

### P0 #5 — Nouvel Article 4 bis

À insérer après Article 4 :

```markdown
## **Article 4 bis — Distinction marque concédée vs données d'exploitation**

Il est expressément convenu que :

- La **marque concédée** (nom commercial, logo, identité visuelle, charte graphique, photos professionnelles produites par NativeSquare SAS, supports marketing) reste la propriété exclusive de NativeSquare SAS,
- Les **données d'exploitation** générées dans l'utilisation de la marque (historique de ventes Uber Eats sous la marque, avis et notations clients, panier moyen, items vendus, données comportementales) sont la propriété du Partenaire et peuvent être conservées, archivées, et utilisées par lui après la fin du contrat à des fins statistiques et de pilotage de son activité,
- La **réputation Uber Eats** (note moyenne, historique, ancienneté de la fiche) attachée à la marque concédée reste attachée à la fiche Uber Eats du Partenaire même après résiliation, sous réserve de l'obligation de rebranding définie à l'Article 5.4.
```

### P0 #6 — Réécriture Article 5.4

Remplacer le bloc bullets actuel par :

```markdown
**5.4 – Conséquences de la résiliation**

En cas de résiliation, quelle qu'en soit la cause :

- Le Partenaire cesse immédiatement toute utilisation de la marque KitchenBoost et de la marque concédée,
- Les sommes dues à la date de résiliation restent exigibles,
- **Réversibilité des données clients** : dans un délai maximum de 30 jours suivant la résiliation effective, NativeSquare SAS met à disposition du Partenaire, à titre gracieux, un export structuré au format CSV/JSON contenant la liste des clients ayant commandé (email, téléphone, prénom, adresse, historique de commandes, total dépensé), la liste des abonnés aux notifications push avec date d'opt-in et device_type (les endpoints techniques push, étant cryptographiquement liés au domaine d'origine, ne sont pas portables — cette limitation technique est expressément portée à la connaissance du Partenaire et acceptée par lui), les avis et feedbacks reçus,
- **Continuation du service push pendant transition** : à la demande écrite du Partenaire, NativeSquare SAS peut maintenir l'envoi des notifications push pendant 60 jours supplémentaires pour permettre l'information des clients sur le changement, moyennant le tarif en vigueur,
- **Sort du nom de domaine personnalisé** : si le Partenaire utilise son propre domaine, il en conserve l'entière propriété. Si le Partenaire utilise un sous-domaine `<slug>.kitchen-boost.fr` fourni par NativeSquare SAS, ce sous-domaine est conservé actif en mode "fermé avec redirection" pendant 90 jours pour préserver les QR codes en circulation, puis libéré,
- **Sort des QR codes en circulation** : les QR codes physiques restent fonctionnels pendant 90 jours après résiliation pour préserver l'expérience client final. Au-delà, la PWA tenant est désactivée et redirige vers une page informant du changement,
- **Rebranding de la fiche Uber Eats** : dans un délai de 30 jours, le Partenaire doit retirer de sa fiche Uber Eats tout élément visuel et nominal de la marque concédée (nom, logo, photos produits brandées, description marketing). La note moyenne, l'ancienneté et les avis historiques restent attachés à la fiche du Partenaire,
- **Suppression définitive** : passé 60 jours suivant la livraison de l'export, NativeSquare SAS procède à la suppression des données clients (production + sauvegardes), sauf obligation légale de conservation (comptabilité 10 ans, factures Factur-X 10 ans),
- NativeSquare SAS conserve la propriété des outils, systèmes et code source développés indépendamment du Partenaire.
```

### P0 #7 — Annexes 1 et 2 (à créer en docs séparés)

À créer dans `docs/legal/` :
- `annexe_1_privacy_policy_pwa.md` (2-3 pages, modèle CNIL adapté)
- `annexe_2_cgu_pwa_client_final.md` (vente entre client et resto, KB prestataire tech)

Et à référencer en bas du contrat avant les signatures :

```markdown
### Annexes au présent contrat

* **Annexe 1** — Politique de confidentialité de la PWA (Privacy Policy)
* **Annexe 2** — Conditions Générales d'Utilisation de la PWA (CGU client final)
```

---

## 4. Formulations P1 (résumé, full text dans rapports agents)

**Article 1.2 — enrichir prestations** : ajouter PWA + Stripe Connect + Web Push + QR stickers + Onboarding RDV install (cf §3 rapport agent 1).

**Article 3 ter — Setup costs** : nouvel article chiffrant 354-444€ HT (stickers + domaine + frais Uber + opérationnel) + transparence "KB ne marge pas dessus" + facture détaillée à la mise en place.

**Article 3 quater — Incidents livraison** : resto reste redevable Uber Direct même livraison ratée, refund client à sa charge, KB met à dispo logs API/webhook/GPS sous 48h.

**Article 11.2 — étendre exclusions** : downtime PWA KB (objectif SLA 99%/mois), suspension Stripe Connect Express.

**Article 14 bis — PWA/CGU/domaine/cookies** : CGU annexées, propriété domaine selon choix, cookies strictement nécessaires.

---

## 5. Impact sur `tools/generate_contract.py`

**Aucune modification de code nécessaire.** Le script lit le template + applique des `patches` JSON — il reste valide.

**MAIS** : 3 effets de bord à anticiper quand on modifiera le template :

1. **`HTML_HIGHLIGHTS`** dans `generate_contract.py` contient en dur la phrase "2,00€ chaque nouveau client/commande" qui n'existera plus → highlight jaune absent (cosmétique, pas bloquant)
2. **`clients/_blank/legal/contract_config.json`** et `thai-street-saint-michel` et `japonais-falguiere` ont des `patches` sur Article 3 ancienne version → leur `old` ne matchera plus → `apply_patches` lèvera `ValueError`. **Action requise** : régénérer ces 3 configs après modif template
3. **Mode `--verify`** : tous les contrats déjà signés (Khan, Caverne, Crêperie, Ya Hala) seront marqués "différent du template + config" — c'est attendu, ils restent valables comme contrats signés à l'ancienne version

---

## 6. Plan d'action recommandé

### Bloc 1 — Avant soft launch Buns & Bao (cette semaine)

1. Réécrire Article 3 (P0 #1 + #2)
2. Réécrire Article 2 bis.1 (P0 #3)
3. Ajouter Article 2 ter (P0 #4)
4. Ajouter Article 4 bis (P0 #5)
5. Réécrire Article 5.4 (P0 #6)
6. Créer Annexe 1 (Privacy Policy PWA) — `docs/legal/annexe_1_privacy_policy_pwa.md`
7. Créer Annexe 2 (CGU PWA client final) — `docs/legal/annexe_2_cgu_pwa_client_final.md`
8. Régénérer les 3 contrats existants (`_blank`, `thai-street-saint-michel`, `japonais-falguiere`) + mettre à jour leurs `contract_config.json` si patches obsolètes

### Bloc 2 — Avant le 5e resto signé

9. Enrichir Article 1.2 prestations
10. Ajouter Article 3 ter setup costs
11. Ajouter Article 3 quater incidents livraison
12. Compléter Article 11.2 (PWA SLA + Stripe suspendu)
13. Ajouter Article 14 bis (CGU/domaine/cookies)

### Bloc 3 — Avant resto pro

14. Ajouter Article 8 bis exclusivité canal direct
15. Reformuler Article 9 transparence
16. Ajouter Article 12 bis fallback livraison
17. Assouplir Article 13 communication
18. Créer Annexe 3 DPA séparé

### Coût estimé

- **Rédaction Bloc 1** : 4-6h de travail (Claude + validation Alex)
- **Validation juriste** (recommandée) : 300-500€ via cabinet ou ~150€ via plateforme Captain Contrat / Legalstart
- **Bloc 2 + 3** : étalable sur 1-2 mois

---

## 7. Risques juridiques de NE PAS appliquer le Bloc 1

| Risque | Probabilité | Impact |
|---|---|---|
| Marge KB négative sur paniers >117€ | **Élevée** dès qu'un resto fait des familles/groupes | KB perd ~1-3€/cmd sur gros paniers (~5% des cmd) |
| Contestation mandate Stripe Connect (création compte au nom du resto sans mandat explicite) | Moyenne | Litige potentiel, risque civil |
| Plainte CNIL d'un client final mécontent (pas de Privacy Policy) | Faible Phase 1 → Moyenne à 1000+ users | Amende 10-100K€ probable + réputation |
| Resto pro (chaîne) demande DPA pour signer → blocage closing | **Moyenne dès maintenant** | Perte de deals pro |
| Resto résilie et demande "ses données" → litige | Moyenne | Temps + tribunal commerce |
| Mauvaise foi resto post-résiliation : continue à exploiter marque virtuelle | Faible | Litige PI long et coûteux |

---

## 8. Sources

- Rapport agent 1 (économique + opérationnel) — full text dans la conversation 2026-05-21
- Rapport agent 2 (juridique + RGPD edge cases) — full text dans la conversation 2026-05-21
- [docs/legal/contrat_template.md](contrat_template.md) — contrat actuel
- [docs/plans/onboarding_restaurateur_process.md](../plans/onboarding_restaurateur_process.md) — process opérationnel
- [docs/research/uber_direct_deep_dive.md](../research/uber_direct_deep_dive.md) §2.1, §2.3, §3.1 — sources économiques + refunds
- [docs/research/web_push_pwa.md](../research/web_push_pwa.md) — push + ePrivacy
- [CLAUDE.md](../../CLAUDE.md) — setup costs 354-444€
- RGPD (Règlement UE 2016/679) — articles 4, 26, 28, 30
- Directive ePrivacy 2002/58/CE — opt-in push
- Loi Informatique et Libertés, art. L. 34-5 CPCE — prospection électronique
