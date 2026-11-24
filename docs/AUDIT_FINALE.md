# Audit de l'existant, étude des langues et architecture recommandée — finale SAFINUM 2026

*Rédigé le 24 novembre 2026, avant toute modification du code. Base : l'archive `cameroun-translate.zip`
extraite, le brief « SAFINUM Innovate Challenge 2026 — Présentation du Challenge Final », le dépôt Mboa
(présélection : 87/100, 7ᵉ) et `docs/RESOURCE_AUDIT.md` (ressources externes, que ce document complète sans
le répéter). Chaque chiffre est soit mesuré par nous (indiqué), soit cité avec sa source.*

---

## 1. Ce que le jury va réellement tester

Le brief de la finale change la nature de l'épreuve. La présélection jugeait la traduction d'une interface.
La finale juge une **infrastructure linguistique réutilisable** :

- au moins une **langue nationale** comprise et parlée ;
- **trois canaux obligatoires : application mobile, application web, USSD**, plus GAB, serveur vocal (IVR)
  et SMS en bonus, tous branchés sur un backend simulé commun ;
- un **protocole tiré au sort** : le jury choisit l'opération, **la langue nationale**, le canal, soumet la
  requête, puis **répète la même opération sur un autre canal** et compare ;
- **10 scénarios** : solde, transfert, frais, historique, correction, requête ambiguë, solde insuffisant,
  changement de langue, multicanal, terminologie financière **expliquée dans la langue nationale** ;
- 8 critères dont **précision linguistique** (« qualité, exactitude et naturalité ») en premier.

Conséquence : le point qui décide de la victoire est la **compréhension réelle d'une langue nationale**, par
écrit et à l'oral. L'interopérabilité est nécessaire mais ne suffira pas.

---

## 2. Audit du code existant

### 2.1 Vue d'ensemble

| Élément | Constat |
|---|---|
| Langage | TypeScript exécuté directement par Node ≥ 22.18 (sans compilation), `node:http` sans framework |
| Taille | 59 fichiers, environ 2 400 lignes de code TypeScript, 1 dépendance d'exécution (`sherpa-onnx-node`) |
| Tests | **50 tests : 43 réussis, 0 échec, 7 ignorés** (modèles vocaux non téléchargés). `tsc` : 0 erreur. *Mesuré le 24/11* |
| Services annexes | `services/mt_server.py` (traduction Flagship en Python, facultatif) |
| Données | `data/languages.json` (22 langues et leurs capacités déclarées), `data/lexicons/*.json` (6 lexiques), `data/mboa-pack.json` (phrases Mboa importées) |

### 2.2 Ce qui fonctionne (vérifié par les tests)

| Brique | Fichier | État |
|---|---|---|
| Moteur de dialogue commun à tous les canaux | `src/core/engine.ts` | ✅ Solide : collecte, clarification, confirmation obligatoire, correction avant exécution, annulation, solde insuffisant, changement de langue en cours d'opération |
| Extraction des montants et numéros | `src/core/amounts.ts` | ✅ Chiffres et lettres **en français et en anglais**, réparation des fautes d'ASR, numéros ≠ montants |
| Contrôle d'intégrité des réponses | `src/core/respond.ts` (`verifyNumbers`) | ✅ Une réponse dont un montant manque est bloquée |
| Contrat backend | `src/backend/types.ts` | ✅ Interface propre ; le backend simulé s'y conforme |
| USSD | `src/channels/ussd.ts` | ✅ Protocole Africa's Talking, écrans ≤ 182 caractères, pagination, menus dans la langue |
| SMS | `src/channels/sms.ts` | ✅ Langue mémorisée par numéro, confirmation par « 1 » |
| Serveur vocal | `src/channels/ivr.ts` | ✅ Choix de langue au clavier, demande parlée, XML Africa's Talking ; jamais de voix française pour une langue nationale |
| Voix | `src/voice/speech.ts`, `native.ts` | ✅ ASR Omnilingual (Apache-2.0, 17 langues du catalogue) et Piper fr/en ; assemblage d'enregistrements natifs prévu |
| API REST + SDK navigateur | `src/api/server.ts`, `public/sdk.js` | ✅ `/v1/message`, `/v1/voice`, `/ussd`, `/sms`, `/v1/ivr`, `/v1/events` |
| Traduction Flagship sous garde | `src/mt/flagship.ts` | ✅ Garde-fous sérieux (aller-retour, pas de chiffre, filtre religieux) |
| Honnêteté des statuts | `respond.ts`, `languages.json` | ✅ Chaque réponse porte `validated` / `draft` / `machine` / `fallback` |

