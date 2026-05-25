# Brief — Comment notifier le resto des cmds Uber Direct (KitchenBoost)

**Date** : 2026-05-22
**Statut** : Brief comparatif exhaustif, recommandation à valider par Alex
**Contexte** : Uber Eats Orders n'affiche **pas** les cmds Uber Direct (architectural, cf. [`docs/research/uber_direct_deep_dive.md`](uber_direct_deep_dive.md) §3.7). Donc il faut une voie de notification alternative pour que le resto voie les cmds en cuisine.

---

## 1. Le problème en 30s

```
Client paie sur PWA KB
   ↓
Backend KB crée la livraison via Uber Direct API
   ↓
[ ICI : le resto doit voir le ticket cuisine pour préparer ]
   ↓
Coursier Uber arrive, récupère, livre
```

**Le maillon « ICI »** n'est pas couvert par Uber : Uber Direct API n'a pas les détails de la cmd cuisine, donc Uber Eats Orders ne peut pas l'afficher. Il faut une solution propre à KB.

### Contraintes business non négociables
- **Pas de friction hardware** : utiliser au max le matos existant chez le resto
- **0€ ou très bas en coût récurrent** : on facture 2€/cmd, on ne peut pas payer 100€/mois de middleware
- **Compatible tablette Uber Premium en mode kiosque** : qui ne permet d'installer aucune app tierce
- **Setup install < 30 min** : on a 15 restos prêts à installer, on ne peut pas perdre 4h par resto
- **UX cuisine simple** : le cuisinier ne change PAS son geste habituel (regarder l'imprimante / regarder la tablette)

### Critères d'évaluation pour chaque solution
1. **Coût récurrent KB** (€/mois/store)
2. **Coût hardware resto** (one-time)
3. **Friction install** (1 = 5 min, 5 = 1 journée)
4. **UX cuisine** (1 = pourri, 5 = invisible-zéro-changement)
5. **Scalabilité** (capacité à passer de 1 à 100 restos sans refonte)
6. **Risque opérationnel** (panne, latence, dépendance tiers)

---

## 2. Les 10 voies possibles, par catégorie

### Catégorie A — Sur hardware déjà présent chez le resto

#### A.1 Imprimante thermique cloud (Star CloudPRNT / Epson Connect API)

**Comment ça marche** : l'imprimante existante du resto (Star TSP143IIIW, mC-Print3, Epson TM-m30III…) pull périodiquement les nouveaux tickets depuis un endpoint cloud KB. Le ticket sort comme un ticket Uber Eats classique.

```
Backend KB ──POST ticket JSON──→ cloud-server KB
                                       │
                                       ↓ pull HTTPS toutes les 3s
                          ┌────────────────────────┐
                          │ Imprimante Star/Epson  │ → impression auto
                          │ (réseau resto, WiFi)   │
                          └────────────────────────┘
```

**Compatibilité Uber Eats Premium** : l'imprimante fournie avec la tablette Uber Premium en France est généralement la **Star TSP143IIIBI** (Bluetooth, doc Uber confirmée). Bluetooth = pas CloudPRNT natif. Mais :
- **TSP143IIIW** (variante WiFi/Ethernet) est CloudPRNT-ready. ~150-200€
- **mC-Print3** (haut de gamme, gros volume) : 100% CloudPRNT. ~250-300€
- Si resto a une imprimante BT only : 2 options (a) remplacer par WiFi (b) ajouter un petit device proxy local (Raspberry Pi à ~50€ qui fait pont BT ↔ HTTP)

**Coût KB** : 0€/mois. Dev une-fois côté backend pour l'API CloudPRNT (~2 jours dev)
**Coût resto** : 0€ si imprimante WiFi cloud-ready déjà là. Sinon 150-200€ one-time.
**UX cuisine** : ★★★★★ (5/5) — invisible, juste un ticket de plus
**Friction install** : ★★ — 15 min pour configurer l'URL CloudPRNT côté imprimante
**Scalabilité** : excellente, KB host le service côté backend
**Risques** : si imprimante BT only, complexité supplémentaire ; latence pull (~3s)

#### A.2 PWA KB ouverte dans Chrome sur la tablette du resto (BYOD)

**Comment ça marche** : si le resto a sa propre tablette (iPad, Samsung Galaxy Tab) — pas la tablette Uber kiosque — on installe la PWA KB en raccourci sur l'écran d'accueil. Web Push + son distinctif = notification.

**Coût KB** : 0€/mois (PWA déjà construite). Web Push self-host (cf. doc `web_push_pwa.md`)
**Coût resto** : 0€ si tablette existe, ~100€ Samsung Tab A9 sinon
**UX cuisine** : ★★★★ — 2 apps à surveiller (Uber Eats Orders + PWA KB) mais sur le même device
**Friction install** : ★ — 5 min (ouvrir Safari/Chrome, "Ajouter à l'écran d'accueil")
**Scalabilité** : excellente
**Risques** : ne fonctionne pas si resto a UNIQUEMENT la tablette Uber kiosque

#### A.3 PWA KB sur smartphone perso du resto

**Comment ça marche** : raccourci PWA sur le téléphone du gérant/cuisinier. Web Push même hors-app, son notif.

**Coût KB** : 0€/mois
**Coût resto** : 0€
**UX cuisine** : ★★ — pas idéal pour la cuisine (téléphone perso en poche, vibre, oublié). Acceptable comme **backup** / canal secondaire pour gérer les exceptions
**Friction install** : ★ — 2 min
**Scalabilité** : OK
**Risques** : téléphone perso en silence, en charge, oublié = cmds ratées

#### A.4 SMS / WhatsApp Business API

**Comment ça marche** : chaque cmd Uber Direct → envoi d'un SMS (ou message WhatsApp) au gérant avec le détail.

**Coût KB** : SMS via Twilio ~0,07€/SMS, WhatsApp Business ~0,06€/conversation. Sur 5K cmds/mois sur 10 restos = 350€/mois KB
**Coût resto** : 0€
**UX cuisine** : ★ — message non bloquant, lu en retard, pas de son d'alerte continu
**Friction install** : ★ — opt-in resto en 1 min
**Scalabilité** : moyenne (coût grandit linéairement)
**Risques** : oublis, vu trop tard, friction pour préparer (faut taper)

---

### Catégorie B — Hardware nouveau fourni par KB

#### B.1 Tablette Android cheap (Samsung Tab A9 ~100€) en mode kiosque PWA KB

**Comment ça marche** : KB fournit (ou fait acheter au resto) une tablette Android de base. App Android Kiosk Mode (FreeKiosk, Fully Kiosk Browser ~5€/mois optionnel) lockée sur la PWA KB plein écran. Tablette dédiée 100% à KB, posée à côté de la tablette Uber.

**Coût KB** : 0€/mois (PWA gratuite) ou ~5€/mois (Fully Kiosk licence)
**Coût resto** : ~100€ tablette one-time + ~10€ support mural
**UX cuisine** : ★★★★ — tablette dédiée KB, jamais polluée par autre chose
**Friction install** : ★★ — flasher la tablette, config kiosque, ~30 min
**Scalabilité** : OK mais setup manuel par tablette
**Risques** : 2 devices sur le comptoir (encombrant), tablette à charger / panne / vol

#### B.2 KDS dédié (écran cuisine Fresh KDS / Square KDS / Toast KDS)

**Comment ça marche** : écran cuisine spécialisé branché en HDMI, app KDS qui affiche tous les flux (KB + Uber Eats si intégration).

**Coût KB** : 0€ (mais 50-150€/mois de KDS subscription à payer si Square/Toast)
**Coût resto** : ~300-500€ écran + box
**UX cuisine** : ★★★★★ — écran cuisine dédié pro
**Friction install** : ★★★★ — install hardware + config
**Scalabilité** : compliqué
**Risques** : sur-engineering pour MVP. Sens à 50+ cmds/jour seulement

#### B.3 Imprimante thermique cloud livrée par KB (Star TSP143IIIW)

**Comment ça marche** : KB livre une Star CloudPRNT à chaque resto qui n'en a pas. Wifi du resto. Plug & play. Pas de tablette ni interface — juste l'impression.

**Coût KB** : 0€/mois. KB peut soit (a) refacturer 180€ au resto, (b) inclure dans le setup fee, (c) prêter (capex KB amorti sur le contrat)
**Coût resto** : 0€ si KB inclut, sinon 180€
**UX cuisine** : ★★★★★ — ticket comme tout autre
**Friction install** : ★★ — 15 min config WiFi
**Scalabilité** : excellente, hardware standardisé
**Risques** : invest capex si KB prête (180€ × 10 restos = 1800€ avancés)

---

### Catégorie C — Middleware tiers payant (aggregators)

#### C.1 Deliverect Dispatch + Uber Direct

**Comment ça marche** : KB push les cmds chez Deliverect, qui les pousse au resto via son app/imprimante + push vers Uber Direct pour la livraison. Partenariat officiel Uber Direct annoncé en 2023.

**Coût KB** : 0€ (c'est le resto qui paye)
**Coût resto** : ~99-149€/mois/store (US benchmark)
**UX cuisine** : ★★★★★ — UI unifiée Deliverect, impression, KDS, app, tout intégré
**Friction install** : ★★★ — onboarding Deliverect 1-2h
**Scalabilité** : excellente (Deliverect gère)
**Risques** : **dépendance complète à Deliverect**, perte de marge resto (le 100€/mois mange ~50 cmds à 2€), résiliation contrôlée par Deliverect

#### C.2 HubRise (équivalent FR plus accessible)

**Comment ça marche** : aggregator français. Connecte la PWA KB à l'imprimante / au POS du resto via la "Bridge" HubRise. Moins de features que Deliverect mais moins cher.

**Coût KB** : 0€ (refacturé au resto)
**Coût resto** : 30€/mois/location + 25€ setup one-time
**UX cuisine** : ★★★★ — passage par imprimante existante, pas d'UI dédiée
**Friction install** : ★★★ — config HubRise + POS, 30-60 min
**Scalabilité** : très bonne
**Risques** : dépendance HubRise (mais moindre car prix faible)

#### C.3 Otter (US) / Cuboh / Chowly / Checkmate / Ordermark

Pricing similaire Deliverect (100-400€/mois), surtout pour les marchés US/UK. Peu de présence FR. **Hors scope** pour KB en MVP.

---

### Catégorie D — Intégration POS direct (si le resto en a un)

#### D.1 Push cmd KB → POS resto (Lightspeed, Zelty, L'Addition, Tiller, Popina, Innovorder)

**Comment ça marche** : si le resto a un POS moderne avec API, KB push la cmd directement → le POS l'imprime sur son imprimante POS + l'affiche sur sa caisse comme une cmd in-store classique.

**Coût KB** : 0€/mois + 2-5 jours dev par POS (10+ POS différents en FR) → **gros effort intégration**
**Coût resto** : 0€ (il a déjà son POS)
**UX cuisine** : ★★★★★ — cmd dans le POS = setup natif resto
**Friction install** : ★★ — config API + token
**Scalabilité** : faible. Chaque POS = une intégration distincte. Ne pas commencer par là
**Risques** : la plupart de nos restos cibles (kebab, snack, fast food) n'ont **pas de POS sophistiqué**, ils ont juste une caisse simple sans API

#### D.2 Via aggregator middleware (Fooderise, HubRise)

Plus pragmatique : passer par un aggregator qui parle à tous les POS FR. Voir C.2 (HubRise).

---

## 3. Tableau récap

| # | Solution | Coût mensuel KB | Coût resto | UX cuisine | Install | Scalable | Verdict MVP |
|---|---|---|---|---|---|---|---|
| **A.1** | Imprimante CloudPRNT existante | 0€ | 0-180€ | ★★★★★ | ★★ | ✅ | **🏆 GO** |
| **A.2** | PWA sur tablette resto (BYOD) | 0€ | 0-100€ | ★★★★ | ★ | ✅ | ✅ Fallback si pas d'imprimante |
| **A.3** | PWA sur smartphone perso | 0€ | 0€ | ★★ | ★ | ✅ | ✅ Backup pour exceptions |
| **A.4** | SMS / WhatsApp | ~30€/store | 0€ | ★ | ★ | Moyen | ❌ Trop dégradé |
| **B.1** | Tablette KB kiosque (Tab A9) | 0-5€ | 100€ | ★★★★ | ★★ | ✅ | ⚠️ Backup si imprimante incompatible |
| **B.2** | KDS dédié | 0-150€ | 300-500€ | ★★★★★ | ★★★★ | Moyen | ❌ Sur-engineered pour MVP |
| **B.3** | Imprimante CloudPRNT fournie KB | 0€ | 0-180€ | ★★★★★ | ★★ | ✅ | ✅ Variante A.1 si pas d'imprimante |
| **C.1** | Deliverect Dispatch | 0€ | 100-150€/mois | ★★★★★ | ★★★ | ✅ | ❌ Tue la marge resto |
| **C.2** | HubRise | 0€ | 30€/mois + 25€ | ★★★★ | ★★★ | ✅ | ⚠️ Phase 2 si scaling |
| **D.1** | Intégration POS directe | 0€ + dev | 0€ | ★★★★★ | ★★ | ❌ | ❌ Restos cibles n'ont pas POS |

---

## 4. Recommandation MVP — l'approche en 3 niveaux

### Niveau 1 — Par défaut (80% des restos)

**Imprimante CloudPRNT (A.1)** sur l'imprimante existante du resto.

Lors du Gate B → B+, on demande le **modèle d'imprimante**. Si :
- **Star TSP143IIIW / mC-Print3 / autre WiFi CloudPRNT** → intégration directe, **0€ pour le resto, 0€ pour KB**
- **Star TSP143IIIBI (Bluetooth, livrée par Uber)** → on propose 2 chemins :
  - Acheter la version WiFi (TSP143IIIW ~150€), un investissement amorti < 1 semaine
  - Ou rester sur la tablette Uber pour Uber Eats + ajouter PWA KB sur smartphone perso pour gérer les cmds Direct (Niveau 3 plus bas)
- **Epson TM-m30III / TM-T88VII** → Epson Connect API, même logique CloudPRNT
- **Pas d'imprimante du tout** → KB propose Star TSP143IIIW à 150€ (Niveau 2)

### Niveau 2 — Pas d'imprimante compatible

**Imprimante CloudPRNT fournie par KB (B.3)** : Star TSP143IIIW à ~150€ inclus dans le setup fee resto (ou avancée par KB et amortie sur 6 mois de contrat).

### Niveau 3 — Backup pour les actions ponctuelles

**PWA KB sur smartphone perso du gérant (A.3)** activée pour TOUS les restos, en plus de l'imprimante. Sert :
- À voir l'historique des cmds Direct
- À refuser exceptionnellement une cmd (rupture stock, fermeture imprévue)
- À éditer le menu, mettre en pause, voir les stats

Pas besoin de tablette dédiée. Le smartphone perso suffit pour ces 20% d'actions.

### Niveau 4 — Phase 2 (10+ restos signés)

**Évaluer HubRise (C.2)** ou Deliverect pour les restos qui ont un POS sophistiqué et veulent une intégration plus poussée. Argument upsell premium.

---

## 5. Architecture technique recommandée (MVP)

```
                          ┌─────────────────────────┐
                          │   Client commande PWA   │
                          └────────────┬────────────┘
                                       │
                                       ↓
                          ┌─────────────────────────┐
                          │   Backend KitchenBoost  │
                          │                         │
                          │  1. Stripe Connect      │
                          │  2. Uber Direct API     │
                          │  3. Print queue Cloud   │
                          │  4. Web Push            │
                          └──────┬─────────┬────────┘
                                 │         │
                  ┌──────────────┘         └──────────────┐
                  ↓                                       ↓
       ┌──────────────────────┐                ┌──────────────────────┐
       │  Imprimante WiFi     │                │  PWA smartphone      │
       │  (Star CloudPRNT)    │                │  (raccourci écran)   │
       │                      │                │                      │
       │  → Ticket imprimé    │                │  → Push notif        │
       │    en cuisine        │                │  → Actions (refus,   │
       │                      │                │     pause, edit)     │
       └──────────────────────┘                └──────────────────────┘
       Canal primaire (100%)                   Canal secondaire (~20%)
```

---

## 6. Effort de développement KB

| Composant | Effort dev | Priorité |
|---|---|---|
| Endpoint CloudPRNT (Star) — server-side print queue + JSON format ticket | 2 j | P0 |
| Adaptateur Epson Connect (idem pour Epson) | 1,5 j | P1 (Eline ou Walid peut avoir Epson) |
| PWA + Web Push iOS/Android | déjà fait | — |
| Auto-accept logic Uber Direct | 0,5 j | P0 |
| UI PWA gestion exceptions (refus, pause, statut) | 2 j | P0 |
| Diagnostic imprimante / monitoring | 1 j | P1 |
| **Total MVP** | **~7 jours** | — |

Tient dans les **14 jours** du plan d'action [`docs/plans/uber_direct_action_plan.md`](../plans/uber_direct_action_plan.md).

---

## 7. Risques & mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Imprimante BT only (Uber-fournie) chez 50%+ des restos | Friction d'install | Diagnostic obligatoire en Gate B → B+ + option "remplacement vers WiFi" claire |
| Imprimante deconnectée du Wifi (panne réseau) | Cmds perdues en cuisine | Push notif PWA en parallèle systématique + alert KB monitoring si pas de ack imprimante en 30s |
| Resto pas habitué aux tickets KB (différents tickets Uber Eats) | Confusion | Format de ticket très lisible, header "KITCHEN BOOST" en gros, item count clair |
| Latence pull CloudPRNT 3s | Délai mineur cuisine | Acceptable (< rythme habituel cuisine) |
| Imprimante éteinte le soir / weekend | Cmds non vues | Auto-reject Uber Direct si pas de ack 11min (timeout marketplace standard) |

---

## 8. Argument commercial à intégrer au pitch

> *« On vous installe une imprimante connectée à internet. À chaque commande de votre site direct, un ticket sort exactement comme pour Uber Eats. Vous ne changez rien à votre workflow. Et vous gardez 13€ au lieu de 7€ par commande. »*

C'est un argument **concret, visible, rassurant** pour le restaurateur. Pas de tablette en plus, pas de système complexe — l'imprimante qui imprime, comme d'habitude.

---

## 9. Décisions à prendre par Alex

1. **Valider l'approche A.1 / B.3 (imprimante CloudPRNT) comme voie MVP** ?
2. **Modèle KB sur l'imprimante** : KB la prête (capex KB ~150€/resto, 1500€ pour 10 restos) ou KB la fait acheter par le resto (zéro capex KB mais friction +) ?
3. **Premier resto pilote** : identifier le modèle exact d'imprimante chez Eline (japonais-falguiere) et Walid (thai-street-saint-michel) pour confirmer faisabilité directe
4. **Q à poser à l'AM Uber FR** : peut-on commander la **TSP143IIIW** (variante WiFi) avec une tablette Uber Premium, plutôt que la BT par défaut ?
5. **Pendant le call install** : monter le démontage du flow imprimante → backend KB → Uber Direct pour montrer le caractère "transparent" au resto

---

## Sources

- [Star CloudPRNT — Star EMEA](https://star-emea.com/products/cloudprnt/) — confirm direct HTTP POST sans middleware
- [Star Micronics — Online Order Printing Solutions](https://starmicronics.com/online-order-printing-solutions-labels-receipts-food-delivery-apps/)
- [Star TSP143IIIBI Uber Eats Premium printer](https://www.barcodebonanza.com/products/ubereats-star-tsp143iii-receipt-printer.jsp) — confirme modèle fourni par Uber Premium FR
- [Uber troubleshoot printer (help.uber.com)](https://help.uber.com/merchants-and-restaurants/article/how-to-troubleshoot-your-printer)
- [Deliverect Uber Direct integration](https://www.deliverect.com/en/integrations/uber-direct) — partenariat officiel, FR disponible
- [Deliverect Press release partnership Uber Direct](https://www.deliverect.com/en/press/deliverect-partners-with-uber-direct)
- [HubRise pricing FR](https://www.hubrise.com/pricing)
- [HubRise Uber Eats Bridge](https://www.hubrise.com/apps/uber-eats)
- [Logiciels de caisse FR 2026](https://www.logiciels-caisse.fr/restaurant/) — Lightspeed, L'Addition, Zelty, Tiller, Popina
- [Otter / Cuboh / Ordermark comparison](https://slashdot.org/software/comparison/Cuboh-vs-Ordermark-vs-Otter/) — pricing $150-400/mois US benchmark
