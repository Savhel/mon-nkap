# Licences : Mon Nkap

*État au 23 novembre 2026. Aucun modèle n'est intégré ni redistribué tant que sa ligne n'est pas marquée « Autorisé ».*

## 1. Catégories

| Code | Catégorie | Règle dans le projet |
|---|---|---|
| **C** | Libre, usage commercial permis (Apache-2.0, MIT, CC-BY, CC0) | Intégrable. Attribution dans l'écran « À propos des modèles » |
| **NC** | Gratuit, usage non commercial seulement (CC BY-NC, CC BY-NC-SA) | **Prototype et démo du concours uniquement.** Téléchargé depuis la source officielle, jamais embarqué dans l'APK ni redistribué depuis nos serveurs. Désactivé en build « production » |
| **R** | Recherche uniquement | Comme NC, avec en plus une demande écrite à l'auteur |
| **Q** | API à quota gratuit | Facultative. Jamais requise. Clé gardée côté serveur, jamais dans l'app |
| **A** | Ressource publique avec autorisation particulière | Utilisable seulement après un accord écrit, archivé dans `docs/authorizations/` |
| **?** | Licence inconnue ou contradictoire | **Bloqué** jusqu'à clarification |

> Un concours suivi d'un déploiement auprès de banques est un **usage commercial**. Une ressource NC peut servir à la démo, mais pas au produit déployé. Le règlement de la présélection impose aussi de « déclarer les composants tiers » et de « respecter les droits de propriété intellectuelle ».

## 2. Modèles et données

