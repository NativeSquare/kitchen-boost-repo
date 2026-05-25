# NativeEats - Timeline MVP Phase 1

**Objectif Phase 1 :** Valider deux hypotheses fondamentales :
1. On arrive a **acquerir des restaurateurs** (prospection terrain)
2. On arrive a **leur ramener du business** (systeme QR code -> commande directe)

**Philosophie :** Construire une relation progressive avec le restaurateur. Pas de vente high-ticket. On pense ensemble comment lui ramener plus de clients et faire plus de business ensemble.

**Decision point :** Fin de semaine 6. Si les metrics valident le modele, on lance la construction du template app. Sinon, on pivote le process.

---

## Semaine 0 — Preparation (11-18 avril 2026)

### Branding & Identite

- [ ] **Choisir le nom de marque** du produit (exploite par NativeSquare)
  - Pistes de reflexion : le nom doit parler au restaurateur, evoquer l'independance, la commande directe, la proximite
  - Exemples de directions possibles :
    - **ClickEat** (deja utilise dans le Pitch Closer — a valider si c'est dispo / si c'est le nom de Yanis)
    - **DirectResto** — simple, explicite
    - **MonResto.direct** — le restaurateur comprend immediatement
    - **MaCommande** — cote client final
    - **RestoLibre** — l'independance vis-a-vis d'Uber
    - **NativeEats** — coherent avec NativeSquare
  - A verifier : disponibilite nom de domaine + Instagram + marque INPI
