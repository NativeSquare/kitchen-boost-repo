# Pricing

Le contexte du moteur de règles configurables qui détermine **qui paie quoi sur la livraison** (resto vs client). Différenciation forte vs Uber Eats qui impose un modèle uniforme. Évalué au checkout, transparent côté client.

PRD : [35_pricing_engine.md](../../prd/35_pricing_engine.md)

## Language

**Rule** (Règle) :
Unité de configuration créée par le resto dans [[KB Admin]]. Composée de **conditions** (toutes vraies pour matcher) et d'une **action** (impact sur frais livraison). Activable/désactivable. Pas de limite produit sur le nombre de règles (acté 2026-05-25) ; 1 à 5 règles en pratique, plafond technique généreux only.
_Avoid_: Policy, Promotion, Discount

**Condition** :
Critère booléen évaluable au checkout. **Liste fermée V1 (6 conditions)** : `total_panier` (≥, ≤), `première_cmd_client` (bool), `nombre_cmds_client` (≥, ≤), `plage_horaire` (HH:MM–HH:MM), `jour_semaine` (LU…DI), `contient_item` (catégorie ou item). AND logique entre conditions d'une même règle. **Retirées V1** : `distance_livraison_km` (géré par Uber Direct qui refuse le quote hors zone) ; `mode_livraison` (pickup = pas de frais livraison, géré en amont du moteur). Q35-Q (set conditions V1) acté 2026-05-23.
_Avoid_: Predicate, Filter, Critère (acceptable français)

**Action** :
Effet d'une règle qui matche sur les frais de livraison. Liste fermée V1 :

- `livraison_offerte_resto` : resto absorbe 100% du coût brut Uber Direct, client paie 0.
- `frais_livraison_part_resto_fixe = X €` : resto absorbe X € (capé au coût brut), client paie le reste.
- `frais_livraison_part_resto_pourcentage_panier = X%` : resto absorbe X% du **total panier** (capé au coût brut Uber Direct), client paie le reste. Le % se calcule sur le panier (pas sur le coût livraison) — s'auto-adapte à la taille du panier.

**KB ne subventionne jamais la livraison V1** (action `livraison_offerte_client` retirée du moteur — si Alex veut subventionner une cmd au lancement, c'est hors moteur via avoir manuel).
_Avoid_: Effect, Outcome

**Priorité** :
Quand plusieurs règles matchent un même panier, **une seule s'applique** (jamais de cumul V1). La règle gagnante est celle qui **minimise les frais de livraison facturés au client** (= maximise la part absorbée par le resto). Exemple : panier 30 € nouveau client, règle A (« ≥ 25 € → offerte ») et règle B (« 1ère cmd → 50% absorbé ») matchent toutes les deux → A gagne (client paie 0 € au lieu de 2,95 €). Comportement déterministe, pas de paramétrage d'ordre côté resto. Q35-Q2 acté 2026-05-23.
_Avoid_: Ranking, Order, Stacking, Cumul

**Règle par défaut KB (onboarding)** :
À la création d'un tenant (wizard `KitchenBoost Admin`), KB pré-installe automatiquement **une règle par défaut** dans le pricing du resto : `action = frais_livraison_part_resto_pourcentage_panier = 10%`, **aucune condition** (s'applique à toute commande delivery). Le resto absorbe 10% du panier (capé au coût brut Uber Direct), le client paie le delta. **Cette règle est validée et ajustée avec le resto au moment de l'installation Phase C** (kickoff onboarding) — Alex montre au resto l'effet de la règle sur 3 paniers types (petit / moyen / gros) et confirme/modifie. Le resto peut ensuite désactiver, supprimer, ou enrichir avec d'autres règles. Q35-Q (règle défaut onboarding) acté 2026-05-23.
_Avoid_: Default rule (acceptable EN), Catch-all

