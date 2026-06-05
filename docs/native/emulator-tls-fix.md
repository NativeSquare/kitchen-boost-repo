# Android emulator — fix « Chain validation failed » sur la WebSocket Convex

## Symptôme

Au lancement de `pnpm dev` côté `apps/native` contre un émulateur Android (ex.
`Lenovo_Tab_M8_Uber_Eats`), Metro logge en boucle :

```
WebSocket closed with code 1006: Chain validation failed
Attempting reconnect in 1209ms
```

Conséquence : le `ConvexReactClient` ne se connecte jamais, `signIn("password", …)`
reste pending → tap sur « Continue » dans `sign-in` ne fait rien visible.

## Cause racine

**L'horloge de l'émulateur Android est désynchronisée du host** (souvent de
plusieurs heures, parfois plusieurs jours après un sleep/resume du laptop).

La chaîne TLS de Convex (Cloudflare → Let's Encrypt) est rejetée car, du point de
vue de l'émulateur, le certificat est `NotBefore` dans le futur (ou `NotAfter`
dans le passé). Android ferme alors la WebSocket avec « Chain validation failed ».

Le navigateur du host fonctionne car son horloge est correcte — c'est bien un
souci d'environnement Android, pas un souci de cert Convex ni de code RN.

## Fix (à refaire à chaque fois que ça revient)

Depuis le repo, avec l'émulateur lancé :

```bash
# Sous Git Bash sur Windows, l'adb est ici :
ADB=/c/Users/alexp/AppData/Local/Android/Sdk/platform-tools/adb.exe

# 1) Vérifier le décalage
"$ADB" shell date          # heure émulateur
date                       # heure host

# 2) Passer adbd en root (autorisé sur les system images "Google APIs", pas "Google Play")
"$ADB" root

# 3) Pousser l'heure UTC du host dans l'émulateur (format mmDDHHMMyyyy.ss)
"$ADB" shell "su 0 date $(date -u +%m%d%H%M%Y.%S)"

# 4) Fixer la TZ Europe/Paris pour que l'UI affiche l'heure locale
"$ADB" shell "setprop persist.sys.timezone Europe/Paris"

# 5) Vérifier
"$ADB" shell date          # doit matcher host à la seconde près
```

Pas besoin de redémarrer Metro ni de reinstaller le dev build. La prochaine
tentative de reconnexion Convex (≤ qq secondes) passe.

## Pourquoi pas un fix code

- Désactiver la validation TLS = trou de sécu, on refuse (cf. mémoire
  `no-shortcut-fixes`).
- Ajouter un `network_security_config.xml` qui trust un cert custom = inutile, le
  cert Convex est légitime. C'est l'horloge qui ment.
- Forcer Android à resynchroniser via NTP au boot = pas accessible en JS / Expo
  managed, c'est une responsabilité de l'image système / de l'AVD.

## Fix permanent (optionnel)

Dans AVD Manager :

1. Sélectionner l'AVD (Lenovo_Tab_M8_Uber_Eats) → « Edit ».
2. « Show Advanced Settings » → « Boot option » → « Cold boot » (au lieu de
   « Quick boot »).
3. Ou activer « Synchronize host system clock » si l'option apparaît selon la
   version d'Android Studio.

Cold boot regénère un kernel propre à chaque démarrage et reprend l'heure host.
Coût : +5-10 s au lancement de l'émulateur.

## À garder en tête

- Tout `pnpm dev` qui logge « Chain validation failed » → réflexe `adb shell date`
  AVANT de soupçonner Convex / RN / le réseau.
- Le souci touche aussi les system images Android 15 (API 35) — testé le
  2026-06-05, émulateur à 15h de retard sur host.
