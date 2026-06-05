# apps/native — Dev cycle

## Cycle quotidien (émulateur Android)

```powershell
# 1. Lancer l'émulateur Lenovo Tab M8 (Uber Eats) sans ouvrir Android Studio
& "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd Lenovo_Tab_M8_Uber_Eats

# 2. Dans apps/native, démarrer Metro
npx expo start

# 3. Dans le terminal Metro, presser `a` → l'app dev build s'ouvre sur l'émulateur
#    (auto-connect via http://10.0.2.2:8081)

# 4. Code TS/JSX → save → Metro reload auto (Fast Refresh)
```

Raccourcis Metro utiles : `r` reload, `j` ouvrir debugger, `m` toggle menu dev sur l'app, `shift+m` plus de tools.

## Cycle on-device (vraie tablette / smartphone)

```powershell
# Même flow, mais à l'étape 3 → scanner le QR avec le dev build installé sur le device
npx expo start
```

Le device et la machine de dev doivent être sur le même réseau Wi-Fi. Si ça ne se connecte pas, utiliser `npx expo start --tunnel` (plus lent mais marche cross-network).

## Quand rebuild le natif (= refaire un EAS Build)

Le dev build ne hot-reload **que** le JS/TS. Tu dois rebuild + réinstaller l'APK à chaque fois que tu :

- Ajoutes/upgrades un package avec du **code natif** (ex: `expo-camera`, lib RN tierce)
- Modifies un **config plugin** dans `app.config.ts` (ajout de plugin Expo, permission iOS/Android)
- Bumpes la **version Expo SDK**
- Changes `runtimeVersion`, `scheme`, ou les bundle IDs

```powershell
# Build cloud → produit un APK installable (developmentClient + distribution: internal)
eas build --platform android --profile development

# À la fin, le CLI demande "Install on Android Emulator? (Y/n)" → Y
# Ou rétroactif sur un build existant :
eas build:run -p android --latest
# Ou install par ID précis :
eas build:run -p android --id <build-id>
```

Builds visibles sur https://expo.dev/accounts/nativesquare-expo/projects/kitchen-boost/builds

## Profil AVD

**Lenovo Tab M8 (Uber Eats)** — 8" 1280x800, 160 dpi mdpi, 3 GB RAM, Android 15 (API 35) Google APIs Tablet x86_64. Mime la tablette cheap Uber Eats pour ne pas se mentir sur les perfs.

Créé via Android Studio → Device Manager → New hardware profile. Hardware accel = WHPX (HAXM mort, AEHD sunset déc 2026).

## Troubleshooting

| Symptôme                                                          | Fix                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `adb devices` vide alors que l'émulateur tourne                   | Attendre fin du boot, ou `adb kill-server; adb start-server`                                           |
| "Could not connect to dev server" dans le dev client              | Ouvrir manuellement `http://10.0.2.2:8081` dans le dev client                                          |
| Build EAS sort un AAB au lieu d'APK                               | Vérifier que le profil utilisé a `developmentClient: true` ou `distribution: internal` dans `eas.json` |
| App s'installe mais bundle ID anti-attendu (`com.testmonorepo.*`) | Build pré-renaming `kitchen-boost`, refaire `eas build --platform android --profile development`       |
| Émulateur lent au boot                                            | Première fois = cold boot (1-3 min), ensuite snapshot (~15s)                                           |
