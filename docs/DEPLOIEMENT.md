# Déploiement

## En local (démonstration)

```bash
npm install
npm run mt:install && npm run mt:models   # traduction Flagship (OBLIGATOIRE) : Python local + modèles ≈ 800 Mo
npm run models                 # reconnaissance vocale (≈ 350 Mo) et voix fr/en
npm start                      # http://localhost:8080 — démarre aussi le service de traduction
```

Pages : `/mobile` (application), `/banque` (site bancaire + widget), `/gab` (guichet automatique),
`/canaux` (USSD, SMS, serveur vocal), `/portail` (clés API clients + test traduction), `/admin` (gestion clés + entraînement modèles), `/tableau` (évaluation, journal, audit).

## Avec Docker

```bash
docker build -t mon-nkap .
docker run -p 8080:8080 \
  -e CT_API_KEYS="banqueA:<clé d'au moins 16 caractères>" \
  -e CT_CORS_ORIGINS="https://banque-a.example" \
  -v "$PWD/models:/app/models" -v ct-audit:/app/data/audit \
  mon-nkap
```

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port HTTP | 8080 |
| `CT_API_KEYS` | `institution:clé,…` — clés statiques sur `/v1/*` | vide = ouvert (local seulement, sauf registre) |
| `CT_KEYS_FILE` | fichier du registre persistant des clés d'entreprises (empreintes SHA-256) | `data/api-keys.json` (si présent) |
| `CT_PORTAL_SIGNUP` | `0` pour désactiver la création libre de clés sur `/portail` | activée |
| `CT_ADMIN_KEY` | secret d'administration requis dans `x-admin-key` pour `/v1/admin/*` (`/admin`) | vide (`503` sur `/v1/admin/*`) |
| `CT_RATE_LIMIT` | requêtes POST par minute et par client | 120 |
| `CT_CORS_ORIGINS` | sites autorisés à appeler l'API depuis un navigateur | tous (local) |
| `CT_AUDIT_FILE` | fichier du journal d'audit chaîné | `data/audit/audit.jsonl` |
| `CT_CONTINUITY` | `0` pour désactiver la continuité entre canaux par numéro de téléphone | activée |
| `CT_ALLOW_DRAFT` | `1` pour utiliser aussi les phrases non relues (démonstration interne, marquées « brouillon ») | désactivé |
| `CT_MT_URL` | service de traduction Flagship **obligatoire** ; défini = service distant (pas de démarrage local) | `http://127.0.0.1:8091`, démarré par le moteur |
| `CT_MT_AUTOSTART` | `0` : ne pas démarrer le service local (il doit alors tourner ailleurs) | activé |
| `CT_ASR_MODEL` | modèle de reconnaissance vocale | Omnilingual 300M int8 |

## Passerelles opérateurs

Les routes `/ussd`, `/sms` et `/ivr/at` suivent le format d'Africa's Talking. En production, les placer derrière
un nom d'hôte ou un chemin connu de l'opérateur seulement (les passerelles n'envoient pas de clé d'API), et
définir `CT_PUBLIC_URL` et `CT_IVR_RECORDING_HOSTS` pour le serveur vocal.

## Clés d'API pour les entreprises bancaires

Chaque entreprise partenaire reçoit sa propre clé (`nk_live_…`) pour appeler `/v1/translate`, `/v1/message`, `/v1/analyze` ou `/v1/voice` :

```bash
npm run keys -- create banqueA --name "Banque A Cameroun"
npm run keys -- list
npm run keys -- revoke <id-ou-prefixe>
```

En Docker, monter le registre des clés (`-v ct-keys:/app/data/keys` avec `CT_KEYS_FILE=/app/data/keys/api-keys.json`), ou définir `CT_ADMIN_KEY` pour gérer les clés à chaud via `POST /v1/admin/keys`.

> **Sécurité côté application** : dans une application mobile ou web publique, l'entreprise conserve sa clé `x-api-key` sur son **serveur applicatif** qui relaie vers Mon Nkap (afin de ne pas exposer le secret dans le code client).

## Mise à l'échelle

Le moteur ne garde en mémoire que les conversations en cours (une confirmation expire en 5 minutes). Pour
plusieurs instances : sessions et cache d'idempotence dans un magasin partagé (Redis, à ajouter), journal
d'audit centralisé.
