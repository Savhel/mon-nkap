# API linguistique Mon Nkap — v1

Une seule API pour tous les canaux. Une institution financière l'appelle depuis son application mobile, son
site web, sa passerelle USSD ou SMS, son serveur vocal ou ses guichets automatiques. Elle n'a pas à construire
son propre moteur linguistique.

Base : `https://<serveur>` (en local : `http://localhost:8080`). Corps JSON en UTF-8.

## Sécurité

| Mécanisme | Détail |
|---|---|
| Clé d'API par institution | En-tête `x-api-key`. Activée dès que la variable `CT_API_KEYS="banqueA:<clé ≥ 16 caractères>,…"` est définie. Sans elle, l'API est ouverte : **développement local uniquement**. Routes publiques : `/v1/health`, `/v1/languages`, `/v1/labels` |
| Limitation de débit | `CT_RATE_LIMIT` requêtes POST par minute et par client (120 par défaut). Au-delà : `429 trop_de_requetes` |
| Idempotence | En-tête `Idempotency-Key` sur `/v1/message` et `/v1/confirm` : la même clé renvoie la même réponse pendant 24 h, sans retraiter. En-tête de réponse `idempotent-replayed: true|false` |
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

### `POST /v1/identify` — langue d'un texte

`{ "text": "…" }` → `{ "lang": "dua" | null, "confidence": 0.93, "ranking": [...], "reason"?: "texte trop court" }`.
`null` quand l'identification n'est pas sûre : on ne devine jamais.

### `POST /v1/voice?sessionId&channel&lang` — voix

Corps : audio (webm, wav, m4a, mp3, ogg). Réponse : `{ transcript: { text, engine, audioSeconds, decodeMs }, result }`.

### `GET /v1/labels?lang=` — libellés d'interface

Menus (solde, envoyer, frais…) dans la langue, avec leur provenance (`reference`, `validated`, `draft`, `fallback`).

### `GET /v1/languages` — registre des langues

Capacités **réelles** de chaque langue (compréhension, réponses, voix entrante, voix sortante), avec leur statut.

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
