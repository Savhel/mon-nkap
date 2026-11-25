# API linguistique Mon Nkap — v1

Une seule API pour tous les canaux. Une institution financière l'appelle depuis son application mobile, son
site web, sa passerelle USSD ou SMS, son serveur vocal ou ses guichets automatiques. Elle n'a pas à construire
son propre moteur linguistique.

Base : `https://<serveur>` (en local : `http://localhost:8080`). Corps JSON en UTF-8.

## Sécurité

| Mécanisme | Détail |
|---|---|
| Clé d'API par institution | En-tête `x-api-key`. Activée dès que `CT_API_KEYS="banqueA:<clé ≥ 16 caractères>,…"` ou le registre `data/api-keys.json` (`npm run keys`) contient des clés. Seules les empreintes SHA-256 sont enregistrées sur disque. Sans aucune clé configurée, l'API est ouverte : **développement local uniquement**. Routes publiques : `/v1/health`, `/v1/languages`, `/v1/labels` |
| Limitation de débit | `CT_RATE_LIMIT` requêtes POST par minute et par client (120 par défaut). Au-delà : `429 trop_de_requetes` |
| Idempotence | En-tête `Idempotency-Key` sur `/v1/message`, `/v1/confirm` et `/v1/translate` : la même clé renvoie la même réponse pendant 24 h, sans retraiter. En-tête de réponse `idempotent-replayed: true|false` |
| Confirmation | Aucune opération n'est exécutée sans confirmation explicite, liée par un **jeton à usage unique** à l'opération exacte présentée (montant, bénéficiaire, fournisseur), valable 5 minutes. Toute correction crée un nouveau jeton |
| Audit | Chaque exécution, annulation ou échec est inscrit dans un journal chaîné (SHA-256) ; numéros de téléphone masqués |
| CORS | `CT_CORS_ORIGINS="https://banque.example,…"` limite les sites autorisés |

Une prédiction linguistique n'est **jamais** une autorisation financière : le moteur prépare, l'utilisateur confirme, le backend exécute.

## Représentation canonique `cmfi.v1`

Toute réponse du moteur contient `canonical`, identique quel que soit le canal et la langue :

```json
{
  "schema": "cmfi.v1",
  "language": "dua",
  "channel": "ussd",
  "operation": "TRANSFER_MONEY",
  "act": "REQUEST",
  "entities": { "amount": 5000, "currency": "XAF", "fee": 100, "total": 5100,
                "beneficiary": { "name": "Marie Ngo Bassa", "phone": "655778899" } },
  "confidence": 1,
  "requiresClarification": false,
  "requiresConfirmation": true,
  "confirmationToken": "6c1f…",
  "status": "awaiting_confirmation",
  "evidence": ["transfer:envoie"],
  "resources": { "pack:dua": "2026-11-24T…" }
}
```

- `operation` : `CONSULT_BALANCE`, `TRANSFER_MONEY`, `CHECK_FEES`, `VIEW_HISTORY`, `BUY_AIRTIME`, `PAY_BILL`, `WITHDRAW_MONEY`, `EXPLAIN_TERM`, `GREETING`, `HELP`, ou `null`.
- `act` : `REQUEST` (nouvelle demande), `CONFIRM`, `CANCEL`, `CORRECT`, `CHOOSE_OPTION`, `SWITCH_LANGUAGE`, `UNKNOWN`.
- `status` : `answered`, `needs_clarification`, `awaiting_confirmation`, `executed`, `failed`, `cancelled`.
- `evidence` : les mots qui ont conduit à l'interprétation (explicabilité).

## Routes

### `POST /v1/message` — dialogue

```json
{ "sessionId": "abc", "channel": "mobile", "lang": "dua", "text": "…", "userPhone": "677112233" }
```
`channel` : `mobile`, `web`, `ussd`, `sms`, `ivr`, `atm`, `api`. `userPhone` (facultatif) rattache la conversation
au numéro de l'utilisateur : une opération commencée sur un canal peut être confirmée sur un autre.

Réponse : `EngineResult`, dont `reply.text` (dans la langue), `reply.fr` (équivalent français), `reply.quality`
(`reference` pour fr/en, `validated` = relu par des natifs, `draft`, `machine`, `fallback`), `reply.menu`
(choix numérotés), `params`, `canonical`, `latencyMs`, `errors`, `understanding.detectedLanguage`.

### `POST /v1/confirm` — confirmation par jeton

```json
{ "sessionId": "abc", "token": "<canonical.confirmationToken>", "channel": "web" }
```
`200` : opération exécutée (même forme que `/v1/message`). `409` : `{ "error": "jeton_invalide" | "jeton_expire" }`.

### `POST /v1/analyze` — analyse sans dialogue ni exécution

`{ "text": "…", "lang": "ewo" }` → représentation canonique seule. Pour une institution qui garde son propre
parcours et ne veut que la compréhension.

### `POST /v1/translate` — traduction vers/depuis les langues locales (protégée par `x-api-key`)

Permet à l'application d'une entreprise bancaire de traduire ses textes ou messages via notre serveur (priorité :
pack natif validé → brouillons Mboa si `allowDraft: true` ou `CT_ALLOW_DRAFT=1` → traduction automatique Flagship
sous garde sans chiffre).

