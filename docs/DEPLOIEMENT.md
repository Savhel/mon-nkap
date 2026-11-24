# Déploiement

## En local (démonstration)

```bash
npm install
npm start                      # http://localhost:8080
npm run models                 # facultatif : reconnaissance vocale (≈ 350 Mo) et voix fr/en
```

Pages : `/mobile` (application), `/banque` (site bancaire + widget), `/gab` (guichet automatique),
`/canaux` (USSD, SMS, serveur vocal), `/tableau` (évaluation, journal, audit).

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
| `CT_API_KEYS` | `institution:clé,…` — active l'authentification sur `/v1/*` | vide = ouvert (local seulement) |
| `CT_RATE_LIMIT` | requêtes POST par minute et par client | 120 |
| `CT_CORS_ORIGINS` | sites autorisés à appeler l'API depuis un navigateur | tous (local) |
| `CT_AUDIT_FILE` | fichier du journal d'audit chaîné | `data/audit/audit.jsonl` |
| `CT_CONTINUITY` | `0` pour désactiver la continuité entre canaux par numéro de téléphone | activée |
| `CT_ALLOW_DRAFT` | `1` pour utiliser aussi les phrases non relues (démonstration interne, marquées « brouillon ») | désactivé |
| `CT_MT_URL` | service de traduction Flagship (facultatif) | `http://127.0.0.1:8091` |
| `CT_ASR_MODEL` | modèle de reconnaissance vocale | Omnilingual 300M int8 |

## Passerelles opérateurs

Les routes `/ussd`, `/sms` et `/ivr/at` suivent le format d'Africa's Talking. En production, les placer derrière
un nom d'hôte ou un chemin connu de l'opérateur seulement (les passerelles n'envoient pas de clé d'API), et
définir `CT_PUBLIC_URL` et `CT_IVR_RECORDING_HOSTS` pour le serveur vocal.

## Mise à l'échelle

Le moteur ne garde en mémoire que les conversations en cours (une confirmation expire en 5 minutes). Pour
plusieurs instances : sessions et cache d'idempotence dans un magasin partagé (Redis, à ajouter), journal
d'audit centralisé.
