# Architecture et intégration

Mon Nkap est une **couche linguistique réutilisable** : un seul moteur comprend une demande
financière dans une langue nationale et la transforme en une représentation métier commune. Les canaux
(mobile, web, USSD, SMS, serveur vocal, guichet automatique) ne sont que des adaptateurs fins ; les
institutions financières branchent leur propre backend derrière une interface unique.

```
 Canaux (adaptateurs, aucune intelligence)
 ┌─────────┬──────────┬──────┬─────┬──────────────┬─────┐
 │ Mobile  │ Web      │ USSD │ SMS │ Serveur vocal│ GAB │
 │ /mobile │ widget.js│/ussd │/sms │ /v1/ivr      │/gab │
 └────┬────┴────┬─────┴──┬───┴──┬──┴──────┬───────┴──┬──┘
      └─────────┴───── API v1 (clé, débit, idempotence) ┘
                               │
 ┌─────────────────────────────▼─────────────────────────────┐
 │ Moteur d'intelligence linguistique (src/core, src/linguistics)
 │  identification de langue (texte) ─ normalisation (tons, ɔ/o…)
 │  nombres de la langue (grammaire apprise des natifs)       │
 │  intention + entités (lexiques validés + expressions      │
 │  apprises sur les phrases des natifs)                      │
 │  dialogue : clarification, correction, confirmation,       │
 │  changement de langue, continuité entre canaux             │
 │  réponses rédigées par les natifs, contrôle des montants   │
 └─────────────────────────────┬─────────────────────────────┘
                               │ représentation canonique cmfi.v1
 ┌─────────────────────────────▼─────────────────────────────┐
 │ Orchestrateur (déterministe, sans IA)                       │
 │  jeton de confirmation à usage unique · audit chaîné        │
 └─────────────────────────────┬─────────────────────────────┘
                 ┌─────────────┴──────────────┐
        Backend simulé (MockBackend)   Adaptateur SAFINUM (à brancher)
```

## Principes

1. **Compréhension et exécution séparées.** Le moteur prépare l'opération ; elle n'est exécutée qu'après une
   confirmation explicite, liée à l'opération exacte par un jeton à usage unique.
2. **Aucune phrase inventée en langue nationale.** Les réponses et les définitions sont écrites par des natifs ;
   sinon la réponse est donnée en français et **annoncée** comme telle (`quality: fallback`).
3. **Les montants ne passent jamais par la traduction.** Ils viennent du backend et sont vérifiés dans chaque
   réponse (`verifyNumbers`) ; une réponse où un montant manque est bloquée.
4. **Tout est explicable.** Chaque interprétation indique les mots qui l'ont déclenchée (`evidence`).
5. **Rien n'est prétendu sans mesure.** Les capacités de chaque langue (`data/languages.json`) et les
   métriques (`/v1/eval`, `data/eval/`) sont celles réellement mesurées.

## Le moteur linguistique

