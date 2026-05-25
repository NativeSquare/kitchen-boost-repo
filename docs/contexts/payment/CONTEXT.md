# Payment

Le contexte du paiement entre le client final et le resto, médié par Stripe Connect Express. KB n'est **PAS** merchant of record : direct charges sur le compte Stripe du resto, KB perçoit une commission via `application_fee_amount`.

PRD : [30_paiement_stripe_connect.md](../../prd/30_paiement_stripe_connect.md)

## Language

**Stripe Connect Express** :
Modèle Stripe où chaque resto a son propre compte Stripe (acct_xxx), onboardé via `account_link`. Le resto est seul vendeur (KYC, IBAN, disputes lui appartiennent). KB n'a pas d'agrément ACPR. **Onboarding fait en Phase C kickoff sur place avec Alex** (pas un lien magique envoyé à distance) — Alex génère le `account_link` en live, le resto complète KYC + IBAN avec lui à côté (~10-15 min). Garantit complétion immédiate, pas de tenant `pending` indéfini. Si pour une raison le RDV Phase C n'aboutit pas → relève du process [[KB Admin]] pipeline onboarding, pas d'auto-suspend côté payment. Q30-Q5 (timeout 14j) sans objet, acté 2026-05-23.
_Avoid_: Stripe Standard, Stripe Connect (sans préciser Express)

**Direct charge** :
Pattern Stripe Connect où le PaymentIntent est créé sur le compte du resto avec `on_behalf_of=acct_resto`. La transaction n'apparaît PAS dans le compte Stripe KB. Opposé à "destination charge" (non utilisé chez KB).
_Avoid_: Charge resto, Split payment

**PaymentIntent** :
Objet Stripe représentant l'intention de paiement. Possède un cycle de vie : `requires_payment_method` → `processing` → `succeeded` ou `payment_failed`. KB écoute les webhooks `payment_intent.*` pour orchestrer la suite.
_Avoid_: Transaction (terme bancaire générique)

**application_fee_amount** :
Champ Stripe en **centimes TTC** indiquant la part qui va à KB (compte plateforme). **V1 : valeur fixe immutable 240 (2,40 € TTC = 2 € HT + 20 % TVA) pour tous les tenants** — pas d'écran de config dans [[KB Admin]], pas de négociation tarifaire opérationnelle. Stocké HT en DB pour reporting comptable. Gestes commerciaux V1 (ex: mois gratuit early adopter) gérés en **avoir manuel hors-système** (décompte sur facture mensuelle), pas via modification du `application_fee_amount`. **V2 : champ rendu configurable par tenant** depuis [[KB Admin]] root (Alex uniquement) pour outiller paliers commerciaux scaling (chaînes, partenariats). Q30-Q1 acté 2026-05-23.
_Avoid_: Commission, Fee KB (utiliser le terme Stripe exact)

**on_behalf_of** :
Champ Stripe désignant l'acct_resto comme "vendeur économique" du paiement. C'est lui qui supporte les **frais d'acceptation des paiements** (commission monétique Stripe : 1,5 % + 0,25 €). Pass-through obligatoire (cf. [feedback_kb_commission_model](../../../.claude/memory/feedback_kb_commission_model.md)).
_Avoid_: Payee, Settlement account

**Frais d'acceptation des paiements** (Commission monétique) :
Frais Stripe variables selon origine carte : **1,5 % + 0,25 €** cartes EU, **3,25 % + 0,25 €** cartes hors UE (touristes, expats). Supportés intégralement par le resto via `on_behalf_of` (pattern pass-through). Analogues aux commissions monétiques d'un TPE bancaire (Article 3.3 contrat — "tarifications du PSP s'appliquent"). À ne pas confondre avec `application_fee_amount`. **V1 : aucun filtrage au checkout, aucune alerte resto** — cartes hors UE acceptées silencieusement, le resto absorbe le surcoût (volume hors UE attendu marginal, drop client > marge sur 1 cmd). V2 envisagera reporting transparent dans vue paiements [[KB Admin]] ("X cmds hors UE ce mois = +Y € frais"). Q30-Q2 acté 2026-05-23.
_Avoid_: Frais Stripe (ambigu — Stripe a plein de frais), Processing fees

