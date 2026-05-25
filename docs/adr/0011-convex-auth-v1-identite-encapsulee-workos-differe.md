---
status: accepted
date: 2026-05-25
deciders: Alex
---

# Convex Auth V1, identité encapsulée, WorkOS différé

## Contexte

Le template NativeSquare embarque **Convex Auth** (password + OAuth Apple/Google/GitHub + anonymous adapter), stockant users/sessions/accounts **dans Convex**. Question soulevée : pour un SaaS à vocation entreprise, faut-il dès V1 un IdP managé type **WorkOS** (SSO SAML/OIDC, SCIM, directory sync) ?

Deux populations d'auth très différentes : les **customers** (clients finaux mangeurs, anonymous, volume — le « 1M utilisateurs ») et les **pros** ([[KB Admin]] / [[KB Manager]], login + RBAC, faible volume).

## Décision

**Convex Auth pour V1 et V2.** L'identité est **encapsulée derrière un point d'intégration unique** dans la foundation — `getCurrentActor(ctx)` — seul endroit du codebase autorisé à appeler `getAuthUserId`. Tous les wrappers (`tenantQuery` / `tenantMutation` / `kbAdminQuery`) le consomment ; **aucune fonction métier n'appelle Convex Auth directement**.

**Trigger de re-évaluation WorkOS** = apparition d'un besoin B2B entreprise côté pros (premier prospect exigeant SSO SAML / SCIM), **pas un seuil de volume** customers.

## Considered options

1. **Convex Auth V1, encapsulé (retenu)** — zéro intégration, déjà dans le template, réversible à coût maîtrisé grâce à l'encapsulation.
2. **WorkOS dès V1** — entreprise-ready immédiat (SSO/SCIM), mais intégration lourde + coût, pour un besoin inexistant en V1 (restaurateurs indés, customers anonymes).
3. **Auth maison** — contrôle total, mais réinventer password/OAuth/sessions = anti-MVP et viole « ne pas toucher la structure du template ».

## Pourquoi ce choix

- Convex Auth est **solide pour le besoin réel V1/V2** (password, OAuth, sessions, anonymous). Sa limite face à WorkOS = le **B2B entreprise** (SAML/SCIM), pas la robustesse de base.
- Le « 1M utilisateurs » = des customers **anonymes** : WorkOS n'y apporte rien. Le vrai cas WorkOS = une poignée de comptes pros enterprise, déclenché par un **signal commercial** (chaîne/franchise qui impose le SSO), pas par le scale.
- Les données d'identité vivent **dans Convex** (notre base) → lock-in **faible côté données**.
- L'encapsulation (`getCurrentActor`) ramène le coût d'une future migration à **un fichier** au lieu de tout le métier.

## Conséquences

- La foundation **doit** livrer `getCurrentActor` comme unique point d'accès à Convex Auth, consommé par tous les wrappers.
- Le code template (`requireAdmin`, appels `getAuthUserId` dispersés dans `users.ts`/`admin.ts`) sera refactoré pour passer par ce point unique (chantier 1.x).
- Migration WorkOS future = réécrire `getCurrentActor` + importer les users + brancher le flow login ; garder `users` Convex comme miroir/profil lié par `workosUserId`. Le métier ne bouge pas.
- Pas de SSO SAML / SCIM en V1/V2 (assumé — clientèle indépendante).

## Hard to reverse pourquoi

Le choix d'IdP touche le flow de login, le format de session et la résolution d'identité de **chaque** requête. Sans encapsulation, en changer = réécrire partout. **C'est précisément pour ça qu'on encapsule** : la décision reste réversible tant que `getCurrentActor` est le seul point de contact. Entrer ou sortir d'un IdP hosted coûte toujours ~1 sprint (flow + mapping users) — jamais un piège, mais jamais gratuit.