| Brique | Fichier | Méthode |
|---|---|---|
| Normalisation | `src/core/text.ts` | Minuscules, tons retirés, ɔ→o, ɛ→e, ŋ→ng, ɓ→b… ; tolérance aux fautes d'ASR |
| Identification de langue | `src/linguistics/langid.ts` | Profils de suites de caractères appris sur Common Voice (CC0) ; « inconnue » si pas sûr |
| Nombres | `src/linguistics/numbers.ts` + `src/core/amounts.ts` | Français et anglais codés ; langues nationales : grammaire **apprise** des montants écrits par les natifs (ordre additif ou « multiplicateur d'abord », mots de liaison) ; montants non reconstruits signalés |
| Intention et entités | `src/core/nlu.ts` + `src/linguistics/runtime.ts` | Lexiques validés + expressions discriminantes apprises sur les phrases d'entraînement des natifs ; bénéficiaires par correspondance approchée avec les contacts ; code-switching : la langue choisie + français + anglais |
| Dialogue | `src/core/engine.ts` | Collecte, clarification, correction, confirmation, annulation, changement de langue |
| Réponses | `src/core/respond.ts` | Phrases des natifs (pack), sinon libellés Mboa (brouillons), sinon français annoncé |
| Représentation commune | `src/core/canonical.ts` | `cmfi.v1` |
| Traduction automatique | `src/mt/flagship.ts`, `src/mt/service.ts` | Service **obligatoire**, démarré par le moteur et surveillé par `/v1/health` ; utilisé sous garde (aller-retour fidèle, jamais de chiffre, montants repris du texte d'origine) |
| Voix | `src/voice/speech.ts`, `native.ts` | ASR Omnilingual (hors ligne) ; voix sortante : enregistrements natifs, sinon français annoncé |

## Ressources linguistiques

Chaque langue est un **pack** (`data/packs/<code>.json`, schéma `ct-langpack.v1`), produit à partir des
tableurs remplis par les natifs (`collecte/<code>/`) :

| Élément | Provenance gardée | Utilisé si |
|---|---|---|
| Nombres, lexique, phrases de demandes, réponses, définitions | auteur, relecteur, statut | relu par un second natif (`valide`) |
| Phrases de demandes | + répartition entraînement / test (30 % test, déterministe) | entraînement : apprentissage ; test : évaluation seulement |

Contrôles à l'import : une réponse qui perd un repère (`{montant}`…) ou contient un chiffre écrit à la main est
**rejetée** avec la raison.

### Ajouter une langue

```bash
npm run collecte -- bas            # crée collecte/bas/ (5 tableurs) — à remplir par deux natifs
npm run import-collecte -- bas     # data/packs/bas.json + rapport (validé / rejeté)
npm run evaluate -- bas            # métriques sur les phrases de test
```
Puis déclarer ses capacités réelles dans `data/languages.json`. Aucune ligne de code à modifier.

## Intégrer une institution financière

| Besoin | Moyen | Code à écrire chez l'institution |
|---|---|---|
| Ajouter l'assistant à un site existant | `<script src="https://<serveur>/widget.js" data-lang="fr" data-api-key="…" async></script>` | **une ligne** |
| Application mobile ou web existante | SDK `MonNkap.connect(url, { apiKey }).message(texte)` puis `.confirm(jeton)` | quelques lignes |
| Traduire des textes de son application | `POST /v1/translate` (ou `ct.translate(texte, 'ewo')`) avec `x-api-key` | un appel REST |
| Garder son propre parcours | `POST /v1/analyze` → représentation canonique (avec `x-api-key`) | appel REST |
| Passerelle USSD / SMS / vocale | `POST /ussd`, `/sms`, `/ivr/at` (format Africa's Talking) | configuration de la passerelle |
| Brancher son backend | implémenter l'interface `FinancialBackend` (`src/backend/types.ts`) : solde, contacts, frais, transfert, crédit, facture, retrait, historique | un adaptateur |

Le moteur ne connaît que l'interface `FinancialBackend`. L'adaptateur pour l'environnement de test SAFINUM
sera écrit **à partir de la documentation officielle des organisateurs** : aucun point d'accès n'est inventé
d'ici là ; le backend simulé (`MockBackend`) en tient lieu, clairement identifié.

### Ajouter un canal

Un canal transforme ses entrées en texte (un choix de menu devient une phrase canonique, comme « solde ») et
affiche `reply.text`, `reply.menu` et `canonical`. Exemple : le guichet automatique (`public/gab.html`) tient en
une page sans aucune règle linguistique.

## Données et licences

| Ressource | Licence | Usage |
|---|---|---|
| Phrases des natifs (collecte) | consentement des contributeurs (`collecte/GUIDE_NATIFS.md`) | packs de langue |
| Common Voice 27.0 (ewo, dua, wes) | CC0 ; interdit de redistribuer le jeu ou d'identifier les locuteurs | profils d'identification de langue (fréquences seulement), mesure de l'ASR (chiffres seulement) |
| Omnilingual ASR (Meta) | Apache-2.0 | voix → texte |
| Flagship cameroon-int8 | licence contradictoire (voir `LICENSES.md`) | secours de démonstration, désactivable |
