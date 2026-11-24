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
npm install
npm start           # http://localhost:8080
npm test            # tests automatiques (scénarios SAFINUM, canaux, sécurité, langues, évaluation)
npm run models      # facultatif : reconnaissance vocale Omnilingual (≈ 350 Mo) et voix fr/en
```

Prérequis : Node.js 22.18 ou plus récent (TypeScript exécuté directement) et `ffmpeg` pour la voix.
Facultatif, traduction Flagship de secours : `pip install -r services/requirements.txt`,
`python3 services/fetch_flagship.py`, puis `python3 services/mt_server.py &`.

| Page | Canal |
|---|---|
| `/mobile` | Application mobile (installable, fonctionne en PWA) |
| `/banque` | Site d'une banque fictive : assistant ajouté en **une ligne** (`widget.js`) |
| `/canaux` | USSD (*126#), SMS et serveur vocal côte à côte |
| `/gab` | Guichet automatique simulé |
| `/tableau` | Tableau de bord : évaluation par langue, journal des requêtes, audit |
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
correction, confirmation…), les **réponses** du service et les **définitions** des termes. Une ligne n'est utilisée
que si un second natif l'a validée. 30 % des phrases sont réservées au **test** et ne servent jamais à
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
| Voix | Reconnaissance Omnilingual hors ligne ; voix sortante fr/en (Piper) et enregistrements natifs assemblés pour les langues nationales — jamais une voix française pour une langue nationale |
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
public/           mobile, banque, gab, canaux, dashboard, assistant (composant partagé), widget, sdk
collecte/         tableurs des natifs + guide
data/             languages.json, lexicons/, packs/, langid/, eval/, mboa-pack.json
tools/            collecte, import-collecte, evaluate, build-langid, measure-asr, fetch-models…
```

## Limites connues

- Les packs des langues nationales sont vides tant que les natifs n'ont pas rempli et relu les tableurs : la
  compréhension en langue nationale repose d'ici là sur les lexiques brouillons hérités de Mboa.
- Le backend est simulé, en attendant la documentation de l'environnement de test SAFINUM ; aucun point d'accès
  n'est inventé.
- Le Fulfulde n'a aucun corpus ouvert : il ne peut pas être identifié automatiquement ni mesuré en voix.
- USSD, SMS et serveur vocal sont testés sur simulateur, pas sur une vraie passerelle opérateur.
- Sessions et cache d'idempotence en mémoire : une seule instance (voir `docs/DEPLOIEMENT.md`).