**À conserver tel quel** : le moteur, l'extraction des montants, le contrôle d'intégrité, le contrat backend,
les adaptateurs USSD/SMS/IVR, les garde-fous de traduction. La base technique est bonne.

### 2.3 Ce qui est incomplet ou manquant

Classé par impact sur la note finale.

| # | Problème | Preuve | Impact |
|---|---|---|---|
| 1 | **La compréhension des langues nationales repose surtout sur le français.** Les lexiques « ewondo », « duala » et « fulfulde » contiennent majoritairement des emprunts (« solde », « transfert », « facture »). | Mesuré : expressions d'intention propres à la langue — **ewo 9/22, dua 7/20, fub 7/19, wes 16/40**. Oui / non / correction en langue : **0** pour ewo, dua et fub. | **Critique** (précision linguistique, compréhension). Un jury qui parle ewondo naturellement ne sera pas compris. |
| 2 | **Aucun nombre en langue nationale.** `amounts.ts` ne connaît que le français et l'anglais. | Code lu. | **Critique** : un montant dit en ewondo n'est pas reconnu. |
| 3 | **Aucun scénario testé en langue nationale.** Les 10 scénarios SAFINUM sont testés **uniquement en français** (sauf « wetin be pin » en pidgin). | `tests/scenarios.test.ts`. | **Critique** : rien ne prouve que le protocole du jury passe en ewondo, duala… |
| 4 | **Aucune phrase validée par un natif** : 0 sur 620 dans les tableurs Mboa. Les réponses en langue nationale sont des brouillons. | `RESOURCE_AUDIT.md` §2, `mboa-pack.json` (`status: draft`). | **Critique** : vérification spécifique par des locuteurs compétents. *Note : le README de Mboa affiche « relu et validé » depuis une modification du 14/11 ; c'est inexact et doit être corrigé avant la finale.* |
| 5 | **Terminologie expliquée seulement en français.** Le glossaire n'existe qu'en fr/en ; en langue nationale, la définition reste en français. | `respond.ts` (`case 'explain'`). | Élevé : le scénario 10 exige l'explication **dans la langue nationale**. |
| 6 | **Pas de canal mobile ni de canal web bancaire réels.** « Mobile » et « web » ne sont que des valeurs du champ `channel` de l'API. Pas d'application mobile, pas d'interface bancaire web intégrée (seulement `canaux.html`, une page de démonstration). | `public/`, README « application Android à venir ». | **Critique** : deux des trois canaux obligatoires ne sont pas démontrables comme tels. |
| 7 | **Pas d'adaptateur pour le sandbox SAFINUM.** Le backend est un simulateur maison. | `src/backend/mock.ts`. | Élevé : la démonstration doit se faire dans l'environnement SAFINUM. Dépend de la documentation des organisateurs. |
| 8 | **Pas de continuité entre canaux.** Les sessions sont cloisonnées par canal (`ussd:<id>`, `sms:<numéro>`). | `ussd.ts`, `sms.ts`. | Moyen : « poursuivre sur un autre canal » est un plus attendu. |
| 9 | **Pas d'identification de langue.** La langue est choisie par l'utilisateur ; seul « parle-moi en duala » est détecté par mot-clé. | `nlu.ts` (`switchTo`). | Moyen : utile pour le changement de langue spontané et le code-switching. |
| 10 | **Représentation métier non normalisée.** `EngineResult` mélange intentions (`balance`, `confirm`…) et états ; pas de schéma versionné. | `engine.ts`. | Moyen : la « représentation commune » est un critère explicite. |
| 11 | **Sécurité d'exécution minimale** : pas d'authentification, pas de clé d'idempotence, pas de limitation de débit, CORS ouvert (`*`), sessions et journal en mémoire. La confirmation est obligatoire, mais portée par la session et non par un jeton à usage unique. | `server.ts`, `engine.ts`. | Moyen pour la démo, élevé pour la crédibilité « déployable ». |
| 12 | **Tableau de bord d'évaluation absent.** `/v1/events` renvoie un journal, sans métriques (précision, rappel, exactitude des montants, latence par langue et par canal). | `server.ts`. | Moyen : le jury a son propre tableau de bord, mais nos chiffres mesurés renforcent la crédibilité. |
| 13 | **Voix en langue nationale non mesurée.** L'ASR n'a été testée qu'avec des voix de synthèse fr/en ; aucun enregistrement natif dans `data/audio/`. | `tests/voice.test.ts`, `data/audio/` vide. | Élevé pour l'IVR et l'accessibilité. |
| 14 | **Traduction Flagship : licence contradictoire (NC ?) et domaine biblique.** | `docs/MT_EVALUATION.md`, `LICENSES.md`. | Faible si elle reste un secours étiqueté. |

