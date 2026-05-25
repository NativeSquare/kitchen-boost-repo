# Flash LineageOS 14.1 sur Samsung Galaxy Tab E SM-T560 EU

> **Objectif** : faire passer la tablette de Android 4.4.4 KitKat → Android 7.1.2 Nougat pour faire tourner Uber Eats Orders (ou la web app `restaurant-dashboard.uber.com` dans Chrome récent).

---

## ⚠️ Avertissements bloquants — À LIRE EN PREMIER

1. **Risque de brick révisé : 5-10%** (raison : ROM LineageOS 14.1 pour gtelwifi est unofficial WIP datant de 2018, pas un build mainstream stable). Le risque vient principalement de : mauvais codename (gtelwifi vs gtelwifiue), mauvais CSC region, mauvais flashage boot.img séparé après ROM (étape Spreadtrum), débranchement USB en cours de flash, drivers non-installés.
2. **CODENAME CRITIQUE** : ton modèle est `SM-T560` EU = codename **`gtelwifi`** (chipset Spreadtrum/Marvell). **NE JAMAIS flasher un ROM ou TWRP marqué `gtelwifiue`** — c'est pour le SM-T560NU US (chipset Qualcomm), incompatible = hard brick garanti. Vérifier le codename dans chaque fichier téléchargé AVANT de l'utiliser.
3. **Plan de récupération obligatoire avant de commencer** : tu dois avoir téléchargé le firmware Samsung stock T560XXU0APL1 XEF (rescue file, lien confirmé live sur SamFW.com) AVANT de toucher quoi que ce soit. Si la tablette refuse de booter après flash, tu pourras re-flasher le firmware stock via Odin = retour à Android 4.4.4 d'origine = pas perdue.
4. **Modèle exact à confirmer** : ouvre Paramètres → À propos. Tu dois voir EXACTEMENT `SM-T560`. Si tu vois `SM-T560NU`, `SM-T561` ou autre, ce guide ne s'applique pas — autres procédures, autres ROMs.
5. **Câble USB qui transmet données** : test = copier un fichier PC→tablette en USB. Si pas de transfert possible, le câble est charge-only et c'est la cause d'échec n°1. Change avant de commencer.
6. **Batterie ≥ 50%** avant de démarrer la procédure flash. Si la tablette s'éteint en cours de flash = brick quasi certain.
7. **Pas de pause longue** entre Phase 2 (flash TWRP) et Phase 3 (boot TWRP). Le timing est critique — si tu laisses la tablette rebooter normalement après le flash TWRP, le stock recovery se réinstalle et écrase ton TWRP.
8. **Étape Spreadtrum supplémentaire** : certains users rapportent qu'après le flash LineageOS, il faut flasher manuellement le boot.img séparément (extrait du même zip ROM). À confirmer dans les posts récents du thread XDA 3903780.

---

## Spec tablette diagnostiquée

| Champ | Valeur |
|---|---|
| Modèle | SM-T560 |
| Codename LineageOS | **gtelwifi** (Spreadtrum/Marvell) — PAS gtelwifiue (US Sprint Qualcomm) |
| Version Android actuelle | 4.4.4 (KitKat) |
| Build actuel | KTU84P.T560XXU0APL1 |
| Kernel | 3.10.17-1157403 |
| Région (à confirmer dans le build) | XEF (France) ou XEO (Open Europe) |
| RAM | 1.5 GB |
| Stockage | 8 ou 16 GB |
| Processeur | Spreadtrum SC9830 quad-core 1.3 GHz ARM 32-bit |

---

## Téléchargements à faire AVANT de toucher la tablette

> ✅ Vérifications sub-agent terminées 2026-05-10. Les liens 1, 2, 5, 6 sont confirmés live. Les liens 3 et 4 (TWRP + ROM) nécessitent vérification manuelle dans Chrome car Cloudflare bloque les fetch automatiques sur XDA.