| Ressource | Licence constatée | Catégorie | Statut dans le projet | Action requise |
|---|---|---|---|---|
| Flagship AI, cameroon-int8 | Fiche du dépôt : CC BY-NC 4.0. README de l'organisation **et README de chaque paire** (ex. `ewondo-francais/README.md`) : `license: cc-by-4.0` | **?** puis NC | Démo du concours (NC) : ewondo et yemba n'existent que sous cette forme | Écrire à Flagship (lingo.cm) pour l'ewondo et le yemba avant un déploiement |
| Flagship AI, paires d'origine fp32 (`flagship-ai/fufulde-francais`, `francais-fufulde`, ghomala, bulu, pinyin) | CC BY 4.0 (métadonnées des dépôts, 26 novembre 2026) | **C** | **Autorisé** : `python3 services/fetch_flagship.py --ccby` les convertit en int8. Conversion de `fufulde-francais` et `francais-fufulde` **identique octet pour octet** au pack NC (`model.bin`, vocabulaire, config, tokenizers) | Attribution Flagship AI / Lingo (lingo.cm) |
| Tokenizer Helsinki-NLP/opus-mt-en-fr (`source.spm`, `target.spm`, `vocab.json`) | Apache-2.0 | **C** | Autorisé : ce sont exactement les fichiers fournis dans les paires Flagship (empreintes identiques) | Attribution Helsinki-NLP / OPUS |
| maseyan/French_Medumba (paires français ↔ médumba `byv`) | CC BY 4.0, accès sur demande (dépôt « gated ») | **C** | Non téléchargé : demande d'accès à faire avec le compte Hugging Face de l'équipe | Attribution |
| masakhane/mafand (dont français ↔ ghomala `bbj`, actualités) | CC BY-NC 4.0 | NC | Utilisable pour le concours (vérification du vocabulaire), pas embarqué | — |
| facebook/mms-tts-pcm (pidgin **nigérian**), mms-tts-ful (fulfulde, variété non précisée), mms-tts-ybb (yemba) | CC BY-NC 4.0 | NC | Démo du concours possible ; à faire écouter par un natif avant usage. Aucune voix MMS pour duala, bassa, ewondo, ghomala, médumba | — |
| Griot-MT (`bivariant/Griot-MT-1.3B-ALL`, ewondo et fulfulde ↔ français) | Aucune licence déclarée (fiche et API, 26 novembre 2026) | **?** | Bloqué ; 1,4 milliard de paramètres, 4,5 Go, scores publiés par l'auteur seul | Demander une licence à l'auteur |
| Flagship cameroon_bibles, ghomala-spoken-bible | CC-BY-4.0 selon le README (fiches non lues) | ? | Non utilisé | Vérifier les fiches |
| OPUS-MT tc-bible-big …-bnt (Helsinki-NLP) | Apache-2.0 | **C** | Autorisé (secours fr/en→langue) | Attribution Helsinki-NLP / OPUS |
| NLLB-200 (Meta) | CC BY-NC 4.0 (modèles), MIT (code) | NC | Inutile : seul fuv est couvert, et c'est la mauvaise variété | — |
| MMS-1B-all ASR, MMS-TTS (Meta) | CC BY-NC 4.0 | NC | Démo uniquement (TTS yemba et meta' si nécessaire) | — |
| mimba/nllb200-ngiemboon2fr | CC BY-NC-SA 4.0 | NC | Non prioritaire | — |
| mimba/opus-mt-fra2ngiemboon | Étiquette Apache-2.0, entraîné sur des données NC-SA, accès sur conditions | ? | Bloqué (et BLEU 0,1) | — |
| mimba/text2text (jeu de données) | CC BY-NC-SA 4.0, accès sur conditions | NC | Non utilisé | — |
| NITHUB-AI marian-mt-bbc en↔pcm | CC-BY-4.0 | C | Non utilisé : pidgin nigérian, pas camerounais | — |
| Enutrof marian-mt-pcm-en | MIT | C | Non utilisé (même raison) | — |
| **Meta Omnilingual ASR** (CTC 300M/1B int8, conversion Sherpa-ONNX) | Apache-2.0 (LICENSE inclus dans l'archive du modèle) | **C** | **Autorisé, intégré** (voix → texte, 17 des 20 langues) | Attribution Meta |
| sherpa-onnx-node 1.13.8 (moteur) | Apache-2.0 | **C** | Autorisé, intégré | — |
| Piper fr_FR siwis medium | Jeu de données CC-BY 4.0, mais voix **affinée depuis la voix « lessac »**, dont le jeu de données a des conditions propres | ? | Utilisé pour la démo uniquement | Vérifier la licence lessac avant production, sinon basculer sur la voix TTS système Android |
| Piper en_US amy low | Jeu de données mimic3-voices (« See URL ») | ? | Démo uniquement | Vérifier sur github.com/MycroftAI/mimic3-voices |
| Piper fr_FR tom medium | **AGPLv3** | — | **Exclu** | — |
| Vosk small-fr-0.22 / small-en-us-0.15 | Apache-2.0 | **C** | Autorisé (ASR fr/en) | — |
| Vosk small-fr-pguyot-0.3 | CC-BY-NC-SA 4.0 | NC | Exclu | — |
| Sherpa-ONNX (moteur) | Apache-2.0 | **C** | Autorisé | — |
| Piper (moteur et dépôt de voix) | Dépôt MIT, **licence propre à chaque voix** | ? par voix | À vérifier voix par voix avant usage | Lire le MODEL_CARD de chaque voix fr_FR et en |
| Voix TTS système Android (fr, en) | Système | C | Autorisé | — |
| Mozilla Common Voice (ewo, dua, bas) | CC0 (licence habituelle de Common Voice, page non lisible ce jour) | C | Autorisé comme corpus de **vérification** orthographique | Reconfirmer sur le jeu de données |
| Engage Africa NLP (données) | Aucune licence publiée. Gratuit « pour la revitalisation », sur demande | **A** | Bloqué jusqu'à un accord | E-mail à info@engageafricanlp.com |
| Resulam (livres, applications) | Propriétaire | — | Exclu (référence orthographique seulement) | — |
| Google Cloud Translation | Propriétaire, payant au-delà du quota | Q | Exclu comme dépendance. Ne couvre de toute façon aucune des langues cibles | — |
| Phrases et blocs Mboa (notre code) | Notre propriété | C | Autorisé | Faire valider par des natifs |

## 3. Inventaire automatique des dépendances

Généré par `node tools/license-inventory.ts` dans `docs/THIRD_PARTY_LICENSES.md` (à relancer après chaque ajout de dépendance). Prévu pour les autres piles :
- **Dart/Flutter** : `flutter pub deps --json`, puis un script `tool/license_inventory.dart` qui lit le champ `license` de chaque paquet et produit `docs/THIRD_PARTY_LICENSES.md`.
- **Node/TypeScript (moteur et adaptateurs web/USSD)** : `npx license-checker-rseidelsohn --json --production`.
- **Python** (s'il y a un service de modèles) : `pip-licenses --format=markdown`.
- **Contrôle en intégration continue** : le build échoue si une dépendance porte une licence de la liste rouge (AGPL, GPL pour du code embarqué, CC-NC dans un build production) ou une licence inconnue.
- **Modèles** : chaque entrée du registre `language_registry.json` aura des champs `license`, `license_category`, `source_url` et `sha256`. Le build production refusera toute entrée NC ou « ? ».