```json
{ "text": "Quel montant voulez-vous envoyer ?", "from": "fr", "to": "dua", "allowDraft": false }
```
Ou en lot (1 à 20 chaînes) :
```json
{ "texts": ["Banque en ligne", "Solde"], "from": "fr", "to": "dua", "allowDraft": true }
```
Réponse : `{ "institution": "ecobank", "text": "…", "from": "fr", "to": "dua", "quality": "validated" | "draft" | "machine" | "fallback", "accepted": true, "source": "pack:dua", "reason"?: "…", "mt"?: { "back": "…", "score": 0.9, "engine": "…", "ms": 42 } }` (ou `{ "institution": "…", "items": [...] }` pour `texts`).

### `GET /v1/admin/keys`, `POST /v1/admin/keys`, `POST /v1/admin/keys/revoke` — gestion des clés par entreprise

Routes d'administration protégées par l'en-tête `x-admin-key` (comparé à la variable `CT_ADMIN_KEY`, `503 admin_non_configure` si absente).

- `GET /v1/admin/keys` → `{ "keys": [{ "id", "institution", "name", "prefix", "createdAt", "active", "source" }] }`
- `POST /v1/admin/keys` avec `{ "institution": "ecobank", "name": "Ecobank Cameroun" }` → `201 { "key": "nk_live_…", "record": { … } }` (la clé en clair n'est affichée qu'à la création).
- `POST /v1/admin/keys/revoke` avec `{ "id": "<id ou prefixe>" }` → `200 { "record": { …, "active": false } }`.

### `GET /v1/portal/config`, `POST /v1/portal/keys` — auto-inscription portail client (`/portail`)

Permet aux entreprises d'obtenir leur propre clé API depuis l'interface `/portail` (désactivable via `CT_PORTAL_SIGNUP=0`, qui renvoie alors `403 auto_inscription_desactivee`).

- `POST /v1/portal/keys` avec `{ "institution": "afriland", "name": "Afriland First Bank" }` → `201 { "key": "nk_live_…", "record": { … } }`.

### `GET|PUT /v1/admin/training/*` — entraînement des modèles depuis `/admin` (protégées par `x-admin-key`)

- `GET /v1/admin/training/status` → état des tableurs `collecte/`, packs compilés, service MT et profils LangId.
- `GET /v1/admin/training/sheet?lang=dua&sheet=demandes` et `PUT /v1/admin/training/sheet` (`{ lang, sheet, csv }`) → lecture et mise à jour d'un tableur CSV.
- `POST /v1/admin/training/train` (`{ lang?, includeDrafts?, retrainLangId? }`) → compile `data/packs/<lang>.json`, recharge le moteur à chaud, recalcule `data/eval/<lang>.json` et enrichit `data/langid/profiles.json`.
- `POST /v1/admin/training/mt-test` (`{ text, from?, to, allowDraft? }`) → test de traduction rapide côté admin.

### `POST /v1/identify` — langue d'un texte

`{ "text": "…" }` → `{ "lang": "dua" | null, "confidence": 0.93, "ranking": [...], "reason"?: "texte trop court" }`.
`null` quand l'identification n'est pas sûre : on ne devine jamais.

### `POST /v1/voice?sessionId&channel&lang` — voix

Corps : audio (webm, wav, m4a, mp3, ogg). Réponse : `{ transcript: { text, engine, audioSeconds, decodeMs }, result }`.

### `GET /v1/labels?lang=` — libellés d'interface

Menus (solde, envoyer, frais…) dans la langue, avec leur provenance (`reference`, `validated`, `draft`, `fallback`).

### `GET /v1/languages` — registre des langues

Capacités **réelles** de chaque langue (compréhension, réponses, voix entrante, voix sortante), avec leur statut.

### `GET /v1/health` — état

`200 { ok: true, translation: { up, pairs, url } }` ; `503` si le service de traduction (obligatoire) est indisponible.

### `GET /v1/eval?lang=` — évaluation mesurée

Métriques sur les phrases de test des natifs : intention, montants, bénéficiaires, clarification, cohérence
mobile / web / USSD, latence. `n = 0` et une note si aucune phrase de test validée n'existe.

### `GET /v1/events` — journal (format du tableau de bord du jury)

Canal, langue, requête, interprétation, paramètres, réponse, statut, temps d'exécution, erreurs.

### `GET /v1/audit` — journal d'audit

`{ chainIntact: true, events: [...] }`.

### Passerelles opérateurs

| Route | Format |
|---|---|
| `POST /ussd` | Africa's Talking : `sessionId, phoneNumber, serviceCode, text` → `CON …` / `END …` (écrans ≤ 182 caractères) |
| `POST /sms` | `{ from, text, lang? }` → `{ reply, segments, result }` |
| `POST /v1/ivr`, `POST /ivr/at` | Serveur vocal (JSON ou XML Africa's Talking) |

## Pages fournies

| Page | Rôle |
|---|---|
| `/mobile` | Application mobile (installable, PWA) |
| `/banque` | Site d'une banque fictive + widget intégré en une ligne |
| `/gab` | Guichet automatique simulé |
| `/canaux` | USSD, SMS, web et serveur vocal côte à côte |
| `/tableau` | Tableau de bord : évaluation, journal, audit |
| `/portail` | Portail entreprises : création de clé API et bac à sable de traduction |
| `/admin` | Console d'administration : gestion des clés, édition CSV et entraînement des modèles |
| `/sdk.js`, `/widget.js` | SDK navigateur et widget |

## Erreurs

| Code | Corps |
|---|---|
| 400 | `{ "error": "text requis" }` (paramètre manquant ou invalide) |
| 401 | `{ "error": "cle_api_requise" }` |
| 409 | `{ "error": "jeton_invalide" \| "jeton_expire" }` |
| 413 | corps trop volumineux |
| 429 | `{ "error": "trop_de_requetes" }` |
| 503 | ressource absente (ex. profils d'identification de langue) |
