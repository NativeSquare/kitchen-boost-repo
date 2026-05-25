# Notifications

Le contexte des canaux de communication transactionnels et marketing : push web (PWA client), push système (app native resto), email, SMS fallback. Triggers transverses depuis tous les contextes métier.

PRD : [80_notifications.md](../../prd/80_notifications.md)

## Language

**Moteur Notifications** :
Bounded context isolé exposant une **API métier** appelée par les autres contextes (Orders, Delivery, KB Admin, Customer Data). L'API est sémantique (events métier + campagnes + enrollment), **pas technique**. Le moteur décide seul des canaux à activer selon ses [[Cascade marketing]] / [[Catégorie transactionnelle]] hardcoded V1. Conséquence : changer de canal (ajouter In-App V2, retirer SMS) = modif interne au moteur, zéro impact appelants.
_Avoid_: Notification service, Sender

**Push transactionnel** :
Notification déclenchée par un événement métier nominal (cmd payée, refund, courier dropoff, livré, etc.). **Toujours actif** côté client final (pas d'opt-out, base contractuelle = exécution du contrat de vente). Le canal exact dépend de la [[Catégorie transactionnelle]] (Archive / Temps-réel / Info statut).
_Avoid_: Operational push, Service notification

**Catégorie transactionnelle** :
Classification des triggers transactionnels en 3 catégories qui déterminent le routage canal hardcoded V1 :
- **Archive** (cmd payée confirmation, refund émis, course Uber refusée) → [[Push web]] + [[Wallet push]] + [[Email transactionnel]] (3 canaux, le client doit avoir trace écrite + lock-screen instant)
- **Temps-réel** (courier dropoff, cmd livrée, pickup ready C&C) → [[Push web]] + [[Wallet push]] (2 canaux lock-screen, pas d'email — info périme en 5 min)
- **Info statut** (cmd reçue cuisine, "en préparation", "en route") → [[Wallet update silencieux]] uniquement (la carte évolue visuellement, pas de push intrusif — sinon spam sur les 5 sous-étapes d'une livraison)
_Avoid_: Trigger type, Notification class

**Push marketing** :
Notification non liée à une cmd en cours, déclenchée manuellement via [[Campagne tenant]] ou [[Campagne cross-tenant]]. **Opt-in séparé** du transactionnel ([[Opt-in marketing]]). Soumis à [[Rate limit marketing]] global. Routé selon la [[Cascade marketing]] (1 canal effectif par client, pas multi-canal).
_Avoid_: Promo push, Commercial notification

**Cascade marketing** :
Règle de routage canal pour les [[Campagne]] : KB choisit **1 seul canal effectif** par client selon l'ordre de priorité, avec fallback si canal indisponible. **Deux cascades distinctes** selon le scope :
- **Cascade tenant** ([[Campagne tenant]]) : [[Push web]] > [[Wallet push]] > [[Email transactionnel]]. La PWA tenant offre la meilleure UX (rich content + deep link + branded resto). Fallback Wallet si push web inactif. Email en dernier recours.
- **Cascade cross-tenant** ([[Campagne cross-tenant]]) : [[Wallet push]] > [[Email transactionnel]]. La PWA tenant est exclue par design (pousser une promo Crêperie via la PWA Buns & Bao casserait l'expérience tenant). Wallet = seul canal cross-tenant légitime (marque consumer-side commune).
- **SMS exclu de la cascade marketing** (coût élevé jamais justifié pour du marketing, cf. [[SMS fallback]]).
_Avoid_: Channel priority, Fallback chain

**Push web** :
Canal push envoyé via Web Push API + VAPID, géré par service worker côté [[PWA standalone]]. **Subscription scoped au tenant** (1 origin = 1 channel) → utilisé pour transactionnel et [[Campagne tenant]] uniquement, **jamais cross-tenant**. iOS 16.4+ requiert A2HS au préalable. Coût ~0 €.
_Avoid_: Browser push, PWA push (ambiguë avec [[Push enrollment]])

**Wallet push** :
Canal push envoyé via Apple PassKit Web Service (APNs) ou Google Wallet API. **Channel commun KB** (carte Wallet commune sous marque neutre, cf. ADR 0003) → seul canal **cross-tenant** disponible. Lock-screen reach ~99 %. Format texte court (~150 chars), tap → ouvre Wallet → "back of pass" → URL associée (1 niveau indirection).
_Avoid_: Wallet notification, PassKit push

**Wallet update silencieux** :
Mise à jour du contenu visible de la carte Wallet (statut cmd, ETA, message) **sans déclencher de push lock-screen**. Le changement n'est visible que si le client ouvre Wallet de lui-même. Utilisé pour la [[Catégorie transactionnelle]] "Info statut" (étapes intermédiaires d'une cmd) pour éviter le spam.
_Avoid_: Silent push, Wallet refresh

**Image rich notification** :
Image incluse dans le **payload** d'une notification push (Wallet push ou Push web), affichée lock-screen le temps de la notification puis disparaissant. Distincte d'une mise à jour visuelle de la **carte Wallet elle-même** (qui reste neutre / marque réseau stable V1). Permet de personnaliser le visuel par campagne (ex: photo hot dog pour une promo hot dog) sans biaiser l'UX always-visible de la carte. Supporté par Apple PassKit (`thumbnailUrl` push payload), Web Push Android (Notification API `image`), Web Push iOS 16.4+ (limité).
_Avoid_: Wallet image (overloaded avec [[Wallet update silencieux]]), Push thumbnail

**Géo-filtrage cross-tenant** :
Filtrage amont d'une [[Campagne cross-tenant]] : KB ne pousse à Sophie une campagne "nouveau resto / promo Crêperie près de chez toi" que si (1) on a l'adresse connue de Sophie en base (extraite de son historique de cmds livraison) ET (2) cette adresse est dans la zone de livraison du resto poussé. Si pas d'adresse en base (ex: cliente C&C uniquement) → Sophie est **skippée** de la campagne cross-tenant géo-ciblée V1. Volume estimé skippé : < 10 %.
_Avoid_: Geo-targeting, Geo-fence

**Deep link tenant** :
URL de destination quand un client tape sur une notification push, déterminée par le type de trigger :
- **Push transactionnel** (toutes catégories) → page **Tracking** PWA du tenant, état correspondant au trigger (cmd payée = T+0, dropoff = "courier arrive", livré = "bon appétit" + CTA review)
- **Push marketing tenant** → **catalogue** PWA du tenant avec l'item promu **épinglé en haut** (upsell naturel sur le reste du menu vs item détail direct qui perd l'upsell)
- **Push marketing cross-tenant** → **home / catalogue** PWA du tenant cible (après [[Géo-filtrage cross-tenant]] amont). Si le client tape malgré tout et que l'address-first flow révèle pas de livraison possible → message d'erreur + suggestion de 3 autres restos KB qui livrent chez lui (fallback cross-sell réseau)
_Avoid_: Notification URL, Click target

**Push système** :
Cf. [[KB Orders]] CONTEXT.md. APNs (iOS) + FCM (Android). Fiabilité supérieure au push web. Côté resto uniquement V1 (pas d'app native client).
_Avoid_: Native push, App push

**VAPID** :
Voluntary Application Server Identification — paire de clés cryptographiques requise pour identifier le serveur émetteur des push web. Une paire par environnement (dev / prod).
_Avoid_: Push token (différent — c'est la subscription côté client)

**Push subscription** :
Objet stocké en DB qui identifie un device pour le push web : `endpoint`, `keys`, `customer_id`, `tenant_id`, `active`. Marqué `inactive` si endpoint expire (410 Gone).
_Avoid_: Token, Device ID

**Email transactionnel** :
Envoyé via **Resend** (free tier 100/jour, scaling cheap). Triggers : confirmation cmd, refund, welcome resto, alerte ops. Templates MJML ou React Email. Branding header KB + couleur primaire tenant.
_Avoid_: Mail (générique), Resend email

**SMS fallback** :
Canal extreme fallback transactionnel uniquement, **jamais marketing** (coût ~0,07 €/SMS jamais justifié pour du push commercial). Déclenché **uniquement** si le client n'a ni [[Push web]] ni [[Wallet push]] disponibles (cas rare avec [[Push enrollment]] bloquant V1 : iOS sans A2HS + sans Wallet enrôlé). Limité aux [[Catégorie transactionnelle]] **Archive** et **Temps-réel** (jamais Info statut). Cible : <5 % des clients. Coût marginal estimé : 0,5-1 €/mois/resto.
_Avoid_: Texto, SMS (utiliser "SMS fallback" pour préciser le contexte)

**Opt-in / Opt-out** :
État du consentement client par usage. **Transactionnel toujours actif** (base contractuelle, jamais opt-out V1). **Marketing** distinguer 2 régimes (cf. [[Opt-in marketing]]).
_Avoid_: Subscribe/Unsubscribe (acceptable), Granted

**Re-consentement par achat** :
Principe V1 : chaque [[Checkout]] vaut **nouvelle acceptation des CGV** incluant le consentement marketing. Conséquence : un client qui a fait [[Unsubscribe global]] puis recommande **réactive automatiquement** son consentement marketing à la finalisation de la nouvelle cmd. Repose sur un wording CGV explicite au checkout : *"ta prochaine commande vaut nouvelle acceptation"*. Légalement défendable uniquement si le wording est explicite et lisible (pas caché dans des CGU de 12 pages).
_Avoid_: Auto re-opt-in (silencieux, indéfendable), Reactivation

**Unsubscribe global** :
Action client de désinscription marketing : 1 click depuis n'importe quel push/email marketing → sortie totale de la base marketing (tenant ET cross-tenant). Le [[Push transactionnel]] reste actif (base contractuelle). Persistant jusqu'à la prochaine cmd qui déclenche [[Re-consentement par achat]]. V1 = un seul flag global. V2 = granularité (tenant / cross-tenant séparés).
_Avoid_: Désabonnement (générique), Opt-out

**Opt-in marketing** :
Consentement client pour recevoir du push marketing, organisé en **2 régimes distincts** V1 selon le scope :
- **Marketing tenant** ([[Campagne tenant]]) : pattern "pattern Uber" — **soft opt-in implicite via L34-5 CPCE** dès paiement d'une cmd chez ce resto. Aucune case à cocher au checkout. Wording footer : *"En finalisant ta commande, tu acceptes les CGV et la politique de confidentialité."* Justification : Khan = fournisseur existant pour Sophie, promo Buns & Bao = produit analogue à la cmd. Conforme L34-5 + unsubscribe obligatoire.
- **Marketing cross-tenant** ([[Campagne cross-tenant]]) : **consentement explicite matérialisé par l'acte d'ajout de la carte Wallet KB** (étape [[Push enrollment]]). Pas de case à cocher séparée — le geste d'ajouter la carte sous marque neutre KB après lecture d'une mention claire suffit (acte positif, libre, éclairé). Wording cible au-dessus du bouton "Ajouter au Wallet" : *"Ajoute la carte [Marque KB] : suivi de tes cmds + offres exclusives du réseau de restos partenaires."* L'option "Plus tard" doit rester disponible pour préserver le caractère libre du consentement. Conforme RGPD Article 6.1.a (consentement par action positive non équivoque). Le client qui skip Wallet reste contactable en push tenant uniquement.
_Avoid_: Marketing consent, Opt-in promo

**Soft opt-in L34-5** :
Régime légal français (Article L34-5 CPCE) qui autorise un fournisseur à pousser du marketing à ses clients existants sans opt-in explicite préalable, **sous 3 conditions** : (1) le client a déjà acheté chez ce fournisseur, (2) la communication porte sur des produits/services analogues, (3) le client peut s'opposer facilement (unsubscribe). Fondement juridique du marketing tenant V1.
_Avoid_: Implicit consent (trop vague), Legal exemption

**DNT** (Do Not Disturb) :
Plage horaire configurable par tenant pendant laquelle on n'envoie pas de push (ex: 22h-8h). Q80-Q3 = défaut systématique ou config par resto.
_Avoid_: Quiet hours, Mute

**Rate limit marketing** :
Plafond de push marketing par client final par semaine, **global tous restos + KB cross-tenant confondus**. V1 = 3/sem/client global (pas 3/sem/resto sinon spam). Indépendant des push transactionnels. Compteur partagé entre [[Campagne tenant]] et [[Campagne cross-tenant]].
_Avoid_: Throttling (technique sous-jacente), Quota

**Trigger** :
Événement métier qui déclenche un envoi (ex: `payment_intent.succeeded` → push "cmd reçue par cuisine"). V1 transactionnel = triggers fixés. V1 marketing = déclenchement manuel via [[Campagne]]. V2 = triggers comportementaux automatisés (panier abandonné, anniversaire auto).
_Avoid_: Hook (technique), Event listener

**Campagne** :
Envoi marketing déclenché manuellement par un acteur (resto ou KB root) depuis [[KB Admin]], à partir d'un [[Template campagne]] pré-validé, à un scope défini. Décompte du [[Rate limit marketing]] global. V1 = templates fixes uniquement (pas d'éditeur libre), V2 = personnalisation enrichie + A/B test.
_Avoid_: Broadcast, Mailing

**Campagne tenant** :
[[Campagne]] déclenchée par un resto depuis son [[KB Admin]] tenant, à scope = ses propres clients (ayant commandé chez lui ≥ 1× + [[Push enrollment]] actif + soft opt-in marketing L34-5). Use case : promo weekend, relance inactif tenant, nouveau plat. Khan n'écrit **pas** de texte libre V1 — il choisit un [[Template campagne]] dans la bibliothèque KB et remplit les variables.
_Avoid_: Resto campaign, Tenant push

**Campagne cross-tenant** :
[[Campagne]] déclenchée par KB root (toi) depuis la [[KB Admin]] root, à scope = clients du réseau KB indépendamment du tenant d'origine. Réservée à KB V1 (jamais accessible resto). Use case : "nouveau resto à 5 min de chez toi", "promo réseau du mois", "événement saisonnier réseau". KB peut utiliser des templates spécifiques cross-tenant ou créer du contenu libre (KB a la confiance totale sur le tone).
_Avoid_: Network push, Global push, Marketing KB

**Template campagne** :
Message pré-rédigé par KB, validé une fois, réutilisable N fois par les restos. Composé d'un corps texte avec variables interpolables (`{prenom_client}`, `{nom_resto}`, `{item_hero}`, `{discount}`, `{nom_plat}`, `{heure_debut}`, `{heure_fin}`, `{jour}`, etc.) + un deep link cible. **Garde-fous hardcodés V1** : `{discount}` ≤ 50%, longueur finale < 200 chars, français uniquement, pas de mention alcool. Bibliothèque V1 ~5-10 templates couvrant 90 % des intents CRM resto. Nouveau template = ticket support KB.
_Avoid_: Message preset, Boilerplate

**Scope** :
Sous-ensemble de clients ciblé par une [[Campagne]]. V1 = 2 valeurs uniquement (pas de segmentation V1, on simplifie) : (1) **tenant** = tous mes clients atteignables ayant commandé chez moi ≥ 1× + [[Push enrollment]] actif + opt-in marketing (côté resto), (2) **cross-tenant** = tous les clients KB opt-in marketing indépendamment du tenant d'origine (KB only). V2 = segments prédéfinis (actifs / inactifs / VIP). V3 = segmentation libre.
_Avoid_: Audience, Segment (acceptable mais préférer Scope V1)

**Modération pre-flight** :
V1 = **modération du contenu résolue par [[Template campagne]]** (les templates sont validés une fois par KB, Khan ne peut envoyer que des templates pré-approuvés). Reste un **technical guardrail automatique** sur les anomalies : campagnes >1 / 48h ou >3 / semaine pour un même resto → bloquage auto + alerte KB. Bond inattendu de la base destinataires (+50% vs précédent envoi resto) → bloquage auto. Pas de file d'attente "validation manuelle" récurrente côté KB.
_Avoid_: Approval, Review (overloaded avec [[Reviews gating]])

## Example dialogue

**Alex** : Quand une cmd est payée, qui reçoit quoi ?

**Dev** : Trigger `payment_intent.succeeded` → 3 envois en parallèle. (1) Client final = push web "votre cmd est en préparation" + email confirmation Resend. (2) Resto = push système APNs/FCM sur [[KB Orders]] (téléphone + tablette cuisine si installée). Tout en < 5 sec.

**Alex** : Et le client iPhone qui n'a pas A2HS ?

**Dev** : Pas de push web possible (iOS 16.4+ requiert A2HS). On envoie email + SMS fallback Twilio. ~30 % des iOS users tombent dans ce cas, Q80-Q1 décide si SMS activé par défaut.

**Alex** : Khan veut envoyer une promo aux inactifs.

**Dev** : Depuis [[KB Admin]] → Campagne → segment "Inactifs 30j" → template push → send. Backend filtre les clients ayant opt-in marketing ET pas atteint le rate limit 3/sem ET hors DNT. Envoie en proxy KB (jamais Khan en direct). Stats consolidées remontent dans le dashboard.

**Alex** : Si un client a opt-out marketing ?

**Dev** : Il continue de recevoir les push transactionnels (base contractuelle), zéro push marketing. Lien unsubscribe dans chaque push marketing pour retrait facile.
