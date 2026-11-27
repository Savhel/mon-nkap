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

## Application Android (APK)

L'APK embarque les pages de l'application mobile (démarrage immédiat, sans navigateur) ; le moteur, la
traduction et la voix restent sur le serveur. Au premier lancement, l'application demande l'adresse du
serveur, vérifie qu'il répond (`/v1/health`) et la garde sur le téléphone (bouton réglages pour la changer).

Prérequis : Java 21 et le SDK Android (plateforme 36), `ANDROID_HOME` défini.

```bash
npm run apk          # → mobile-android/android/app/build/outputs/apk/debug/app-debug.apk
```

- Adresse proposée d'avance (facultatif) : `MONNKAP_SERVER=http://192.168.1.20:8080 npm run apk`.
- Démonstration : lancer `npm start` sur l'ordinateur, téléphone sur le même Wi-Fi, adresse
  `http://<IP de l'ordinateur>:8080` (`hostname -I`). Sur l'émulateur Android : `10.0.2.2:8080`.
- Si `CT_CORS_ORIGINS` est défini, y ajouter `http://localhost` (origine des pages embarquées).
- L'APK de débogage s'installe directement (« sources inconnues »). Pour le Play Store : APK/AAB de
  publication signé avec la clé de l'éditeur (`./gradlew bundleRelease` dans `mobile-android/android`).
- Icônes et écran de démarrage : générés depuis le logo par `node mobile-android/make-icons.mjs`.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port HTTP | 8080 |
| `CT_API_KEYS` | `institution:clé,…` — clés statiques sur `/v1/*` | vide = ouvert (local seulement, sauf registre) |
| `CT_KEYS_FILE` | fichier du registre persistant des clés d'entreprises (empreintes SHA-256) | `data/api-keys.json` (si présent) |
| `CT_PORTAL_SIGNUP` | `1` pour ouvrir la création libre de clés sur `/portail` (démonstration seulement : n'importe quel visiteur obtient alors une clé) | fermée : clés émises par `npm run keys` ou `/admin` |
| `CT_ADMIN_KEY` | secret d'administration requis dans `x-admin-key` pour `/v1/admin/*` (`/admin`) | vide (`503` sur `/v1/admin/*`) |
| `CT_SAFINUM_KEY` | clé d'équipe SAFINUM (`sbx_…`) ; active `SafinumBackend` uniquement sur `POST /safinum/middleware` | vide (`MockBackend`) |
| `CT_SAFINUM_URL` | URL de l'API bancaire SAFINUM | `https://safinum.cm/api/v1` |
| `CT_SAFINUM_WEBHOOK_KEY` | secret entrant facultatif, si le connecteur SAFINUM fournit `X-Team-Key` | vide |
| `CT_PLOTWEAVER_KEY`, `CT_PLOTWEAVER_LANG_FUB` | accès facultatif PlotWeaver et code fourni par le service (simulateur local) | désactivé |
| `CT_SAFINUM_GSM7_TRANSLIT` | `0` pour désactiver la translittération GSM-7 sur USSD SAFINUM | activée |
| `CT_CONNECTORS_FILE` | fichier du registre de connecteurs par institution | `data/connectors.json` (si présent) |
| `CT_UI_RESOURCES_FILE` | fichier du catalogue UI par institution | `data/ui-resources.json` (si présent) |
| `CT_ALLOW_PRIVATE_URLS` | `1` pour autoriser des URL privées/localhost dans les connecteurs (dev uniquement) | désactivé (anti-SSRF) |
| `CT_RATE_LIMIT` | requêtes POST par minute et par client | 120 |
| `CT_CORS_ORIGINS` | sites autorisés à appeler l'API depuis un navigateur | tous (local) |
| `CT_AUDIT_FILE` | fichier du journal d'audit chaîné | `data/audit/audit.jsonl` |
| `CT_CONTINUITY` | `0` pour désactiver la continuité entre canaux par numéro de téléphone | activée |
| `CT_ALLOW_DRAFT` | `1` pour utiliser aussi les phrases non relues (démonstration interne, marquées « brouillon ») | désactivé |
| `CT_MT_URL` | service de traduction Flagship **obligatoire** ; défini = service distant (pas de démarrage local) | `http://127.0.0.1:8091`, démarré par le moteur |
| `CT_MT_AUTOSTART` | `0` : ne pas démarrer le service local (il doit alors tourner ailleurs) | activé |
| `CT_ASR_LLM_URL` | service Meta Omnilingual avec langue choisie, voir [guide des langues](LANGUES_FINALE.md) | désactivé |
| `CT_ASR_MODEL` | modèle de reconnaissance vocale | Omnilingual 300M int8 |

## Passerelles opérateurs

Les routes `/ussd`, `/sms` et `/ivr/at` suivent le format d'Africa's Talking. En production, les placer derrière
un nom d'hôte ou un chemin connu de l'opérateur seulement (les passerelles n'envoient pas de clé d'API), et
définir `CT_PUBLIC_URL` et `CT_IVR_RECORDING_HOSTS` pour le serveur vocal.

## Bac à sable SAFINUM (`https://safinum.cm/sandbox/docs`)

1. Exposer le serveur sur une URL publique (ou tunnel `ngrok http 8080` / `cloudflared tunnel --url http://localhost:8080`).
2. Démarrer Mon Nkap avec votre clé d'équipe SAFINUM (`CT_ALLOW_DRAFT=1` ajoute les langues encore en
   brouillon, dont le fulfulde) :
   ```bash
   CT_ALLOW_DRAFT=1 CT_SAFINUM_KEY="sbx_votre_cle" npm start
   ```
   Ou, pour ne pas retaper la clé : copier `.env.example` en `.env` (ignoré par Git, à recréer sur chaque
   machine), y mettre la vraie clé, puis :
   ```bash
   node --env-file=.env src/api/server.ts
   ```
