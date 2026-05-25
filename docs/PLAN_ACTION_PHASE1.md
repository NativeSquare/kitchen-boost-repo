# Plan d'Action Phase 1 — NativeEats

**Date :** 12 avril 2026
**Objectif :** Etre pret a demarcher des restaurateurs des demain (13 avril)
**Philosophie :** MVP partout. On pense avec le restaurateur, pas on lui vend.

---

## Vue d'ensemble — 4 chantiers paralleles

```
CHANTIER 1          CHANTIER 2           CHANTIER 3           CHANTIER 4
Marque & Landing    Supports de vente    Trame commerciale    Prospects & CRM
                                         
Nom + DA            Plaquettes           Script adapte        Liste Google Maps
Landing page        Contrat adapte       Objections           Mini CRM CSV
QR code brande      Simulateur ROI       Pitch closing        Suivi relances
```

---

## CHANTIER 1 — Marque & Landing Page

### 1.1 Nom de marque

**Contraintes :**
- Doit parler a un restaurateur (pas trop tech, pas trop startup)
- Doit evoquer : clients directs, independance, croissance
- Doit etre dispo en .fr ou .com
- Exploite par NativeSquare (pas besoin d'une entite juridique separee)

**Pistes a trancher :**

| Nom | Pour | Contre |
|-----|------|--------|
| **NativeEats** | Coherent avec NativeSquare, deja dans le CLAUDE.md | Sonne tech/startup, pas forcement parlant pour un restaurateur |
| **ClickEat** | Utilise dans le Pitch Closer de Yanis, simple | Potentiellement le nom de Yanis, a verifier si c'est dispo |
| **DirectResto** | Explicite, le restaurateur comprend de suite | Generique, pas memorable |
| **RestoLibre** | Evoque l'independance vs Uber | Peut sonner politique |
| **MonMenu.direct** | Le restaurateur se projette, extension .direct existe | Long |
| **Frenchi** | Court, memorable, clin d'oeil France | Pas explicite sur le service |

**Action Alex :** Choisir un nom. Verifier dispo domaine + Instagram.

### 1.2 Direction artistique (2h max)

- **Palette :** reprendre le vert + noir des plaquettes existantes (deja pro, le restaurateur connait ce style clean)
- **Logo :** typographique, le nom en gras + un petit element visuel (fourchette, fleche, etc). Faisable sur Canva en 30 min
- **Variantes necessaires :**
  - Logo sur fond noir (pour plaquettes)
  - Logo sur fond blanc (pour landing page, carte de visite)
  - Favicon (pour le site)

### 1.3 Landing page MVP

**Objectif :** une page simple qui fait 2 choses :
1. **Cote restaurateur** (quand tu donnes ta carte/plaquette) : presenter le service, generer confiance, CTA vers WhatsApp/telephone
2. **Cote client final** (quand le client scanne le QR code) : capturer email/telephone, donner l'avantage fidelite

**Option recommandee :** 2 pages distinctes sur le meme domaine

**Page restaurateur** (`/restaurateurs` ou page d'accueil) :
- Headline : "Recuperez vos clients Uber. Payez 0% de commission."
- 3 bullet points de valeur
- Les case studies (L'Artisan, La Table Libanaise)
- CTA : "Discutons" -> lien WhatsApp pre-rempli ou calendrier de RDV
- Pas de pricing sur la page (ca se discute en RDV)

**Page client** (`/avantage` ou `/cadeau`) :
- Headline : "Votre avantage exclusif chez [Nom du resto]"
- Formulaire simple : prenom, email, telephone
- Apres soumission : afficher le code avantage ou rediriger vers le menu de commande directe

**Stack :** Next.js (tu maitrises), deploye sur Vercel, 1 aprem de dev max avec ta pipeline IA.

---

## CHANTIER 2 — Supports de vente

### 2.1 Plaquette commerciale adaptee

Reprendre la [Plaquette Anti-Uber](Plaquette_commerciale_-_Anti-Uber.pptx_(1).pdf) et adapter :
- [ ] Remplacer toutes les references FLJC/ClickEat par ta marque
- [ ] Garder les case studies (L'Artisan, La Table Libanaise) — autorisation Yanis OK
- [ ] Ajouter ton logo et tes coordonnees
- [ ] Garder le meme style visuel (vert/noir, ca marche)
- [ ] Format : PDF a envoyer par WhatsApp + version imprimee A4 pliee

### 2.2 Contrat adapte

Le [template de contrat](Copie%20de%20%F0%9F%9F%A2%20%5BTEMPLATE%20VIERGE%5D%20-%20Contrat%20restaurateur%20%20(commission).md) est bien structure. A adapter :
- [ ] Remplacer "NOM SOCIETE" par NativeSquare (ou la marque si entite separee)
- [ ] Remplir les coordonnees, ville du tribunal, etc.
- [ ] Verifier que l'Article 3 (2€/commande) correspond a ton pricing Phase 1
- [ ] L'Article 3.1 bis (evolution remuneration apres fidelisation) est parfait pour l'approche graduelle
- [ ] L'Article 12 bis (frais outils avec accord ecrit) te protege — le resto ne paie jamais de surprise
- [ ] Imprimer 5-10 exemplaires en double

### 2.3 Simulateur ROI simple

Pour le closing en RDV (cf. [Pitch_Closer](Pitch_Closer.pptx.pdf) page 2) :
- [ ] Preparer un tableur simple (Google Sheets ou meme papier) avec les formules :
  - CA mensuel Uber x 30% = commission perdue
  - Nombre de commandes x 2€ = notre remuneration
  - Difference = gain net du restaurateur
- [ ] Pouvoir le remplir en live devant le restaurateur

---

## CHANTIER 3 — Trame de vente personnalisee

### 3.1 Positionnement NativeEats vs trames Yanis

Les trames dans [trames.md](trames.md) sont celles de Yanis/Virtual Eats. Elles marchent pour du cold call et de la prospection volume. **Toi, tu fais du terrain en physique, seul, en Phase 1.** Le ton doit etre different :

**Ce qu'on garde :**
- Le hook humoristique (fausse commande, "meilleur grec de...")
- Le calcul en live des commissions perdues
- La regle du 70/30 (le restaurateur parle 70% du temps)

**Ce qu'on adapte :**
- Tu n'es pas un "commercial", tu es le fondateur d'une boite tech qui vient proposer un partenariat
- Tu ne vends pas un "systeme cle en main" generique — tu proposes de travailler AVEC le restaurateur
- Tu ne parles pas de prix au premier RDV sauf si on te le demande

### 3.2 Trame physique recommandee pour Alex

```
ENTREE (30 secondes)
- Entrer, commander un cafe ou une boisson
- "Bonjour, c'est vous le patron ?"
- "Je m'appelle Alex, je suis le fondateur de [Marque]. 
  On travaille avec des restaurants dans le coin pour 
  les aider a recuperer les clients qu'ils perdent sur Uber Eats."

QUESTION CLE (laisser parler)
- "Vous etes sur Uber Eats ?"
- "Et ca represente a peu pres combien de votre CA ?"
- "Vous savez combien ca vous coute en commission par mois ?"

CALCUL EN LIVE (le declic)
- Sortir le telephone ou un papier
- "[X] commandes x [Y€] panier moyen x 30% = [Z€] par mois 
  qui partent chez Uber"
- Silence. Laisser le chiffre faire son travail.

PROPOSITION (pas de vente, un partenariat)
- "On a un systeme qui permet de faire revenir ces clients 
  directement chez vous, sans Uber. Pas de site a creer, 
  pas de pub a payer."
- "En gros, on met un QR code dans vos sacs de livraison, 
  le client le scanne, et la prochaine fois il commande 
  directement chez vous."
- "Nous, on se remunere 2€ par nouveau client qu'on vous ramene. 
  Si on vous ramene rien, vous payez rien."

SI INTERET
- "Je peux vous montrer comment ca marche concretement, 
  vous avez 5 minutes la ou vous preferez qu'on se cale 
  un creneau tranquille ?"
- Montrer la plaquette
- Si chaud : "On peut demarrer cette semaine. 
  J'ai juste besoin de votre KBIS, d'une piece d'identite 
  et d'un RIB."

SI HESITATION
- "Aucun souci. Tenez, voila ma carte. Scannez le QR code 
  dessus, vous verrez comment ca marche cote client. 
  Et si ca vous parle, vous m'envoyez un message."
- Laisser la carte / plaquette

SORTIE
- "Merci pour le cafe. Bonne journee [prenom]."
- Noter dans le CRM : nom, adresse, resultat, objections, 
  prochaine action
```

### 3.3 Objections courantes et reponses

| Objection | Reponse |
|-----------|---------|
| "J'ai pas le temps" | "Je comprends. Ca prend zero temps de votre cote — on s'occupe de tout. La seule chose que vos equipes font, c'est glisser une etiquette dans le sac." |
| "Uber ca me va bien" | "C'est normal, Uber vous amene des clients. L'idee c'est pas d'arreter Uber, c'est de garder les clients qu'Uber vous amene pour qu'ils reviennent SANS repayer 30%." |
| "C'est combien ?" | "Le setup c'est quelques centaines d'euros de couts d'outils, et apres on prend 2€ par client qu'on vous ramene. Si on vous ramene rien, vous payez rien. On gagne que si vous gagnez." |
| "J'ai deja un site" | "Super. L'idee c'est pas de remplacer votre site, c'est de faire revenir les clients Uber directement chez vous. Votre site peut tout a fait servir de point d'arrivee." |
| "Un autre m'a deja propose un truc comme ca" | "C'est possible. La difference c'est qu'on est pas un outil SaaS ou une formation. On met le systeme en place, on le fait tourner, et on est payes au resultat. Si ca marche pas, on bosse gratos jusqu'a ce que ca marche." |
| "Je vais reflechir" | "Bien sur. Je vous laisse ma carte avec un QR code — scannez-le, ca vous montre exactement ce que vos clients verront. Et si ca vous parle, un simple message WhatsApp et on demarre." |

---

## CHANTIER 4 — Prospects & Mini CRM

### 4.1 Identification des prospects

**Zone Phase 1 :** Essonne / Sud IdF (a preciser : quelles villes exactement ?)

**Methode :**
1. Google Maps : chercher "restaurant" dans la zone cible
2. Filtrer : sur Uber Eats (verifier sur l'app), avis Google > 3.5 etoiles, air d'activite
3. Pour chacun noter : nom, adresse, telephone, type de cuisine, note Google, present sur Uber Eats (oui/non)

**Criteres de priorisation :**
- Priorite 1 : Deja sur Uber Eats + fast food/casual + zone urbaine dense
- Priorite 2 : Deja sur Uber Eats + restaurant traditionnel
- Priorite 3 : Pas sur Uber Eats mais volume sur place important (approche fidelisation)

### 4.2 Mini CRM CSV

Structure du fichier :

```csv
id,nom_resto,adresse,ville,telephone,type_cuisine,patron_prenom,uber_eats,note_google,nb_avis_google,date_premier_contact,canal_contact,resultat,objections,prochaine_action,date_prochaine_action,statut,notes
1,Le Kebab d'Or,12 rue de la Gare,Evry,0612345678,Kebab,Ahmed,oui,4.2,350,2026-04-13,physique,rdv_pris,,rappeler pour confirmer,2026-04-14,chaud,sympathique - 50 cmd Uber/jour
```

**Colonnes :**

| Colonne | Description |
|---------|-------------|
| id | Numero unique |
| nom_resto | Nom du restaurant |
| adresse | Adresse complete |
| ville | Ville |
| telephone | Numero du patron si possible |
| type_cuisine | Kebab, Pizza, Burger, Traditionnel, Asiatique... |
| patron_prenom | Prenom du gerant/patron |
| uber_eats | oui / non |
| note_google | Note Google Maps |
| nb_avis_google | Nombre d'avis |
| date_premier_contact | Date du premier contact |
| canal_contact | physique / telephone / dm_instagram / whatsapp |
| resultat | pas_contacte / contact_ok / rdv_pris / close / refuse / a_relancer |
| objections | Texte libre — ce qu'il a dit |
| prochaine_action | Texte libre — quoi faire ensuite |
| date_prochaine_action | Quand |
| statut | prospect / chaud / close / perdu |
| notes | Tout ce qui est utile |

### 4.3 Process de suivi

Apres chaque visite terrain :
1. Remplir une ligne dans le CRM immediatement (sur le telephone, Google Sheets)
2. Si RDV pris : ajouter dans Google Calendar
3. Si "a relancer" : noter la date de relance dans le CRM
4. Chaque soir : review du CRM, preparer les visites du lendemain

---

## Ordre de priorite pour aujourd'hui/demain

### Aujourd'hui (12 avril) — Preparation

1. **Choisir le nom de marque** (30 min)
2. **Creer le logo** sur Canva (30 min)
3. **Adapter le contrat** avec le nom NativeSquare + coordonnees (30 min)
4. **Adapter la plaquette commerciale** avec le nouveau branding (1h)
5. **Creer le fichier CRM CSV** vide avec les bonnes colonnes (10 min)
6. **Identifier 15-20 restos cibles** sur Google Maps dans ta zone (1h)
7. **Preparer la landing page** (2-3h si dev, ou page Carrd en 30 min)

### Demain (13 avril) — Premier jour terrain

1. Imprimer 10 plaquettes + 5 contrats en double
2. Avoir la landing page live (meme minimale)
3. Charger le CRM sur Google Sheets (accessible telephone)
4. Partir sur le terrain avec :
   - Plaquettes imprimees
   - Contrats imprimes
   - Telephone charge (CRM + plaquette PDF en backup)
   - La trame en tete (relire le matin)
5. Objectif : 5-8 visites, 2-3 RDVs pris

---

## Ce qu'on NE FAIT PAS en Phase 1

- Pas de marque virtuelle (on commence par le QR code sur la marque existante du resto)
- Pas de programme fidelite complexe (on capture juste email/tel)
- Pas d'app mobile
- Pas de SMS marketing automatise
- Pas d'agent vocal Vapi
- Pas de site de commande directe complet (ca viendra avec le template app)

Le MVP c'est : **QR code dans le sac -> landing page capture -> le client rappelle/recommande directement**. On mesure si ca convertit avant de construire plus.