**Fallback rule** (filet de sécurité) :
Si après évaluation, **aucune règle (ni la règle par défaut, ni les règles créées par le resto) ne matche** (ex: resto a supprimé la règle par défaut et n'a rien créé) → `frais_livraison_client = coût_brut_uber_direct` (le client paie tout). Filet de sécurité technique, pas une stratégie commerciale.
_Avoid_: Default, Catch-all

**Frais livraison client / resto** :
Output du moteur : décomposition du coût brut Uber Direct entre la part facturée au client (intégrée au PaymentIntent) et la part absorbée par le resto (sur sa marge nette). **Invariant strict V1 : `client + resto = coût brut Uber Direct`**. Le resto **ne peut pas marger** sur la livraison V1 (pas de règle qui facture > coût brut au client). Justification : promesse transparence prix KB + éviter perception « resto se sucre sur la livraison ». Ouverture marge livraison resto = V2 si demande forte observée terrain.
_Avoid_: Customer share / Merchant share

**Coût brut Uber Direct** :
Le tarif retourné par le `delivery_quote` Uber. ~5,90 € HT IDF, variable selon distance / surge. Input du moteur. Capturé au moment du **paiement**, pas du panier (anti-surge drift).
_Avoid_: Delivery fee (ambigu — peut désigner le total facturé client)

**Latching** :
Politique d'évaluation finale du prix livraison **au moment du paiement** (pas du panier). Q35-Q5 acté 2026-05-23 :

- À l'ouverture du panier, le moteur affiche un prix livraison **indicatif** basé sur l'état courant des règles + quote Uber Direct.
- Au clic « Payer », le moteur **ré-évalue** (règles actuelles + quote Uber Direct rafraîchi).
- Si le nouveau prix livraison est **identique ou plus avantageux pour le client** → on applique silencieusement (pas de prompt).
- Si le nouveau prix livraison est **moins avantageux pour le client** (Khan a désactivé une règle, ou surge Uber) → **prompt explicite obligatoire** : « Le tarif livraison est passé de X € à Y €, confirmes-tu ? ». Pas de paiement tant que pas confirmé.
- Pas de figeage au panier — assume une volatilité légère entre panier et paiement.
  _Avoid_: Snapshot (acceptable mais "latching" plus précis), Freezing

**Affichage prix livraison (PWA client)** :
Quand une règle resto réduit les frais livraison, la PWA affiche **prix barré + montant final + mention "Offert par [Nom du resto]"** (ex: `̶5̶,̶9̶0̶ ̶€̶ → 0,00 € — Offert par Buns & Bao`). Wording dynamique selon l'action (offerte / -X € / -X%). **Jamais de mention "KitchenBoost"** dans le wording client — le client est sur la plateforme du resto, point. Garde-fous légaux : prix barré = coût brut Uber Direct réel (cohérent Code Conso L121-1), wording dit explicitement que c'est le resto qui offre. Q35-Q4 acté 2026-05-23.
_Avoid_: Discount, Promo, Reduction (utiliser "offert par le resto")

**Simulator** (V2) :
Outil de prévisualisation dans [[KB Admin]] : "si un client X commande Y € à Z heure, voici la règle qui matche et le montant client / resto". Aide à comprendre les effets avant publication.
_Avoid_: Preview, Test mode

## Example dialogue

**Alex** : Khan veut "livraison offerte au-dessus de 25 €". Comment je traduis ?

**Dev** : Une seule **règle**. Condition : `total_panier >= 25`. Action : `livraison_offerte_resto`. Le coût brut Uber Direct est alors absorbé 100% par Khan, sa marge nette s'en trouve réduite. Côté client, le panier passe de "+5,90 € livraison" à "Livraison offerte par le resto (-5,90 €)".

**Alex** : Et si on a deux règles qui matchent ?

**Dev** : V1 : sélection **déterministe** — la règle gagnante est celle qui **minimise les frais facturés au client** (= maximise la part absorbée par le resto). Pas d'ordre manuel, pas de drag & drop (Q35-Q2). Jamais de cumul de 2 règles.

**Alex** : Le `application_fee_amount` change selon le pricing ?

**Dev** : Non. `application_fee_amount` reste à 240 (2,40 € TTC) par cmd, indépendant des règles pricing. Seul le montant **total facturé** Stripe varie : panier + part client de la livraison.

**Alex** : Et si le quote Uber surge entre le panier et le paiement ?

**Dev** : On capture le quote au moment du **paiement** (latching). Si Khan a une règle `livraison_offerte_resto`, c'est lui qui mange le surge — c'est conscient.