3. Déclarer votre URL middleware auprès de SAFINUM pour chaque canal (`ussd`, `mobile`, `web`) :
   ```bash
   CT_SAFINUM_KEY="sbx_votre_cle" npm run safinum -- endpoint https://votre-url-publique/safinum/middleware
   CT_SAFINUM_KEY="sbx_votre_cle" npm run safinum -- status
   ```

## Extension navigateur Manifest V3 (`extension/`)

1. Ouvrir `chrome://extensions` (ou `edge://extensions`) et activer le **Mode développeur**.
2. Cliquer sur **Charger l'extension non empaquetée** et sélectionner le dossier `extension/`.
3. Ouvrir les **Options** de l'extension pour renseigner l'URL du serveur (`http://localhost:8080` ou URL HTTPS) et la clé API (`x-api-key`) de l'entreprise.
4. Cliquer sur l'icône Mon Nkap pour ouvrir le panneau latéral (**Side Panel**), discuter avec l'assistant ou cliquer sur **Traduire la page** (les champs saisis, mots de passe et montants ne sont jamais modifiés).

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

Le serveur choisit l’URL bancaire d’après `CT_SAFINUM_URL`. Une URL reçue dans un callback est ignorée.
Après une rupture de réponse sur une confirmation, l’adaptateur tente une lecture de la transaction.
Si le statut reste inconnu, la session conserve la référence et réessaie la lecture au tour suivant.
La compatibilité de cette lecture avec le sandbox officiel doit être contrôlée avec la clé d’équipe.

PlotWeaver est facultatif. Définir `CT_PLOTWEAVER_KEY` et `CT_PLOTWEAVER_LANG_FUB` (ou
`CT_PLOTWEAVER_LANG_EWO`) d’après le catalogue disponible avec votre accès. Lorsqu’un clip natif
complet est disponible, il est joué en priorité. Sinon, le bouton de lecture peut demander une
synthèse de la réponse affichée. Le texte et le récapitulatif restent disponibles si l’appel échoue.

Codes essayés : `CT_PLOTWEAVER_LANG_EWO=ewo`, `CT_PLOTWEAVER_LANG_BAS=bas`, `CT_PLOTWEAVER_LANG_FUB=fuv`
(fulfulde du Nigeria), `CT_PLOTWEAVER_LANG_WES=pcm` (pidgin du Nigeria). La voix de synthèse ne reçoit
**jamais de chiffre** : montants, numéros et références sont retirés de la phrase dite et restent à l’écran
(à l’essai, « 125 000 FCFA » était sauté en ewondo et inintelligible en fulfulde).

Pour le pidgin, PlotWeaver sert aussi de **reconnaissance vocale** (`pcm`), avant le modèle local : sur les
enregistrements de la native, il a compris 6 demandes sur 7 dans une conversation d’essai, contre 4 sur 7
en local. L’audio part alors chez PlotWeaver : à réserver à la démonstration. `CT_PLOTWEAVER_ASR=0` la coupe.

En mode Conversation (application mobile et widget), la réponse est dite automatiquement et le micro se
rouvre. Une phrase dictée est envoyée comme « voix » : elle ne confirme jamais une opération, seul le
bouton Confirmer le fait.
