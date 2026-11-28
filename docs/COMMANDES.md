# Aide-mémoire des commandes

Toutes les commandes se lancent depuis le dossier du projet :

```bash
cd "/home/blhack/Projets/Safinum Hackathon/competition/mon-nkap"
```

Le fichier `.env` (jamais envoyé sur GitHub) contient les clés : copier `.env.example` en `.env` sur une nouvelle
machine, puis remplir les valeurs. Les commandes qui en ont besoin le lisent avec `--env-file=.env`.

## Démarrer

| Quoi | Commande |
|---|---|
| Serveur (app, API, middleware SAFINUM, collecte) | `node --env-file=.env src/api/server.ts` |
| Tunnel public (middleware SAFINUM + page de collecte, rien d'autre) | `ngrok http 8080 --traffic-policy-file services/ngrok-safinum.yml` |
| Tunnel de démonstration (en plus : `/mobile` et les autres pages, avec mot de passe) | `node --env-file=.env tools/tunnel-demo.ts` puis `ngrok http 8080 --traffic-policy-file services/ngrok-demo.local.yml` |
| Arrêter l'un ou l'autre | `Ctrl+C` dans son terminal |

Laisser les deux terminaux ouverts pendant les essais et pendant que les natifs travaillent. Après une mise à jour du
code (`git pull`), redémarrer le serveur.

Avec le tunnel de démonstration, un camarade ouvre `https://audrina-nonintroverted-timorously.ngrok-free.dev/mobile`
depuis son ordinateur ou son téléphone : identifiant `gifa`, mot de passe `CT_DEMO_PASSWORD` du `.env`
(`grep CT_DEMO_PASSWORD .env`). Le middleware SAFINUM et la collecte restent ouverts sans mot de passe. `/admin` reste
fermé, sauf avec `CT_DEMO_ADMIN=1` dans `.env` (puis relancer `tools/tunnel-demo.ts` et ngrok) : il passe alors
derrière le mot de passe de démonstration, puis la clé d'administration (`grep CT_ADMIN_KEY .env`). Le fichier `services/ngrok-demo.local.yml` contient le mot de passe : il n'est jamais envoyé sur GitHub.

Pages locales : `http://localhost:8080/` (jury), `/mobile` (application, mode Conversation), `/banque`, `/gab`,
`/canaux` (USSD et SMS), `/tableau` (journal), `/admin` (clés, entraînement, collecte), `/collecte` (natifs).

## Bac à sable SAFINUM

| Quoi | Commande |
|---|---|
| Voir l'adresse enregistrée pour chaque canal | `node --env-file=.env tools/safinum.ts status` |
| Enregistrer notre tunnel pour tous les canaux (`ussd`, `mobile`, `web`, `sms`, `atm`, `ivr`) | `node --env-file=.env tools/safinum.ts endpoint https://audrina-nonintroverted-timorously.ngrok-free.dev/safinum/middleware` |
| Régénérer les données fictives du bac à sable | `node --env-file=.env tools/safinum.ts reset` |

- Une seule adresse par canal pour toute l'équipe : se mettre d'accord avant de l'enregistrer.
- safinum.cm répond parfois par intermittence : en cas de `ETIMEDOUT`, relancer la commande.
- Pendant l'évaluation, la configuration est gelée (`CONFIG_LOCKED`) : enregistrer l'adresse définitive avant.
- Simulateurs : `https://safinum.cm/sandbox/ussd`, `/sandbox/channel/mobile`, `/sandbox/channel/web`, `/sandbox/channel/sms`, `/sandbox/channel/atm`, `/sandbox/channel/ivr`
  (choisir l'équipe GIFA et un compte de test). Documentation : `https://safinum.cm/sandbox/docs`.
- Les textes des écrans mobile et web reçus sont enregistrés dans `data/ui/safinum-source.json`.

## Collecte des natifs

| Quoi | Commande |
|---|---|
| Créer X invitations pour Y langues | `npm run invitations -- 3 ewo dua fub` |
| Voir les invitations | `npm run invitations -- liste` |
| Révoquer une invitation | `npm run invitations -- revoquer c-66b704` |
| Retrouver la clé d'administration (pour `/admin`) | `grep CT_ADMIN_KEY .env` |

- Chaque personne reçoit un **code personnel**, valable pour une seule langue, affiché une seule fois.
- Lien à lui envoyer avec son code : `https://audrina-nonintroverted-timorously.ngrok-free.dev/collecte`.
- Les envois arrivent dans `/admin`, onglet « Collecte des natifs » : écouter, puis accepter ou rejeter.
  Accepté = ajouté en brouillon (tableur de la langue, jeu de test vocal ou textes d'écran SAFINUM).
- Codes de langue : `ewo` ewondo, `dua` duala, `bas` basaa, `bum` bulu, `bbj` ghomala', `byv` medumba,
  `ybb` yemba, `fub` fulfulde, `wes` pidgin, et les autres de `data/languages.json`.

## Données des natifs et entraînement

| Quoi | Commande |
|---|---|
| Préparer les tableurs d'une langue | `npm run collecte -- ewo dua` |
| Recompiler les packs après modification des tableurs | `npm run import-collecte -- fub wes` |
| Mesurer la compréhension à l'écrit (phrases des natifs) | `CT_ALLOW_DRAFT=1 node tools/eval-voice.ts fub --texte-seul` |
| Mesurer à la voix (enregistrements des natifs) | `node --env-file=.env tools/eval-voice.ts fub` |

## Modèles vocaux et traduction

| Quoi | Commande |
|---|---|
| Télécharger les modèles vocaux (avec le grand modèle 1B) | `npm run models -- --with-1b` |
| Installer et télécharger la traduction Flagship | `npm run mt:install` puis `npm run mt:models` |

Le modèle 1B s'active dans `.env` : `CT_ASR_MODEL=sherpa-onnx-omnilingual-asr-1600-languages-1B-ctc-int8-2025-11-12`.
PlotWeaver (voix ewondo, basaa, fulfulde, pidgin ; reconnaissance du pidgin) s'active avec `CT_PLOTWEAVER_KEY` et
`CT_PLOTWEAVER_LANG_<LANGUE>` (voir `.env.example`).

## Vérifier avant de pousser

| Quoi | Commande |
|---|---|
| Tous les tests | `npm test` |
| Typage | `npx tsc --noEmit` |
