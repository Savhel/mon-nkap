# Mon Nkap

Une **infrastructure linguistique réutilisable** pour les langues nationales du Cameroun, conçue pour la finale du
SAFINUM Innovate Challenge 2026 (équipe GIFA).

Un seul moteur comprend une demande financière, parlée ou écrite, dans une langue nationale : il en extrait
l'opération, le montant et le bénéficiaire, dialogue (clarification, correction, confirmation), fait exécuter
l'opération par le backend financier, puis répond dans la langue de l'utilisateur. Il produit une
**représentation canonique identique sur tous les canaux** : application mobile, web, USSD, SMS, serveur vocal et
guichet automatique ne sont que des adaptateurs fins branchés sur la même API. Une institution l'intègre sans
reconstruire son propre moteur linguistique, et sans modifier son code métier.

## Démarrage

```bash
npm ci
cp .env.example .env
node --env-file=.env src/api/server.ts   # http://localhost:8080
npm run typecheck
npm test                                # vérifications locales sans modèles
```

Node.js ≥ 22.18 suffit au dialogue texte et aux menus USSD. Pour le micro avec Omnilingual ASR et la
lecture native ou Piper, installer `ffmpeg` puis lancer `npm run models` sur la machine de démonstration.
Python ≥ 3.10 et `npm run mt:install && npm run mt:models -- fufulde bulu` activent le repli de traduction
Flagship de Lingo. Le pack int8 téléchargé pour ce mode porte CC BY-NC 4.0. Voir les variantes CC BY
et la documentation d'installation pour les modèles exacts.

`/v1/health` indique la disponibilité du moteur local et de la traduction. `/v1/languages` indique les
modes vocaux configurés. Le micro impose 20 secondes maximum par enregistrement. Le modèle Sherpa-ONNX
CTC détecte la transcription sans paramètre de langue. La langue choisie, **fub** pour le fulfulde de
l’Adamaoua, pilote l’interprétation et les réponses. Le parcours HTTPS ou localhost donne accès au micro
du navigateur.

Pour préparer la finale, commencer par [le parcours jury et la vérification](docs/SCENARIOS_DEMO.md).

| Page | Canal |
|---|---|
| `/mobile` | Application mobile : PWA installable, ou APK Android (`npm run apk`, voir docs/DEPLOIEMENT.md) |
| `/banque` | Site d'une banque fictive : assistant ajouté en **une ligne** (`widget.js`) |
| `/canaux` | USSD (*126#), SMS et serveur vocal côte à côte |
| `/gab` | Guichet automatique simulé |
| `/tableau` | Tableau de bord : évaluation par langue, journal des requêtes, audit |
| `/portail` | Portail entreprises : obtention de clé API et test de traduction en direct |
| `/admin` | Console d'administration : clés API et entraînement / évaluation des modèles |
| `/` | Page de test vocal |

## Les langues : travail des natifs d'abord

Aucune phrase en langue nationale n'est inventée. Chaque langue est un **pack** construit à partir de ce que des
locuteurs natifs écrivent, puis relisent mutuellement :

```bash
npm run collecte -- dua ewo fub wes     # tableurs à remplir (collecte/<langue>/) + collecte/GUIDE_NATIFS.md
npm run import-collecte                 # → data/packs/<langue>.json, avec chaque ligne rejetée et sa raison
npm run evaluate                        # métriques sur les phrases de test des natifs, langue par langue
```

Les natifs écrivent : comment on **dit les montants** (la grammaire des nombres de la langue est apprise de leurs
exemples), le **lexique financier**, ce qu'ils diraient **naturellement** dans 22 situations (solde, transfert,
correction, confirmation…), les **réponses** du service et les **définitions** des termes. Le mode standard utilise les contributions relues. Le mode concours `CT_ALLOW_DRAFT=1` ajoute les premières contributions et affiche leur statut de brouillon. 30 % des phrases sont réservées au **test** et ne servent jamais à
l'apprentissage.

## Ce qui fonctionne (vérifié par les tests)

