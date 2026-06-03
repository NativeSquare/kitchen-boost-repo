---
status: accepted
date: 2026-06-03
context: KB Orders (PRD 20), app/_layout.tsx
---

# 0017 — Force update : pattern Expo officielle à deux couches (criticalIndex OTA + minSupportedBuildVersion natif)

## Décision

L'app native KB Orders implémente un mécanisme de **force update** dès V1 en suivant **scrupuleusement** la pattern Expo officielle documentée dans [docs.expo.dev/eas-update/download-updates](https://docs.expo.dev/eas-update/download-updates/) et exemplifiée par le repo de référence [`expo/UpdatesAPIDemo`](https://github.com/expo/UpdatesAPIDemo). Deux couches indépendantes, **avant le rendu de l'app** (au root `app/_layout.tsx`) :

1. **Couche OTA (JS-only)** — compteur `expo.extra.criticalIndex` dans la config app : au boot, `Updates.checkForUpdateAsync()` compare l'index incoming au running ; si incoming > running, `fetchUpdateAsync()` + `reloadAsync()` bloque sur splash. Permet de pousser un patch JS critique en quelques minutes sans passer par App/Play Store.
2. **Couche native (binaire)** — `Application.nativeBuildVersion` (via `expo-application`) comparé à un `minSupportedBuildVersion` servi par Convex ; si inférieur, écran bloquant "Mise à jour requise" avec lien App Store / Play Store. Permet de bloquer toutes les anciennes builds en cas de faille sécurité native.

Pré-requis : `runtimeVersion: "fingerprint"` (Expo SDK 52+) pour que EAS Update exclue correctement les bundles incompatibles avec le binaire installé.

## Pourquoi cette pattern et pas un mécanisme maison

Alex a explicitement rejeté toute solution maison ("Je veux pas que ce soit géré par un truc maison, expo doit avoir un mécanisme dédié"). Expo lui-même reconnaît dans ses docs qu'il n'y a _"no first-class support for critical/mandatory updates in the expo-updates library"_ (pas un flag magique côté EAS dashboard) — **mais** documente la pattern via `UpdatesAPIDemo` comme l'**implémentation de référence**. Donc :

- Le code écrit n'est pas du "homegrown" — c'est l'API Expo, organisée comme Expo l'organise. Le repo `UpdatesAPIDemo` est versionné par Expo et maintenu en cohérence avec les SDK successifs.
- Pas de dépendance à une lib tierce (community packages dépréciés) ni à une feature EAS payante qui n'existe pas.
- La maintenance long-terme s'accroche aux releases Expo, pas à un wrapper interne.

## Pourquoi V1 et pas reporter V2

Le kill switch est un **mécanisme de réponse incident sécurité**. Sans lui, si une faille (ex : fuite cross-tenant détectée) est découverte en 2027, on est démunis face aux Khan qui ne mettent pas à jour spontanément. Coût d'implémentation V1 ~0.5 jour (pattern Expo = copier-coller adapté). Valeur sécurité énorme. ROI évident.

## Conséquences

- `app.config.ts` / `app.json` : champ `expo.extra.criticalIndex` (entier, bumpé manuellement avant chaque release critique OTA)
- `app/_layout.tsx` : gate au boot, bloque le render des routes enfants jusqu'à résolution
- `convex/app.ts` (ou équivalent) : query `minBuildVersion()` accessible publique (non tenant-scoped — il faut pouvoir checker avant login)
- `runtimeVersion: "fingerprint"` activé dans Expo config
- Pas de kill switch côté EAS dashboard — les seules manettes serveur sont `criticalIndex` (republish OTA) et `minSupportedBuildVersion` (mutation Convex)
- iOS App Store contrainte respectée : l'écran "Mise à jour requise" apparaît au launch, pas mid-session
- `Updates.manifest` est `undefined` en dev — guard `__DEV__` obligatoire dans le gate