**Stripe Customer (cross-tenant)** :
Objet Stripe `Customer` stocké au **niveau du compte plateforme KB** (pas tenant), auquel sont attachés les `PaymentMethod` (cartes) du client final. Au moment d'une cmd chez le resto X, KB **clone** le `PaymentMethod` vers le compte connecté du resto X via l'API Stripe `clone PaymentMethod` ([doc officielle](https://docs.stripe.com/connect/cloning-customers-across-accounts)), puis fait une direct charge avec la carte clonée. La cmd suivante chez le resto Y → re-clone vers Y. Le `PaymentMethod` original sur le compte KB reste intact. **Activé V1** (Q14 master / Q30-Q acté 2026-05-23). Conséquence UX : carte sauvegardée réutilisable cross-resto KB en un tap.
_Avoid_: Customer (ambigu avec [[Customer Data]] côté KB), Saved card, Shared card

**Sauvegarde carte (UX V1)** :
Checkbox au checkout PWA libellée **« Sauvegarder ma carte pour mes prochaines commandes »** — wording neutre, **aucune mention "KitchenBoost"**, aucune précision sur le scope (resto courant ou réseau). Si coché → `PaymentMethod` attaché au [[Stripe Customer (cross-tenant)]] côté plateforme KB. Conséquence implicite côté client : à la 2ème cmd chez un autre resto KB, sa carte apparaît préchargée — pas d'écran d'explication, pas de message "compte unifié". Choix produit assumé : effet réseau **partiellement visible** côté UX V1 (la CB préchargée trahit l'existence du backend partagé), mais **jamais brandé KB**. Garde-fou compliance : Stripe n'impose pas de mandate explicite pour les cartes EU (contrairement aux ACH US). Risque résiduel : client surpris à la 1ère réutilisation cross-resto → chargeback "carte volée". À monitorer en prod. Q30-Q (UX cross-tenant V1) acté 2026-05-23.
_Avoid_: Save card, Card vault, Carte enregistrée (utiliser le wording verbatim ci-dessus)

**Refund** :
Annulation **totale uniquement** d'un paiement en V1 (refund partiel item-level = V2). Trigger principal V1 = [[Refusal]] côté [[KB Orders]]. Appel `POST /refunds` Stripe + push client "remboursé". Pas de remboursement KB de sa commission si refund (Article 3.3 contrat). **Workaround rupture partielle V1** : le resto consulte le numéro du client (visible sur la cmd active dans [[KB Orders]], cf. [[Contact cmd active]]) et peut l'appeler pour proposer un remplacement avant d'accepter ou refuser. Pas de modification cmd côté système — soit le resto accepte tel quel (avec swap oral), soit il refuse → refund total. Q30-Q (refund partiel V1) acté 2026-05-23.
_Avoid_: Reimbursement, Cancel payment, Refund partiel (V2)

**Cmd avortée** :
Cas où le paiement Stripe a réussi (PaymentIntent `succeeded`) mais où la création de course [[Delivery]] échoue (plus de courier dispo, surge insurmontable, panne API Uber Direct). **V1 = refund auto total immédiat** + push client "Désolé, la livraison n'est pas possible pour le moment, vous êtes remboursé". La cmd **n'est jamais transmise** à [[KB Orders]] — le resto ne voit rien. Distinct de [[Refund]] standard (qui lui suit un [[Refusal]] resto). Cohérent avec couplage strict paiement ↔ livraison V1 : si l'un échoue à la création, on annule tout. V2 envisagera bascule click & collect proposée au client (pour sauver les cmds + meilleure marge nette resto pickup). Le cas "quote initial refuse car resto hors zone" est intercepté **avant** le paiement (pas de PaymentIntent créé) — distinct de la cmd avortée. Q30-Q (échec Uber Direct post-paiement) acté 2026-05-23.
_Avoid_: Failed order, Cancelled order, Aborted order (réserver "avortée" pour cet état précis)

**Contact cmd active** :
Le numéro de téléphone + prénom du client sont **affichés sur la cmd active** dans [[KB Orders]] (vue détail cmd). Permet au resto d'appeler en cas de souci opérationnel (rupture item, adresse douteuse, instructions spéciales). **Exception encadrée au principe [[Customer Data]] anti-extraction** : l'accès est nominatif **uniquement sur une cmd en cours**, pas dans la vue agrégée "Mes clients" qui reste masquée V1. Audit log de chaque consultation cmd (cohérent Q90-Q5). Aucun bouton "copier le numéro" / "exporter" — affichage direct dans l'écran cmd.
_Avoid_: Customer phone, Contact client (génériques)

**Facture KB → resto (V1)** :
**Facture mensuelle PDF nominative envoyée par mail à chaque resto fin de mois**, générée **manuellement par Alex** (template Word/Excel à partir du listing Stripe `application_fee_amount` perçus sur le mois). Détaille : N cmds × 2 € HT + TVA 20 % = total TTC. Permet au resto la déduction TVA (CGI compliant) et l'écriture comptable propre. Pas d'auto-génération système V1 — Alex passe ~30 min/mois × N restos. Pas d'archivage [[KB Admin]] V1 (Alex stocke localement / Drive). Couvre tous les restos signés, pas à la demande. Pas de vue paiements [[KB Admin]] V1 — pour le détail transactionnel, le resto va sur son **Stripe Dashboard natif** (rapports détaillés `application_fee_amount` + frais d'acceptation + payouts). **V2 : auto-génération PDF + envoi automatique + archivage [[KB Admin]]** quand volume restos le justifie. Q30-Q (facture V1) acté 2026-05-23.
_Avoid_: Invoice (acceptable), Note de débit, Quittance

**Apple Pay / Google Pay** :
Wallets activés via **Stripe Payment Element** (PaymentIntent automatic_payment_methods). Activés dès V1 pour fluidité mobile. Pas de SDK natif additionnel.
_Avoid_: Wallet pay (générique), Mobile pay

**KYC** :
Know Your Customer — vérification Stripe d'identité du resto. Statuts : `pending`, `verified`, `rejected`. Si pending > 48h → alerte Slack ops. Si rejected → plan B Mangopay (V3).
_Avoid_: Identity check, Compliance

**Chargeback** :
Litige initié par le client via sa banque (motifs typiques : "cmd non reçue", "fraude carte", "produit non conforme"). Le resto a 7-14 jours pour fournir preuves de livraison + conversation client via son Stripe Dashboard natif. 20 € de frais Stripe par chargeback perdu, à la charge du resto (cf. Article 3.3 contrat). **V1 process : KB monitoring + Alex notifie manuellement le resto** :
- Webhook `charge.dispute.created` → Slack ops (Alex)
- Alex contacte le resto par WhatsApp/téléphone (canal direct V1) avec récap : ID cmd, montant, motif, deadline
- Le resto se connecte à **son Stripe Dashboard** (natif, déjà outillé : formulaire preuves, timeline, upload) et répond
- KB ne relaie pas à Stripe via API, KB ne stocke pas les preuves
- Pas d'UI dans [[KB Admin]] V1
- V2 : email auto resto + alerte [[KB Admin]] (badge "Litige") quand volume disputes le justifie
- V3 : outillage complet [[KB Admin]] (upload preuves depuis KB, relais API)
Q30-Q6 acté 2026-05-23.
_Avoid_: Dispute (acceptable mais "chargeback" plus précis), Rejection bancaire

## Example dialogue

**Alex** : Un client paie 30 € chez Buns & Bao avec Apple Pay. Qui touche quoi ?

**Dev** : Direct charge sur acct_buns-bao avec `on_behalf_of=acct_buns-bao`. Stripe prélève la commission monétique sur le resto : 30 × 1,5% + 0,25 = 0,70 €. Puis `application_fee_amount=240` (2,40 € TTC) va sur le compte plateforme KB. Le resto reçoit 30 - 0,70 - 2,40 = 26,90 €.

**Alex** : Si Khan refuse la cmd dans [[KB Orders]] ?

**Dev** : L'événement [[Refusal]] déclenche un `POST /refunds`. Le client est intégralement remboursé. KB ne se rembourse PAS sa commission (Article 3.3 contrat). Le resto perd aussi sa part de frais d'acceptation.

**Alex** : Et si le client veut payer avec sa carte sauvegardée chez un autre resto KB ?

**Dev** : C'est le pattern Stripe Customer cross-tenant. Q14 du master — subject to PoC. Si OK, on stocke le Customer au niveau KB (pas tenant) et on attache la PaymentMethod au compte Connect au moment du paiement. Si PoC échoue, on tombe sur Apple Pay / Google Pay pour la fluidité.
