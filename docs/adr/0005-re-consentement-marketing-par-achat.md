---
status: accepted
date: 2026-05-24
deciders: Alex
---

# Re-consentement marketing par achat (réactivation automatique au re-checkout)

## Contexte

Le client final KitchenBoost peut se désinscrire du marketing à tout moment via un lien `unsubscribe` dans n'importe quel push/email marketing (cf. CONTEXT notifications, [[Unsubscribe global]]). Question : si Sophie unsubscribe puis revient acheter chez Buns & Bao 30 jours plus tard, reste-t-elle opt-out à vie, ou son nouveau checkout réactive-t-il son consentement marketing ?

Position business Alex : un client qui revient acheter manifeste de l'intérêt — le re-engager via marketing est légitime. Position juridique stricte RGPD : un opt-out persiste jusqu'à un nouveau consentement explicite, un simple re-achat ne constitue pas un re-consentement.

## Décision

**V1 = chaque [[Checkout]] vaut nouvelle acceptation des CGV incluant le consentement marketing.** Un client qui a fait [[Unsubscribe global]] et qui recommande **réactive automatiquement son consentement marketing** à la finalisation de la nouvelle cmd. Repose sur un **wording CGV explicite** affiché au checkout :

> *En finalisant ta commande, tu acceptes les CGV de **\<Resto\>** et le service de fidélité **\<Marque KB\>** (carte commune + offres réseau). Tu peux te désinscrire à tout moment via le lien dans chaque message ; ta prochaine commande vaut nouvelle acceptation.*

La dernière phrase fait le travail juridique : le client ne peut pas dire "j'avais unsubscribe" parce qu'au checkout suivant il a re-validé en finalisant.

**Granularité unsubscribe V1 = globale.** Un seul click unsubscribe sort le client de toute la base marketing (tenant + cross-tenant). Granularité par tenant/scope reportée V2. Le [[Push transactionnel]] reste actif quoi qu'il arrive (base contractuelle).

## Considered options

1. **Re-consentement par achat (choix retenu)** — réactivation auto au re-checkout, wording CGV explicite. Pattern proche Uber Eats. Reach max, friction nulle, risque CNIL réduit mais non éliminé.
2. **Prompt actif au prochain checkout** — bannière "Tu t'es désinscrit, tu veux reprendre ?" + bouton Oui/Non. Conversion estimée 20-30 %. 100 % RGPD-safe mais friction perçue.
3. **Re-add carte Wallet = re-consentement** — Sophie doit re-faire l'étape d'ajout de la carte Wallet KB pour re-opt-in. Cohérent avec le pattern initial. Friction moyenne (re-onboarding minimal).
4. **Pas de re-opt-in (RGPD strict)** — une fois opt-out, Sophie reste opt-out à vie sauf action explicite de sa part dans les settings. Reach minimal sur les clients qui unsubscribent.

## Pourquoi ce choix

- **Pattern Uber Eats** = précédent concurrentiel fort. Si la pratique passe pour Uber (avec leurs moyens juridiques), elle passe pour KB Phase 1.
- **Reach business** : 80-100 % des clients re-acheteurs reviennent dans la base marketing automatiquement vs 20-30 % avec prompt actif. Sur une base de 5K clients/mois avec 5 % opt-out/mois, l'écart compose vite.
- **Cohérence avec Article 2 ter contrat + [[Soft opt-in L34-5]]** — la logique "le client utilise un service KB en s'engageant via le checkout" est tenable juridiquement si le wording est explicite et que l'unsubscribe reste effectif.
- **Risque CNIL assumé** — Alex décide d'assumer le risque résiduel ("problème de riche") en Phase 1 vu :
  - Taille KB (< 10 restos V1 = pas dans le radar CNIL)
  - Délai de procédure CNIL (12-24 mois en pratique) qui laisse le temps de pivoter si nécessaire
  - Sanction première CNIL négociable à 30-50 % du barème pour startup

## Conséquences

- **Wording CGV obligatoire au checkout V1** : la phrase "ta prochaine commande vaut nouvelle acceptation" doit apparaître dans chaque footer paiement, sans exception. Sans elle, l'argument juridique tombe.
- **CGU KB consumer-side** à rédiger avec avocat (1-2 pages) : carte commune + offres réseau + re-consentement par achat + lien unsubscribe. À mettre en ligne accessible depuis chaque push/email marketing.
- **Risque audit CNIL** détectable trivialement (`customer_id WHERE opt_out_date < last_push_date`). En cas d'audit, l'argument défensif sera le wording CGV — il doit donc être conservé en archive horodatée (versioning CGV).
- **Communication terrain Alex** : pas besoin d'expliquer aux restos, mais à anticiper dans le pitch commercial Phase 2+ ("votre base marketing s'auto-régénère naturellement à chaque cmd").
- **Granularité unsubscribe V2** : si analytics V1 montre un churn important sur le canal cross-tenant qui contaminerait le tenant, splitter en V2 (option B "granulaire par tenant/cross-tenant séparés"). Pour l'instant, garde-fou opérationnel = limiter cross-tenant à ≤ 1 push / mois / client les 3 premiers mois.
- **Cas signaux faibles** : si KB observe un même client unsubscribe ≥ 3 × consécutivement (re-opt-in via cmd → unsub → re-cmd → unsub → re-cmd → unsub), passer en mode "respect strict" pour ce client (plus de réactivation auto, prompt actif requis). Implémentation V2.

## Hard to reverse pourquoi

Le wording CGV, le schéma DB (`marketing_opt_out_date` vs `last_checkout_date`), l'archivage CGV horodaté, et l'éducation des clients passés via l'envoi de push après leur unsub initial — tout repose sur ce principe. Changer en V2 ou V3 vers RGPD-strict (option 4) signifierait re-écrire les CGV, re-éduquer la base, et probablement re-demander explicitement le consentement à tous les clients passés par un re-opt-in (coût acquisition relancé).

À l'inverse, raffiner V2 vers une granularité plus fine (option 2 ou 3 sur des sous-segments) est trivial : ajouter un prompt actif sur les clients à risque (3+ unsub) sans toucher au pattern principal.

Conditionne aussi :
- Le wording CGV au checkout (Article CGV à ajouter)
- Le contrat resto (information du resto sur le pattern de re-opt-in auto)
- Le moteur Notifications (`marketing_eligible(customer_id)` = `last_checkout_date > marketing_opt_out_date`)
- Le pitch commercial Phase 2+
- L'archive RGPD pour défense en cas d'audit