| Brique | État |
|---|---|
| Compréhension | Intentions (solde, transfert, frais, historique, crédit, facture, retrait, explication de termes), montants en chiffres et en mots, bénéficiaires, numéros. Français et anglais codés ; langues nationales apprises des packs des natifs ; mélange de langues accepté |
| Nombres en langue nationale | Grammaire apprise des exemples des natifs (ordre additif ou « multiplicateur d'abord », mots de liaison) ; un montant non reconstruit est signalé, jamais deviné |
| Dialogue | Clarification (plusieurs « Paul »), correction avant exécution, confirmation obligatoire, solde insuffisant, changement de langue (demandé ou détecté), continuité entre canaux par numéro de téléphone |
| Représentation canonique | `cmfi.v1` : opération, acte de dialogue, entités, confiance, besoin de clarification ou de confirmation — identique sur les 6 canaux (testé) |
| Sécurité | Une prédiction n'est jamais une autorisation : jeton de confirmation à usage unique lié à l'opération exacte ; idempotence ; journal d'audit chaîné (SHA-256) ; clés d'API par institution ; limitation de débit ; CORS restreint |
| Identification de langue | Profils appris sur Common Voice (CC0), mesurés sur des phrases mises de côté : ewondo 94 %, duala 95 %, pidgin 75 % (phrase entière) ; « inconnue » plutôt qu'une supposition |
| Réponses | Phrases des natifs (pack), sinon libellés Mboa (brouillons), sinon français ; le statut est toujours affiché (`reference`, `validated`, `draft`, `fallback`). Chaque montant est vérifié dans la réponse |
| Traduction | Service Flagship facultatif (ewondo, fulfulde, bulu, ghomala', yemba ↔ français), démarré par le moteur : comprend une demande en langue nationale par le français quand le lexique ne suffit pas, et propose une réponse traduite seulement si l'aller-retour est fidèle et sans chiffre, toujours marquée « traduction automatique ». La langue produite est vérifiée. OPUS-MT et MADLAD-400 (Apache-2.0) sont installés et mesurés (`npm run mt:compare`), mais routés pour aucune langue : OPUS écrit dans une autre langue bantoue que celle demandée, MADLAD recopie le français ou produit des phrases religieuses (voir `docs/MT_EVALUATION.md`). Duala et pidgin : aucun moteur fiable, la qualité vient des natifs |
| Voix | Reconnaissance Omnilingual hors ligne ; voix sortante fr/en (Piper), clips natifs fulfulde/pidgin si la réponse entière est couverte et PlotWeaver facultatif pour le simulateur local |
| Évaluation | Exactitude des intentions, précision / rappel / F1 par intention, exactitude des montants et des bénéficiaires, clarification, cohérence mobile / web / USSD, latence — par langue, jamais mélangée avec le français |

## Documentation

- [docs/AUDIT_FINALE.md](docs/AUDIT_FINALE.md) — audit de l'existant, étude comparative des langues, plan par étapes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — architecture, ressources linguistiques, intégration d'une institution
- [docs/API.md](docs/API.md) — spécification de l'API v1
- [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) — déploiement (Docker, variables)
- [docs/SCENARIOS_DEMO.md](docs/SCENARIOS_DEMO.md) — les 10 scénarios du jury, canal par canal
- [docs/RESOURCE_AUDIT.md](docs/RESOURCE_AUDIT.md), [docs/LICENSES.md](docs/LICENSES.md), [docs/MT_EVALUATION.md](docs/MT_EVALUATION.md) — ressources externes et licences

## Structure

```
src/core/         text, amounts, nlu, respond, engine, canonical
src/linguistics/  collection (catalogue de collecte), csv, importer, pack, numbers, runtime, langid
src/security/     audit (journal chaîné), guards (clés, débit, idempotence)
src/eval/         evaluate (métriques sur les phrases de test des natifs)
src/backend/      types (contrat FinancialBackend), mock (backend simulé)
src/channels/     ussd, sms, ivr
src/voice/        speech (ASR, TTS), native (enregistrements natifs)
src/api/          server (REST + pages)
mobile-android/   application Android (Capacitor) : pages de public/ embarquées, moteur sur le serveur
public/           mobile, banque, gab, canaux, dashboard, assistant (composant partagé), widget, sdk
collecte/         tableurs des natifs + guide
data/             languages.json, lexicons/, packs/, langid/, eval/, mboa-pack.json
tools/            collecte, import-collecte, evaluate, build-langid, measure-asr, fetch-models…
```

## Limites connues

- Le fulfulde et le pidgin disposent de premières contributions de locuteurs et de clips enregistrés avec accord. Les phrases sont des brouillons tant que la relecture est en cours.
- Ewondo et duala restent expérimentaux. Basaa et bulu figurent au catalogue avec des capacités limitées.
- Le middleware SAFINUM et le simulateur local sont disponibles. Le sandbox officiel nécessite une clé d’équipe et un endpoint public enregistré.
- Les canaux télécom locaux utilisent un simulateur. Les sessions, les résultats d’idempotence et les rapprochements en attente sont en mémoire, sur une seule instance.