- [ ] **Direction artistique minimaliste**
  - Palette de couleurs (2-3 couleurs max)
  - Logo simple (typographique, pas besoin d'illustration complexe)
  - Template de plaquette commerciale a adapter depuis ceux de Yanis
  - Template de carte de visite / QR code brande
  - Temps budget : 2-3h max, pas plus
- [ ] **Adapter les documents commerciaux**
  - Reprendre le Pitch Closer et la Plaquette Anti-Uber avec le nouveau branding
  - Adapter le discours : remplacer les references a FLJC/ClickEat par ta marque
  - Garder les case studies de Yanis (autorisation obtenue)
  - Ajuster le pricing : setup + 2€/client, pas de mensuel artificiel si on utilise nos propres outils

### Call Yanis — Questions a poser

**Operationnel :**
- [ ] Les 299€ de setup Uber Direct, c'est le cout de quel prestataire exactement ?
- [ ] Les 55€/mois Gift Club, c'est quel outil ? Tu as des templates prets ?
- [ ] Les 59€/mois "Uber Direct commission ~10%", c'est quoi exactement ? Abo a un outil ou commission Uber ?
- [ ] Template de contrat restaurateur — a recuperer
- [ ] Les 3 documents requis pour creer un resto virtuel — les avoir
- [ ] Quel est le taux de scan du QR code en pratique ? Sur 100 commandes, combien scannent ?
- [ ] Combien de temps avant les premieres commandes directes ?
- [ ] T'as deja eu un avertissement d'Uber a cause des QR codes dans les sacs ?
- [ ] Quel profil de resto marche le mieux ? Volume minimum de commandes ?
- [ ] Comment tu factures concretement les 2€/client ? Quel outil de tracking ?
- [ ] En moyenne, combien de temps avant qu'un resto voit des resultats concrets ?
- [ ] T'as deja du activer la garantie "on travaille gratuitement" ?

**Business model :**
- [ ] Comment tu amenes la remuneration 2€/client dans la conversation ? (ta question #1)
- [ ] Legalite QR codes dans sacs Uber Eats (ta question #2)
- [ ] Comment s'assurer de recuperer les 2€ — contrat, facturation ? (ta question #3)
- [ ] Quand un resto arrete, qui possede la base clients collectee ?

**Pour notre produit :**
- [ ] Qu'est-ce qui manque le plus dans les outils que tu utilises actuellement ?
- [ ] Tes restos utilisent quelle caisse ? (Zelty, Innovorder, SumUp...)

### Logistique
- [ ] Definir la zone geographique exacte Phase 1 (Essonne — quels quartiers/villes)
- [ ] Identifier 20-30 restos cibles sur Google Maps dans la zone
- [ ] Preparer les supports : plaquette imprimee, carte de visite, telephone charge

---

## Semaines 1-2 — Terrain : acquérir les premiers restaurants (19 avril - 2 mai 2026)

### Objectif : 3-5 restaurants signes

- [ ] **Prospection physique** : 15-20 visites minimum
  - Utiliser les trames physiques (UBER + FIDELISATION) de trames.md
  - Adapter avec le hook "meilleur grec de [ville]" — winner d'apres la formation
  - Commander un cafe, etre naturel, poser des questions, laisser le restaurateur parler 70% du temps
- [ ] **Criteres de selection des restos** :
  - Deja sur Uber Eats (obligatoire)
  - 50+ commandes/mois minimum sur Uber (sinon pas assez de volume pour le QR code)
  - Patron accessible (pas une chaine geree par un manager)
  - Idealement : restaurant qui fait aussi de la vente sur place (double canal)
- [ ] **Closing** :
  - Presentation de la strategie (plaquette adaptee)
  - Calcul en live avec les vrais chiffres du resto (cf. Pitch Closer page 2)
  - Signature contrat simple
  - Collecte infos : menu, photos, coordonnees, acces Uber Eats
- [ ] **Documenter chaque visite** : nom, adresse, resultat, objections, feedback

### Ce qu'on ne fait PAS encore
- Pas de marque virtuelle (complexite inutile en Phase 1 — on commence par le QR code sur la marque existante du resto)
- Pas de SMS marketing
- Pas de programme de fidelisation complexe

---

## Semaines 2-3 — Mise en place chez les premiers restaurants (3-16 mai 2026)

### Pour chaque resto signe :

- [ ] **Commander les etiquettes QR code** (55€ pour 2000, ou impression maison pour tester)
- [ ] **Creer la landing page de capture** (email + telephone)
  - Option rapide : page no-code (Carrd, Notion, ou simple page Next.js)
  - Le QR code pointe vers cette page
  - Message : "Recevez un avantage exclusif pour votre prochaine commande"
- [ ] **Configurer le site de commande directe**
  - Option 1 : utiliser le meme outil tiers que Yanis (plus rapide, 299€ setup)
  - Option 2 : page simple avec menu + bouton WhatsApp/telephone (MVP minimal)
  - Option 3 : commencer a builder le template Next.js (si tu as le temps)
  - **Decision a prendre apres le call Yanis** selon les outils qu'il utilise
- [ ] **Installer les QR codes chez le resto** : former le personnel (glisser l'etiquette dans chaque sac)
- [ ] **Mettre en place un tracking simple** : spreadsheet avec date, nombre de scans, nombre de conversions

---

## Semaines 3-6 — Mesurer et iterer (17 mai - 13 juin 2026)

### Metrics a suivre chaque semaine

| Metric | Objectif Phase 1 | Comment mesurer |
|--------|-----------------|-----------------|
| Taux de scan QR | >10% | Analytics sur la landing page (visites / etiquettes distribuees) |
| Taux de conversion (scan -> email/tel) | >30% | Formulaire soumis / visites page |
| Nb commandes directes | >5/semaine/resto | Comptage manuel ou outil |
| Satisfaction restaurateur | Positif | Point hebdo oral |
| Panier moyen direct vs Uber | >= panier Uber | Comparaison manuelle |

### Actions hebdomadaires
- [ ] Point avec chaque restaurateur (5-10 min, en personne ou telephone)
- [ ] Ajuster le message QR code si taux de scan trop bas
- [ ] Ajuster la landing page si taux de conversion trop bas
- [ ] Documenter les retours, objections, idees des restaurateurs
- [ ] Continuer la prospection terrain en parallele (objectif : 2-3 nouveaux restos/semaine)

### Ce qu'on observe
- Est-ce que les restaurateurs collent vraiment le QR code dans les sacs ? (compliance)
- Est-ce que les clients scannent ? (validation du mecanisme)
- Est-ce que les clients commandent en direct ensuite ? (validation du business model)
- Est-ce que le restaurateur voit la difference ? (satisfaction, retention)

---

## Semaine 6 — Decision Point (13 juin 2026)

### Le modele est valide SI :
- [ ] Au moins 3 restos actifs avec QR codes deployes depuis 3+ semaines
- [ ] Taux de scan QR > 5% (meme 5% c'est un signal)
- [ ] Au moins 1 resto a recu des commandes directes grace au systeme
- [ ] Aucun resto n'a arrete (churn = 0)
- [ ] Le restaurateur confirme que ca vaut le coup

### Si valide -> Phase 2 :
- Lancer la construction du **template app** (site de commande directe propre, Next.js)
- Ajouter le programme de fidelisation dans le produit
- Scaler la prospection (SMS + agent vocal Vapi)
- Objectif : 15-20 restos d'ici fin juillet

### Si pas valide -> Pivoter :
- Analyser pourquoi (mauvais profil de restos ? QR code pas scanne ? restaurateurs pas compliants ?)
- Ajuster le mecanisme avant d'investir en dev
- Eventuellement pivoter vers la fidelisation pure (sans le QR code Uber) si c'est le canal qui bloque

---

## Budget Phase 1

| Poste | Cout | Note |
|-------|------|------|
| Formation Virtual Eats Club | 1 500€ (deja paye) | Acces communaute + accompagnement Yanis |
| Etiquettes QR code (5 restos) | ~275€ | 55€/resto x 5 |
| Landing pages | 0-50€ | No-code ou dev maison |
| Outils tiers (si meme stack que Yanis) | ~1 500€ | 299€ setup x 5 restos |
| OU dev maison (si on build) | 0€ + temps | Utilise la pipeline IA NativeSquare |
| Deplacement terrain | ~100-200€ | Essence, transports |
| Branding (logo, plaquette) | 0-100€ | Canva/Figma, fait maison |
| **TOTAL** | **~2 000 - 3 500€** | Hors temps d'Alex |

---

## Notes importantes

- **On ne vend PAS un produit cher.** On propose un partenariat : "je te ramene des clients, on gagne ensemble."
- **Le produit tech (template app) n'est PAS necessaire en Phase 1.** On valide le mecanisme avec des outils simples avant de builder.
- **Les case studies de Yanis (L'Artisan, La Table Libanaise) sont utilisables** (autorisation obtenue).
- **Le nom de marque doit etre choisi avant le premier rendez-vous terrain** pour avoir des supports pros.