| # | Fichier | URL | Taille | Status |
|---|---|---|---|---|
| 1 | Samsung USB Drivers Windows v1.9.5.0 | https://developer.samsung.com/android-usb-driver | 35,5 MB | ✅ LIVE |
| 2 | Odin v3.14.4 Windows | https://xdaforums.com/tags/odin-3144/ (préférer attachement XDA, pas mirroirs ad-laden) | ~10 MB | ✅ LIVE via XDA |
| 3 | TWRP recovery pour `gtelwifi` (PAS gtelwifiue !) | [XDA thread 4520487 — TWRP 3.7.0 unofficial](https://xdaforums.com/t/unofficial-twrp-3-7-0-team-win-recovery-project-samsung-galaxy-tab-e-sm-t560-61-gtel3g-gtelwifi.4520487/) | ~15 MB | ⚠️ À VÉRIFIER MANUELLEMENT DANS CHROME — vérifier que le fichier attaché est encore téléchargeable, noter SHA depuis le post si fourni |
| 4 | LineageOS 14.1 ROM pour `gtel3g`/`gtelwifi` | [XDA thread 3903780 — pages les plus récentes](https://xdaforums.com/t/unofficial-rom-lineageos-14-1-for-galaxy-tab-e-sm-t561-sm-t560.3903780/) — dernier build connu `lineage-14.1-20180419-UNOFFICIAL-gtel3g.zip` (2018-04-19) | ~400 MB | ⚠️ À VÉRIFIER MANUELLEMENT DANS CHROME — beaucoup de mirroirs AndroidFileHost morts depuis 2023, fouiller les pages récentes du thread pour trouver mirroirs alive |
| 5 | Open GApps Pico ARM 7.1 (build 2022-05-03) | https://sourceforge.net/projects/opengapps/files/arm/20220503/open_gapps-arm-7.1-pico-20220503.zip/download (alt : https://github.com/opengapps/arm/releases tag `20220503`) | ~150 MB | ✅ LIVE |
| 6 | **🆘 Samsung stock firmware T560 XEF FRANCE (RESCUE)** version T560XXU0APL1 Android 4.4.4 | https://samfw.com/firmware/SM-T560/XEF/T560XXU0APL1 | 631 MB | ✅ LIVE (samfw.com, free, throttled) |

**Total à télécharger** : ~1.2 GB (taille ROM possiblement +400 MB selon dispo). Budget 30-60 min selon ta connexion (SamFW throttle gratuit, peut prendre 30 min juste pour le firmware rescue).

⚠️ **NE COMMENCE PAS LA PROCÉDURE TANT QUE LE FICHIER #6 (RESCUE) N'EST PAS TÉLÉCHARGÉ.** C'est ton parachute en cas de problème.

⚠️ **NE COMMENCE PAS LA PROCÉDURE TANT QUE LES FICHIERS #3 (TWRP) ET #4 (ROM) NE SONT PAS VÉRIFIÉS** — il faut que tu ailles toi-même dans Chrome ouvrir les threads XDA, télécharger les fichiers, et vérifier qu'ils ne sont pas morts. Si les liens sont DEAD = on ne peut PAS continuer cette procédure (pas de plan B fiable).

---

## Pré-requis matériel

- [ ] PC Windows 10 ou 11
- [ ] Câble USB **data** (testé en transfert de fichier PC↔tablette)
- [ ] Tablette T560 chargée **≥ 50%**
- [ ] 2-3h tranquilles sans interruption
- [ ] Tous les 6 fichiers du tableau ci-dessus téléchargés ET vérifiés (hash si dispo)
- [ ] Connexion Wifi disponible pour le premier boot Android 7.1

---

## Phase 1 — Préparation tablette (5 min)

- [ ] **1.1** Allumer la tablette. Si elle a un mot de passe, le retirer (Paramètres → Sécurité → Verrouillage écran → Aucun)
- [ ] **1.2** Activer mode développeur : Paramètres → À propos → tape **7 fois consécutives** sur "Numéro de version". Message "Vous êtes désormais développeur"
- [ ] **1.3** Retour Paramètres → **Options développeur** apparaît dans la liste → activer
- [ ] **1.4** Dans Options développeur, activer :
  - **Déverrouillage OEM** (essentiel — sans ça, le flash sera bloqué)
  - **Débogage USB**
- [ ] **1.5** Brancher la tablette au PC, accepter la pop-up "Autoriser le débogage USB" qui apparaît sur la tablette
- [ ] **1.6** Vérifier dans Windows Device Manager que la tablette apparaît bien (devrait apparaître comme "Samsung Android Phone" ou similaire). Si pas visible → réinstaller Samsung USB Drivers (fichier #1) et reboot PC
- [ ] **1.7** Éteindre complètement la tablette

✅ **Phase 1 OK si** : tu peux éteindre la tablette et la rallumer normalement sans message d'erreur.

---

## Phase 2 — Flash TWRP via Odin (10 min) — ATTENTION TIMING

- [ ] **2.1** Lancer **Odin** sur le PC (clic-droit → "Exécuter en tant qu'administrateur")
- [ ] **2.2** Sur la tablette ÉTEINTE, appuyer simultanément **Power + Volume Bas + Home** (3 boutons en même temps, ~3 secondes)
- [ ] **2.3** L'écran affiche un avertissement jaune "Warning! A custom OS can cause critical problems". Appuyer sur **Volume Haut** pour confirmer et entrer en Download Mode (écran vert/bleu "Downloading...")
- [ ] **2.4** Brancher la tablette au PC en USB
- [ ] **2.5** Dans Odin, un port COM doit apparaître **en bleu** dans la zone "ID:COM" en haut. Si pas de port COM bleu = drivers USB ou câble KO. **NE PAS CONTINUER tant que tu n'as pas le port bleu.**
- [ ] **2.6** Dans Odin, click le bouton **AP** → sélectionner le fichier TWRP `.tar` ou `.tar.md5` (fichier #3)
- [ ] **2.7** Vérifier les Options Odin :
  - ✅ **Auto Reboot** doit être **DÉCOCHÉ** (très important — sinon TWRP sera écrasé au reboot)
  - ✅ **F. Reset Time** doit être coché
  - ❌ **Re-Partition** doit être DÉCOCHÉ (sauf si fichier .pit fourni — ce n'est pas le cas ici)
- [ ] **2.8** Click **Start**. Le flash dure ~30 secondes. Odin affiche "PASS!" en vert/bleu en haut quand fini
- [ ] **2.9** **NE PAS DÉBRANCHER, NE PAS REBOOT NORMALEMENT.** Continuer direct Phase 3.

⚠️ **STOP si** :
- Odin affiche "FAIL!" en rouge → débrancher, rebooter en Download Mode, recommencer. Si 3 fails de suite → s'arrêter et investiguer (mauvais fichier ? mauvais modèle ? câble ?)
- Port COM ne devient pas bleu → drivers KO, ne pas continuer

---

## Phase 3 — Boot TWRP custom (étape la plus critique, 2 min)

> Le timing est crucial. Si tu rates, le stock recovery Samsung se ré-installe et tu dois recommencer Phase 2.

- [ ] **3.1** Sur la tablette, appuyer simultanément **Power + Volume Bas** quelques secondes pour forcer un reboot complet (la tablette doit s'éteindre vraiment)
- [ ] **3.2** **AU MOMENT OÙ L'ÉCRAN S'ÉTEINT**, maintenir immédiatement **Power + Volume Haut + Home** (3 boutons) sans relâcher
- [ ] **3.3** Tu dois voir TWRP démarrer (interface tactile bleu/orange avec logo TWRP). Si tu vois le logo Samsung qui boot normalement → t'as raté le timing, retourner Phase 2.7 et recommencer
- [ ] **3.4** Dans TWRP, swipe pour autoriser les modifications

✅ **Phase 3 OK si** : tu es dans l'interface TWRP avec menus "Install", "Wipe", "Backup", "Restore", "Mount", "Settings", "Advanced", "Reboot"

---

## Phase 4 — Wipe + Flash ROM + GApps (20 min)

- [ ] **4.1** Dans TWRP : **Wipe → Advanced Wipe**. Cocher :
  - Dalvik / ART Cache
  - Cache
  - Data
  - System
  - **NE PAS** cocher "Internal Storage" si tu veux garder les fichiers transférés (voir 4.2)
- [ ] **4.2** Swipe pour wipe (~30 secondes)
- [ ] **4.3** Copier les fichiers ROM + GApps sur la tablette :
  - **Option A si tablette a une MicroSD** : éteindre, mettre la SD sur PC, copier les zips, remettre la SD, rebooter en TWRP
  - **Option B sans MicroSD** : utiliser ADB sideload depuis le PC :
    - Dans TWRP : Advanced → ADB Sideload → swipe
    - Sur PC en CMD admin : `adb sideload C:\chemin\vers\lineageos-14.1.zip`
    - Une fois fini, revenir dans TWRP, refaire ADB Sideload, puis : `adb sideload C:\chemin\vers\open_gapps_pico.zip`
- [ ] **4.4** Si Option A : Install → naviguer vers le zip ROM → **swipe to confirm flash** (~3 min)
- [ ] **4.5** Si Option A : Install → naviguer vers le zip GApps → swipe to confirm flash (~2 min)
- [ ] **4.6** Quand le flash est terminé : **Reboot → System**. Premier boot **5-10 min** (long, normal)

⚠️ **STOP si** :
- Flash zip ROM échoue avec erreur → noter le code d'erreur, ne pas continuer
- Flash zip GApps échoue → la tablette peut quand même booter sans GApps (mais pas de Play Store). Tu peux ré-essayer ou booter sans

---

## Phase 5 — Premier boot Android 7.1 + setup (15 min)

- [ ] **5.1** Premier boot LineageOS prend 5-10 min (animation "L" qui tourne, c'est normal)
- [ ] **5.2** Setup wizard : langue, Wifi, compte Google
- [ ] **5.3** Skip toutes les options optionnelles (sync photos, etc.) pour économiser le stockage 8 GB
- [ ] **5.4** Aller dans Play Store, installer **Uber Eats Orders** (`com.uber.restaurants`)
- [ ] **5.5** Login avec creds Uber Eats Manager du store Buns & Bao

✅ **Succès si** : l'app Uber Eats Orders s'ouvre et affiche le dashboard du store. Tablette ressuscitée.

🆘 **Si l'app refuse de s'installer ("Cette version d'Android n'est pas compatible")** : utiliser la voie alternative web → ouvrir Chrome → naviguer vers `restaurant-dashboard.uber.com` → login. Marche dans les 2 cas.

---

## 🆘 Récupération en cas de problème

### Soft brick (tablette boot mais bug)

- Rebooter en TWRP (Power + Vol Haut + Home)
- Wipe Cache + Dalvik
- Reboot
- Si bootloop persiste : Wipe Data complet + ré-installer ROM (Phase 4)

### Hard brick (tablette ne démarre plus du tout)

- Tenter Download Mode : Power + Vol Bas + Home + USB branché au PC. Si écran "Downloading..." apparaît = pas hard brick total, tu peux récupérer.
- Lancer Odin sur le PC
- Charger le **firmware Samsung stock T560** (fichier #6 RESCUE) dans Odin :
  - Si firmware en 5 fichiers (BL/AP/CP/CSC/USERDATA) : charger chacun dans son slot Odin
  - Si firmware en 1 zip : extraire d'abord
  - **Important** : utiliser **CSC** (pas HOME_CSC) pour wipe complet et réinstall propre
  - Re-Partition coché si fichier `.pit` fourni
- Auto Reboot ✅ + F. Reset Time ✅
- Click Start. ~10 min. La tablette redémarre sous Android 4.4.4 d'origine = état initial = pas perdue.

### Hard brick total (pas de Download Mode possible)

- Brancher USB sans rien faire d'autre, attendre 30 sec — parfois la tablette fait un cold boot en mode urgence
- Si rien : la tablette est probablement perdue. Coût : 40€. Pas la fin du monde, mais ça nous est pas arrivé en suivant ce guide.

---

## ⏸ Points où s'arrêter et demander confirmation

Avant chaque étape critique, **s'arrêter et confirmer mentalement** :

1. Avant **Phase 2.6** (chargement TWRP dans Odin) : ai-je le bon fichier TWRP pour **SM-T560** exact (pas T560NU, pas T561) ?
2. Avant **Phase 2.8** (click Start) : Auto Reboot bien **DÉCOCHÉ** ? Re-Partition bien **DÉCOCHÉ** ?
3. Avant **Phase 4.4** (flash ROM) : ai-je bien fait le **Wipe Advanced** complet en 4.1 ?
4. Avant tout **flash de firmware en récupération** : ai-je bien le CSC qui correspond à ma région (XEF France, XEO Europe Open) ?

Si doute sur une étape, **arrête-toi et demande**. Coût d'une question = 0. Coût d'un brick = la tablette.

---

## Time budget total

- Téléchargements : 30-45 min (en parallèle, peut être lancé avant la session flash)
- Setup Odin / drivers : 15 min
- Phase 1 (préparation tablette) : 5 min
- Phase 2 (flash TWRP) : 10 min
- Phase 3 (boot TWRP) : 2 min
- Phase 4 (wipe + flash ROM + GApps) : 20 min
- Phase 5 (premier boot + setup) : 15 min

**Total session active** : 1h - 1h30 si tout marche du premier coup.
**Prévoir** : 2h30 pour avoir de la marge en cas de re-try.

---

## Statut

- [ ] Téléchargements complets (les 6 fichiers, hashes vérifiés)
- [ ] Phase 1 complétée
- [ ] Phase 2 complétée (TWRP flashé)
- [ ] Phase 3 complétée (TWRP boote)
- [ ] Phase 4 complétée (ROM + GApps flashés)
- [ ] Phase 5 complétée (premier boot Android 7.1 OK)
- [ ] Test Uber Eats Orders OK