### 2.4 Ce qui est simulé

- Le backend financier (comptes, barème « 1 %, min 100, max 2 500 FCFA » d'exemple).
- Les passerelles USSD, SMS et vocale (testées sur simulateur, sans compte opérateur).
- Les voix en langue nationale (aucun enregistrement).

---

## 3. Étude comparative des langues

### 3.1 Données ajoutées par nos mesures (en plus de `RESOURCE_AUDIT.md`)

Mesures faites les 13 et 14 novembre 2026, sur des données ouvertes, sans rien inventer :

- **Common Voice 27.0 (licence CC0, téléchargé et vérifié)** — phrases écrites et lues par des locuteurs :
  Ewondo **883 phrases, 26 locuteurs** ; Duala **1 003 phrases, 13 locuteurs** ; Pidgin camerounais
  **999 phrases, 16 locuteurs**. Les archives audio sont sur la machine de l'équipe (≈ 760 Mo).
- **Contrôle des brouillons Mboa contre de vrais textes** (`mboa/validation/PISTES_CORPUS.md`) :
  mots jamais vus — Ewondo 26 %, Duala 7 %, Pidgin 2 %. Exemple concret : le corpus Ewondo écrit
  « argent » **mɔni**, nos brouillons **mɔ́nə** (44 phrases). La traduction Flagship donne aussi « mòni ».
- **Reconnaissance de la langue parlée (Meta MMS-LID, 180 voix Common Voice)** : la bonne langue figure
  dans les 3 propositions pour Duala 90 %, Ewondo 78 %, Pidgin 42 %. Insuffisant pour décider seul.

### 3.2 Matrice

Légende : ✅ vérifié et réutilisable · ⚠️ existe avec réserve (licence, domaine, qualité, une seule direction)
· ❌ rien trouvé · **?** à fournir par l'équipe.

| Critère | Ewondo | Duala | Fulfulde (Adamaoua) | Basaa | Ghomala' | Medumba | Pidgin (Kamtok)* |
|---|---|---|---|---|---|---|---|
| Corpus texte ouvert | ✅ CV 883 phrases | ✅ CV 1 003 + ⚠️ MT560 15 351 (Bible) | ❌ | ⚠️ CV (non vérifié) + MT560 (Bible) | ⚠️ Bible (Flagship, licence ?) | ❌ | ✅ CV 999 + ⚠️ MT560 28 159 |
| Corpus audio ouvert | ✅ CV, 26 locuteurs | ✅ CV, 13 locuteurs | ❌ | ⚠️ CV (non vérifié) | ⚠️ ≈ 20 h Bible (licence ?) | ❌ | ✅ CV, 16 locuteurs |
| Traduction automatique | ⚠️ Flagship ↔ fr (Bible, NC ?) | ⚠️ OPUS fr→dua seul | ⚠️ Flagship ↔ fr | ⚠️ OPUS fr→bas seul | ⚠️ Flagship ↔ fr | ⚠️ Flagship ↔ fr | ❌ |
| ASR (CER publié, modèle 7B de Meta) | ⚠️ 17,0 % | ✅ 5,4 % | ✅ 5,2 % | ⚠️ 9,7 % | ⚠️ 17,7 % | ❌ 57,3 % | ✅ 3,1 % |
| Synthèse vocale | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (MMS pcm = Nigeria) |
| Phrases financières existantes | ⚠️ 155 + 57 blocs (brouillons) | ⚠️ 155 + 57 | ⚠️ 155 + 57 | ❌ | ❌ | ❌ | ⚠️ 155 + 57 |
| Brouillons vérifiés contre un corpus | ✅ 26 % de mots non attestés | ✅ 7 % | ❌ aucun corpus | — | — | — | ✅ 2 % |
| Orthographe | Alphabet général des langues camerounaises (AGLC) ; tons rarement écrits dans le corpus | AGLC, tons écrits dans CV | Latin + ɓ ɗ ƴ | AGLC | AGLC | AGLC | Pas de norme stricte (proche de l'anglais) |
| Nombres en langue disponibles | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (anglais) |
| **Locuteurs natifs disponibles dans l'équipe** | **?** | **?** | **?** | **?** | **?** | **?** | **?** |
| Faisabilité d'un MVP solide d'ici la finale | Moyenne : bonnes ressources, ASR faible | **Bonne** : meilleure ASR des langues bantoues, brouillons les plus proches du corpus | Moyenne : bonne ASR, aucun corpus de contrôle | Faible : rien de financier | Faible | Très faible | **Bonne**, mais statut « langue nationale » discutable |

\* Le Pidgin camerounais est la langue la plus facile à rendre fiable (proche de l'anglais, ASR à 3,1 %),
mais le jury pourrait ne pas le compter comme « langue nationale ». À utiliser en **deuxième langue**,
jamais comme unique langue.

### 3.3 Recommandation

- **Langue prioritaire : le Duala**, *si l'équipe dispose d'au moins deux locuteurs natifs disponibles*.
  Arguments : meilleure ASR publiée parmi les langues bantoues du catalogue (5,4 %), brouillons financiers
  existants et les plus proches de vrais textes (7 % de mots non attestés), corpus audio CC0 avec
  orthographe tonale (permet de **mesurer** notre ASR sur de vraies voix), traduction fr→dua disponible
  pour aider les traducteurs.
- **Sinon, l'Ewondo** : langue de Yaoundé (ville du salon), plus de locuteurs CV, traduction dans les deux
  sens. Mais l'ASR publiée est à 17 % d'erreur par caractère et 26 % des mots des brouillons ne sont pas
  attestés : il faudra plus de travail natif.
- **Deuxième langue : le Pidgin** (rapide à fiabiliser), puis le Fulfulde si un locuteur est disponible.
- **La décision dépend d'abord des locuteurs disponibles**, pas des ressources numériques : sans deux natifs
  pour écrire et valider, aucune langue ne passera la vérification du jury.

### 3.4 Spécificités à traiter (pour la langue retenue)

À établir **avec les natifs** et à coder comme règles propres à la langue (jamais en supposant des règles
communes) :

1. **Numération** : comment se disent 500, 5 000, 25 000, 150 000 ; emprunts au français pour les grands
   nombres ; montants mélangés (« cinq mille » dans une phrase en langue). Première priorité : sans
   nombres, pas de transfert.
2. **Lexique financier** : argent, compte, solde, envoyer, recevoir, frais, facture, crédit, historique,
   annuler, confirmer, oui, non, « plutôt / non c'est… » (correction).
3. **Variantes orthographiques** : tons (avec / sans), ɔ/o̱, ɛ/e̱, ŋ/ng ; la normalisation existante
   (`text.ts`) les replie déjà, à compléter par langue.
4. **Code-switching** : mots financiers français au milieu d'une phrase en langue (très fréquent, à
   accepter explicitement plutôt qu'à subir).
5. **Politesse et formulation naturelle** des réponses (le jury juge la « naturalité »).
6. **Explication des termes** (frais, solde, bénéficiaire, PIN) **rédigée par un natif**.

---

## 4. Architecture recommandée

Principe : **garder le cœur existant** (il est bon) et ajouter ce qui manque autour, sans réécriture.
TypeScript/Node est conservé : le code fonctionne, il est testé, et une réécriture en Java/Spring coûterait
des semaines sans gain pour le jury.

```
 Canaux (adaptateurs fins, aucune intelligence)
 ┌──────────┬──────────┬──────┬─────┬─────┬─────┐
 │ Mobile   │ Web      │ USSD │ SMS │ IVR │ GAB │
 │ (PWA)    │ (widget) │      │     │     │     │
 └────┬─────┴────┬─────┴──┬───┴──┬──┴──┬──┴──┬──┘
      └──────────┴──── API linguistique v1 ────┘
                          │
 ┌────────────────────────▼──────────────────────────┐
 │ Moteur d'intelligence linguistique                 │
 │  1. Identification de langue (texte), sinon demander│
 │  2. Normalisation par langue (orthographe, tons)   │
 │  3. Nombres et montants par langue (grammaire)     │
 │  4. Intention + entités (lexique validé, puis      │
 │     classifieur quand les données suffisent)       │
 │  5. Dialogue (existant : clarification, correction,│
 │     confirmation, changement de langue)            │
 │  6. Réponses : gabarits validés par des natifs     │
 └────────────────────────┬──────────────────────────┘
                          │ Représentation financière canonique (JSON versionné)
 ┌────────────────────────▼──────────────────────────┐
 │ Orchestrateur financier (déterministe, sans IA)    │
 │  jeton de confirmation · idempotence · journal     │
 │  d'audit · validation métier · limites             │
 └────────────────────────┬──────────────────────────┘
          ┌───────────────┴───────────────┐
   Adaptateur sandbox SAFINUM      Backend simulé (existant)
```

### 4.1 Représentation financière canonique (proposition)

```json
{
  "schema": "cmfi.v1",
  "language": "dua",
  "detectedLanguage": { "code": "dua", "confidence": 0.82, "method": "lexicon" },
  "channel": "ussd",
  "intent": "TRANSFER_MONEY",
  "entities": { "amount": 5000, "currency": "XAF", "beneficiary": { "name": "Marie Ngo Bassa", "phone": "655778899" } },
  "confidence": 0.91,
  "requiresClarification": false,
  "requiresConfirmation": true,
  "confirmationToken": "…",
  "evidence": ["transfer:<mot reconnu>", "amount:<expression reconnue>"],
  "resourceVersions": { "lexicon:dua": "1.2.0", "numbers:dua": "1.0.0" }
}
```

Intentions : `CONSULT_BALANCE`, `TRANSFER_MONEY`, `CHECK_FEES`, `VIEW_HISTORY`, `BUY_AIRTIME`, `PAY_BILL`,
`WITHDRAW_MONEY` (GAB), `EXPLAIN_TERM`, plus les actes de dialogue `CONFIRM`, `CANCEL`, `CORRECT`,
`SWITCH_LANGUAGE`. Correspondance directe avec les intentions actuelles du moteur. La liste finale sera
alignée sur les opérations réellement exposées par le sandbox SAFINUM.

### 4.2 Choix techniques justifiés

| Besoin | Choix | Pourquoi |
|---|---|---|
| Compréhension en langue nationale | **Lexique et grammaire des nombres validés par des natifs**, puis classifieur léger (n-grammes de caractères) quand il y aura assez de phrases natives par intention | Aucun modèle pré-entraîné ne comprend le duala ou l'ewondo financier ; un LLM inventerait. Un lexique est explicable au jury et corrigeable par un linguiste sans réentraînement |
| LLM | **Non utilisé pour comprendre ni exécuter.** Éventuellement pour aider les traducteurs à préparer des propositions, toujours relues | Directive : jamais seul, jamais d'exécution ; pas de LLM fiable en duala ou en ewondo |
| Identification de langue (texte) | Score de couverture des lexiques + n-grammes de caractères appris sur Common Voice (CC0) | Données réelles disponibles ; « je ne sais pas » si le score est faible |
| ASR | Omnilingual (existant), **mesurée** sur les voix Common Voice de la langue retenue (taux d'erreur par mot et par caractère) | Données de test réelles déjà téléchargées |
| Voix sortante | Enregistrements natifs assemblés (existant) | Aucune synthèse n'existe ; pas de fausse prononciation |
| Mobile | **Application web progressive (PWA)** installable sur Android | Démontrable en quelques jours, même SDK ; une app native n'apporte rien au jury |
| Web bancaire | **Widget** (SDK existant) intégré dans une page de banque en ligne simulée, ou dans le simulateur web SAFINUM | Montre l'intégration « sans modifier le code métier » |
| GAB | Écran de GAB simulé branché sur le même moteur | Canal bonus peu coûteux une fois les menus USSD faits |
| Continuité entre canaux | Session rattachée à l'identité (numéro de téléphone) en plus de l'identifiant de canal | Permet « commencé en USSD, confirmé par SMS » |
| Sécurité | Jeton de confirmation à usage unique, clé d'idempotence, journal d'audit en ajout seul, limitation de débit, clé d'API par institution, CORS restreint | Une prédiction n'est jamais une autorisation |

---

## 5. Plan par étapes et critères d'acceptation

| Étape | Contenu | Critère d'acceptation (vérifiable) |
|---|---|---|
| **A. Audit** | Ce document | Validé par l'équipe |
| **B. Langue prioritaire** | Choix avec les natifs disponibles ; collecte guidée : nombres, lexique financier, formulations naturelles par scénario, réponses, définitions | ≥ 2 natifs ; phrases écrites **par des natifs**, chacune validée par un second natif ; séparation entraînement / test **avant** tout développement |
| **C. Architecture** | Schéma canonique, contrats API v1 | Schéma JSON publié et testé ; les tests existants passent toujours |
| **D. Moteur linguistique** | Nombres et lexique de la langue, identification de langue, explication des termes en langue | Sur le **jeu de test natif jamais vu** : intention ≥ 90 %, montant exact ≥ 98 %, bénéficiaire ≥ 95 %, aucune exécution sans confirmation. Chiffres publiés tels quels, même s'ils sont plus bas |
| **E. Backend financier** | Orchestrateur (jeton, idempotence, audit) ; adaptateur SAFINUM dès réception de la documentation | Double soumission = une seule opération ; aucun endpoint inventé |
| **F. Mobile, web, USSD** | PWA, widget web, USSD existant | Les 10 scénarios passent **dans la langue retenue** sur les 3 canaux, avec le même JSON canonique |
| **G. Voix et canaux bonus** | Mesure de l'ASR sur Common Voice ; enregistrements natifs ; IVR, SMS, GAB | Taux d'erreur publié par langue ; la voix n'est annoncée que si les tests passent |
| **H. Tests et optimisation** | Tableau de bord de métriques par langue, canal et scénario | Métriques recalculables par une commande |
| **I. Compétition** | Démo tirée au sort, documentation, vidéo | Répétition à blanc avec un natif extérieur à l'équipe |

---

## 6. Décisions à prendre par l'équipe avant de coder

1. **Quels locuteurs natifs avons-nous, pour quelles langues, et combien d'heures peuvent-ils donner ?**
   C'est ce qui fixe la langue prioritaire.
2. **La documentation du sandbox SAFINUM est-elle arrivée ?** Sinon, on continue sur le backend simulé
   derrière une interface prête à recevoir l'adaptateur.
3. **Date de la finale** : elle détermine combien d'étapes (F, G, H) sont réalistes.
4. **Corriger dès maintenant la mention « relu et validé » du README de Mboa**, inexacte.

---

## 7. Avancement au 24 novembre 2026 (après l'audit)

Décisions de l'équipe : natifs disponibles pour le duala, l'ewondo, le fulfulde, le pidgin et d'autres langues ;
documentation du bac à sable SAFINUM pas encore reçue ; travail en continu jusqu'à la fin.

| Étape | Réalisé | Critère d'acceptation | État |
|---|---|---|---|
| A. Audit | Ce document | Validé | ✅ |
| B. Langues | Kit de collecte pour les natifs (5 tableurs par langue, guide, consentement), import avec contrôles et provenance, répartition entraînement / test | ≥ 2 natifs, phrases validées par un second natif | ⏳ **outils prêts ; tableurs à remplir par les natifs** (`collecte/`) |
| C. Architecture | Représentation canonique `cmfi.v1`, API v1 documentée | Schéma testé, anciens tests toujours verts | ✅ |
| D. Moteur linguistique | Grammaire des nombres apprise des natifs ; intentions apprises sur leurs phrases ; réponses et définitions natives ; identification de langue (Common Voice) ; changement de langue spontané | Métriques sur le jeu de test natif | ✅ mécanique testée ; ⏳ chiffres réels dès que les natifs ont rempli les tableurs |
| E. Backend financier | Jeton de confirmation à usage unique, idempotence, audit chaîné, clés d'API, débit, retrait (GAB) | Double envoi = une seule opération ; aucun point d'accès inventé | ✅ (backend simulé ; adaptateur SAFINUM dès réception de la documentation) |
| F. Mobile, web, USSD | Application mobile (PWA), widget web en une ligne + banque de démonstration, USSD existant | Même représentation canonique sur les canaux | ✅ testé sur 6 canaux ; ⏳ scénarios en langue nationale après la collecte |
| G. Voix et canaux bonus | GAB simulé, continuité entre canaux (USSD → SMS), mesure de l'ASR sur Common Voice | Taux d'erreur publiés par langue | ✅ GAB, continuité ; mesure ASR : voir `data/eval/asr-*.json` |
| H. Tests et mesures | Évaluation par langue (intentions, montants, bénéficiaires, clarification, cohérence, latence), tableau de bord `/tableau` | Recalculable par une commande | ✅ (`npm run evaluate`) |
| I. Compétition | Scénarios de démonstration, déploiement Docker, documentation | Répétition avec un natif extérieur | ⏳ après la collecte |

Corrections faites en passant : chemins de fichiers cassés par l'espace du dossier (le serveur ne démarrait pas
avec `npm start`) ; faux fournisseur ENEO détecté dans « coûtent » ; réponses en français étiquetées
« validées » (désormais « référence »).

**Le chemin critique est maintenant la collecte des natifs.** Tout le reste est prêt à recevoir leurs phrases :
dès que les tableurs sont remplis et relus, `npm run import-collecte` puis `npm run evaluate` donnent les vrais
chiffres par langue.
