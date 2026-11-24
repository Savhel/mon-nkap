# Audit des ressources : Cameroun Translate (Étape 1)

*Audit réalisé le 23 novembre 2026. Chaque ligne s'appuie sur la page officielle de la ressource, lue ce jour-là. Quand une information n'a pas pu être vérifiée, la mention est **« non vérifié »**. Je n'ai rien déduit du simple fait qu'une langue soit africaine.*

## 0. Cap retenu et conséquence pour l'audit

Jordan a choisi le **moteur linguistique financier multicanal** : une API/SDK commune, branchée sur des adaptateurs mobile, web (Mboa) et USSD, puis SMS et IVR. Pour la finale SAFINUM, l'audit répond donc à trois questions :

1. Quelles langues peut-on défendre devant un jury composé de locuteurs natifs, sans erreur de sens sur un montant ?
2. Quels modèles peut-on utiliser légalement pour un **prototype de concours**, et lesquels pour un **déploiement auprès d'institutions financières**, qui est un usage commercial ?
3. Quelles briques vocales existent réellement pour le canal IVR ?

**Méthode de vérification**
- Hugging Face (fiches de modèles, API d'arborescence) et pages officielles, lues ce jour.
- La liste des codes NLLB-200 a été extraite du code source de `transformers` (`tokenization_nllb.py`, `FAIRSEQ_LANGUAGE_CODES`).
- Aucun modèle n'a pu être **téléchargé ni exécuté** depuis l'environnement d'audit, car le réseau bloque huggingface.co pour les téléchargements. Aucune qualité n'a donc été mesurée par nous : les chiffres cités sont ceux des auteurs.

---

## 1. Codes ISO des 20 langues du catalogue

| # | Langue | ISO 639-3 | Remarque |
|---|---|---|---|
| 1 | Ewondo | ewo | |
| 2 | Bulu | bum | |
| 3 | Eton | eto | |
| 4 | Bassa'a (Basaa) | bas | |
| 5 | Duala | dua | |
| 6 | Fulfulde (Adamaoua) | fub | NLLB ne propose que **fuv** (fulfulde du Nigeria), qui est une autre variété |
| 7 | Fe'efe'e / Nufi | fmp | |
| 8 | Ghomala' | bbj | |
| 9 | Medumba | byv | |
| 10 | Yemba | ybb | |
| 11 | Ngiemboon | nnh | Flagship l'écrit « ngienboum » |
| 12 | Bamoun (Shupamem) | bax | |
| 13 | Mungaka | mhk | |
| 14 | Awing | azo | |
| 15 | Nda'nda' | nnz | |
| 16 | Yambassa (Nugunu) | yas | **Attention : `yat` désigne le Yambeta, une autre langue.** Flagship a un dossier « nugunu » et un dossier « yambeta » distincts |
| 17 | Badwe'e | dialecte du Koonzime (ozm) | Le dossier Flagship « bidwee » est **à confirmer** : il peut s'agir du Bidjuki ou du Badwe'e |
| 18 | Bakaka | bqz | Flagship a « akoose » (bss), une langue voisine qui **ne remplace pas** le Bakaka |
| 19 | Cameroon Pidgin (Kamtok) | wes | Les modèles « pcm » portent sur le **pidgin du Nigeria**, une autre langue |
| 20 | Meta' | mgo | |

---

## 2. Modèles de traduction : tableau comparatif

| Ressource | URL officielle | Langues du catalogue couvertes (vérifiées) | Directions | Format / taille | Android | Qualité publiée | Licence | Usage commercial |
|---|---|---|---|---|---|---|---|---|
| **Flagship AI, Cameroon-INT8** (Flagship SARL, Lingo/NativeAI) | https://huggingface.co/flagship-ai/cameroon-int8 | ewo, bum, bbj, byv, ybb, nnh, azo, mgo, fub (« fufulde »), Nugunu (Yambassa), ozm (« koonzime »), « bidwee » (?). **Absentes :** eto, bas, dua, fmp, bax, mhk, nnz, bqz, wes | X→fr et fr→X pour chacune. Le pivot passe par le français, il n'y a pas de paire locale→locale ni de paire anglais direct. Une paire english↔francais existe | MarianMT converti en CTranslate2 int8. 119 dossiers pour un dépôt de 9,62 Go, soit environ 80 Mo par paire en moyenne (estimation : les tailles par fichier ne sont pas publiées) | CTranslate2 n'a pas de binding Android officiel. Il faudra un serveur, ou une conversion ONNX à tester | **Aucune métrique publiée.** Données d'entraînement non décrites. Le jeu de données « cameroon_bibles » du même éditeur suggère un domaine biblique (non vérifié) | **Contradiction :** la fiche du modèle dit **CC BY-NC 4.0** (« research and non-commercial use »), alors que le README de l'organisation dit « All released under CC-BY-4.0 » | **Non** tant que Flagship n'a pas clarifié par écrit. Prototype de concours : acceptable avec attribution |
| **OPUS-MT tc-bible-big deu_eng_fra_por_spa-bnt** (Helsinki-NLP) | https://huggingface.co/Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-bnt | Étiquettes cibles acceptées : ewo, bum, eto, bas, dua, ozm, bqz, yat (Yambeta). La liste « Target Language(s) » en prose ne cite que bas et ozm | **fr/en → langue uniquement.** Pas de sens inverse | Transformer-big, 0,2 milliard de paramètres, F32 safetensors (environ 900 Mo). Convertible CTranslate2 ou ONNX | Possible après conversion et quantification (à tester) | Aucun score pour ces langues. Entraîné sur la Bible, donc vocabulaire financier très probablement absent | **Apache-2.0** | **Oui** |
| **OPUS-MT tc-bible-big …-afa** | https://huggingface.co/Helsinki-NLP/opus-mt-tc-bible-big-deu_eng_fra_por_spa-afa | Aucune des 20 | | 0,2 milliard de paramètres | | | Apache-2.0 | |
| **NLLB-200** (Meta) | https://huggingface.co/docs/transformers/model_doc/nllb | Uniquement **fuv_Latn** (fulfulde du Nigeria, pas celui de l'Adamaoua). Aucune autre des 20 langues (vérifié dans la liste des codes) | Toutes directions entre ses 200 langues | 600M distillé, 1,3B et 3,3B. Formats PyTorch, CTranslate2 et ONNX disponibles via la communauté | Le 600M en int8 est faisable sur Android (lourd) | Scores FLORES-200 publiés par Meta | **CC BY-NC 4.0** (modèles) ; code MIT | **Non** |
| **Mimba, nllb200-ngiemboon2fr** | https://huggingface.co/mimba/nllb200-ngiemboon2fr | nnh | nnh → fr seulement | NLLB-600M affiné, F32 | Comme NLLB | « BLEU computed » mais **aucun chiffre publié** | CC BY-NC-SA 4.0 | Non |
| **Mimba, opus-mt-fra2ngiemboon** | (lien depuis https://huggingface.co/datasets/mimba/text2text) | nnh | fr → nnh | 74,7M | Oui (petit) | **BLEU 0,1, chrF 33,3** : quasi inutilisable | Étiquette Apache-2.0, mais entraîné sur des données CC BY-NC-SA. Accès sur conditions | Douteux |
| **NITHUB-AI marian-mt-bbc en↔pcm** | https://huggingface.co/NITHUB-AI/marian-mt-bbc-en-pcm | **Aucune**. Il s'agit du pidgin du Nigeria (pcm), pas du Kamtok (wes) | en↔pcm | MarianMT | Oui | « TBA ». Données en partie générées par GPT-3.5 | CC-BY-4.0 | Oui, mais **mauvaise langue** |
| **Enutrof marian-mt-pcm-en** | https://huggingface.co/Enutrof/marian-mt-pcm-en | Aucune (pcm) | pcm→en | MarianMT | Oui | BLEU 21,4 sur la Bible (dans le même domaine que l'entraînement) | MIT | Oui, mais mauvaise langue |
| **Google Translate** (ajouts 2024) | https://support.google.com/translate/answer/15139004 | « Fulani » seulement, variété non précisée. Pas d'ewondo, de duala, de bulu, de basaa ni de pidgin camerounais | | API Cloud | En ligne | | Propriétaire | API **payante** au-delà du quota, avec compte de facturation obligatoire. **Exclu** comme dépendance |
| **Lingo (lingo.cm)** | https://lingo.cm/blog | Traducteur web, « 56 languages on a free server » | | | | | Aucune API publique ni conditions publiées | À demander à Flagship |
| **Mboa, mémoire d'intentions et blocs** (notre dépôt) | https://github.com/PIO-VIA/Mboa | ewo, dua, fub, wes. 155 phrases financières par langue et 56 blocs | fr/en → langue | JS, quelques Ko | Oui (portable en Dart/Kotlin/serveur) | **0 des 620 lignes validées par un natif** dans `mboa/validation/*.csv` (colonnes statut et relecteur vides). 100 lignes ewondo, 37 duala et 13 pidgin sont signalées « À VÉRIFIER » | Notre code | Oui |

### Ce qu'il faut retenir
- **Aucune** ressource de traduction ouverte, utilisable commercialement **et** de qualité mesurée n'existe pour une langue camerounaise. L'Apache-2.0 d'OPUS-MT ne couvre qu'une direction, sur un corpus biblique.
- **Flagship** est la seule source qui couvre beaucoup de langues dans les deux sens. Sa licence est contradictoire et sa qualité n'est pas publiée. Il faut **écrire à Flagship** (via le contact lingo.cm) pour obtenir (a) la clarification de la licence et (b) une autorisation pour le concours puis pour le déploiement.
- Pour la finale, la traduction automatique libre n'est pas ce qui rapporte les points. Le jury vérifie l'exactitude des montants et des intentions, et une erreur de sens compte comme un défaut majeur. **La brique principale doit rester une mémoire de phrases financières validées par des natifs (l'approche Mboa)**. La traduction automatique (Flagship, OPUS) ne sert qu'en secours, avec un avertissement de qualité affiché.

---

## 3. Reconnaissance vocale (ASR)

| Ressource | URL | Langues du catalogue couvertes | Taille | Android | Qualité | Licence | Commercial |
|---|---|---|---|---|---|---|---|
| **Meta Omnilingual ASR** (CTC 300M int8, via Sherpa-ONNX) ✅ **retenu** | https://github.com/facebookresearch/omnilingual-asr · modèle : `github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12.tar.bz2` | **17 sur 20**, vérifié dans `lang_ids.py` : ewo, bum, eto, bas, dua, fub, fmp, bbj, byv, ybb, nnh, bax, mhk, yas, ozm, wes, mgo (et fr, en). **Absentes :** azo, nnz, bqz | 350 Mo (300M int8) ; 985 Mo (1B int8) | Oui (Sherpa-ONNX Android/Flutter), hors ligne | Taux d'erreur par caractère publiés par Meta pour le **modèle 7B** : wes 3,1 · mgo 3,1 · yas 3,1 · ybb 4,2 · mhk 4,6 · ozm 4,8 · fub 5,2 · dua 5,4 · bax 8,0 · bum 8,8 · nnh 9,2 · bas 9,7 · eto 15,1 · ewo 17,0 · bbj 17,7 · fmp 19,0 · byv 57,3. **Non mesuré par nous sur le 300M** : enregistrements natifs demandés à l'équipe. Testé en français (voix de synthèse) : 6/6 requêtes comprises | **Apache-2.0** | **Oui** |
| **Vosk** | https://alphacephei.com/vosk/models | **Aucune.** fr : `vosk-model-small-fr-0.22` (41 Mo). en : `vosk-model-small-en-us-0.15` (40 Mo) | Environ 50 Mo, environ 300 Mo de RAM | Oui (natif) | Correcte pour fr et en | **Apache-2.0** pour ces deux modèles. `small-fr-pguyot` est en CC-BY-NC-SA, à éviter | Oui |
| **Sherpa-ONNX** (moteur) | https://github.com/k2-fsa/sherpa-onnx | Moteur seulement : Zipformer, Paraformer, Whisper, Moonshine, SenseVoice, NeMo. Aucun modèle camerounais trouvé | | Oui (Android, iOS, Flutter) | | **Apache-2.0** | Oui |
| **Whisper** (OpenAI) | (non lu ce jour) | fr et en. Aucune langue camerounaise dans la liste de Whisper (non vérifié ce jour, à confirmer) | tiny 151 Mo, small 967 Mo | Via Sherpa-ONNX ou whisper.cpp | | MIT | Oui |
| **MMS-1B-all** (Meta) | https://huggingface.co/docs/transformers/main/en/model_doc/mms | 1 162 langues annoncées. **Couverture des 20 langues non vérifiée** : la liste officielle (dl.fbaipublicfiles.com) bloque les robots. À vérifier avec `processor.tokenizer.vocab.keys()` | Environ 1 milliard de paramètres, environ 4 Go | Trop lourd pour un téléphone. Possible côté serveur pour l'IVR | Non mesurée | **CC BY-NC 4.0** | Non |
| **WAXAL-NET** | https://huggingface.co/papers/2606.02375 | 19 langues africaines, **aucune camerounaise** citée (« Fula » sans précision de variété) | 151 Mo à 1,2 Go | « Edge » annoncé | Taux d'erreur moyen d'environ 38 % | Données CC-BY-4.0. Licence des poids non trouvée | ? |
| **ASR Basaa** (arXiv 2609.32408) | https://arxiv.org/pdf/2609.32408 | bas (taux d'erreur 14,1 %) | XLS-R-300M | | | **Poids non publiés** | Inutilisable |
| **Mozilla Common Voice** (jeux de données) | https://datacollective.mozillafoundation.org | Ewondo, Duala, Basaa (jeux de données audio et texte, sans modèle) | | | | CC0 (licence habituelle de Common Voice, page illisible ce jour) | Corpus de **vérification** orthographique (déjà utilisé par Mboa), pas un modèle |

**Conclusion ASR (mise à jour du 23/11, 22 h)** : **Meta Omnilingual ASR (Apache-2.0)** couvre 17 des 20 langues, tourne hors ligne et a été intégré au moteur. Sa précision sur nos langues avec le petit modèle reste **à mesurer sur de vrais locuteurs**. MMS-1B-all (CC BY-NC) ne couvre que bas, ybb et mgo et n'est plus nécessaire.

---

## 4. Synthèse vocale (TTS)

| Ressource | URL | Langues du catalogue (vérifiées) | Android | Licence | Commercial |
|---|---|---|---|---|---|
| **MMS-TTS** (Meta, VITS) | https://huggingface.co/facebook/mms-tts | D'après la liste de la fiche du modèle : **ybb (Yemba), mgo (Meta'), ozm (Koonzime), yat (Yambeta, pas le Yambassa)**, ainsi que pcm (pidgin du Nigeria), fra et eng. **Absentes :** ewo, bum, eto, bas, dua, fub, fmp, bbj, byv, nnh, bax, mhk, azo, nnz, bqz, wes | Oui : VITS se convertit en ONNX et Sherpa-ONNX le prend en charge (conversion à tester) | **CC BY-NC 4.0** | Non |
| **Piper** (rhasspy) | https://huggingface.co/rhasspy/piper-voices | fr_FR (gilles, mls, mls_1840, siwis, tom, upmc) et en. Aucune langue camerounaise | Oui (Sherpa-ONNX) | Dépôt MIT, mais **chaque voix a sa propre licence** dans son MODEL_CARD, à vérifier voix par voix | Selon la voix |
| **Voix Android natives** (TTS système) | | fr, en | Oui | Système | Oui |
| **Enregistrements natifs** (Studio Mboa) | notre dépôt | Celles que nous enregistrons | Oui | Les nôtres, avec le consentement des locuteurs | Oui |

**Conclusion TTS** : il n'existe pas de vraie voix de synthèse pour l'ewondo, le duala, le fulfulde ou le pidgin camerounais. Pour l'IVR et la lecture à voix haute dans ces langues, il faut des **messages audio pré-enregistrés par des natifs**, avec des gabarits (« Votre solde est de » suivi du montant lu en français) **clairement signalés**. Nous ne lirons jamais une langue camerounaise avec une voix française.

---

## 5. Dictionnaires et ressources linguistiques

| Ressource | URL | Langues | Contenu | Licence / conditions | Utilisable ? |
|---|---|---|---|---|---|
| **Engage Africa NLP** (programme de Localizzz Africa, Douala) | https://engageafricanlp.com | Collecte annoncée pour : ghomala', fulfulde, ewondo, duala, bassa'a, bulu, fe'efe'e, medumba, yemba, bamoun, ngiemboon, meta', pidgin, etc. | Application de collecte de texte et de voix. API « Coming SOON » | Extraction des données **gratuite pour les projets de revitalisation**, sur demande à info@engageafricanlp.com. **Aucune licence publiée** | À demander par écrit |
| **Localizzz Africa** | https://localizzzafrica.com | Pidgin CM, ghomala', etc. | Société commerciale : traduction, collecte, annotation | Prestations payantes | Possible pour **faire relire** nos phrases par des natifs |
| **Resulam** (association) | https://resulam.com | nufi, medumba, ngiemba, mungaka, bamoun, ghomala', duala, basaa, ewondo | Livres (vendus), applications, clavier Clafrica | **Aucune licence ouverte** : contenu protégé | Non réutilisable sans accord. Le clavier sert de référence orthographique |
| **Mimba text2text** (jeu de données) | https://huggingface.co/datasets/mimba/text2text | nnh↔fr (40 968 paires) | Corpus parallèle | CC BY-NC-SA 4.0, accès sur conditions | Non commercial |
| **Flagship cameroon_bibles / ghomala-spoken-bible** | (via le README de flagship-ai) | 59 langues (Bible) ; environ 20 h d'audio ghomala' | Corpus | README : CC-BY-4.0 (non vérifié sur les fiches) | À vérifier |

---

## 6. Synthèse par langue (statut réel au 23/11/2026)

Légende : ✅ ressource vérifiée et réutilisable · ⚠️ ressource existante, mais licence non commerciale, qualité inconnue ou une seule direction · ❌ rien trouvé

| Langue | Texte fr→langue | Texte langue→fr | Anglais | ASR | TTS | Phrases financières (Mboa) |
|---|---|---|---|---|---|---|
| Ewondo | ⚠️ Flagship (NC) ; ⚠️ OPUS (Apache, Bible) | ⚠️ Flagship (NC) | pivot fr | ⚠️ Omnilingual (CER 17 %) | ❌ | ⚠️ 155 phrases, non validées |
| Bulu | ⚠️ Flagship ; ⚠️ OPUS | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 8,8 %) | ❌ | ❌ |
| Eton | ⚠️ OPUS seul | ❌ | | ⚠️ Omnilingual (CER 15,1 %) | ❌ | ❌ |
| Bassa'a | ⚠️ OPUS seul | ❌ | | ⚠️ Omnilingual (CER 9,7 %) | ❌ | ❌ |
| Duala | ⚠️ OPUS seul | ❌ | | ⚠️ Omnilingual (CER 5,4 %) | ❌ | ⚠️ 155 phrases, non validées |
| Fulfulde (fub) | ⚠️ Flagship (variété à confirmer) | ⚠️ Flagship | ⚠️ NLLB fuv (autre variété, NC) | ⚠️ Omnilingual (CER 5,2 %) | ❌ | ⚠️ 155 phrases, non validées |
| Fe'efe'e | ❌ | ❌ | | ⚠️ Omnilingual (CER 19 %) | ❌ | ❌ |
| Ghomala' | ⚠️ Flagship | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 17,7 %) | ❌ | ❌ |
| Medumba | ⚠️ Flagship | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 57,3 %) | ❌ | ❌ |
| Yemba | ⚠️ Flagship | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 4,2 %) | ⚠️ MMS-TTS (NC) | ❌ |
| Ngiemboon | ⚠️ Flagship ; ⚠️ Mimba (BLEU 0,1) | ⚠️ Flagship ; ⚠️ Mimba (NC-SA) | pivot | ⚠️ Omnilingual (CER 9,2 %) | ❌ | ❌ |
| Bamoun | ❌ | ❌ | | ⚠️ Omnilingual (CER 8,0 %) | ❌ | ❌ |
| Mungaka | ❌ | ❌ | | ⚠️ Omnilingual (CER 4,6 %) | ❌ | ❌ |
| Awing | ⚠️ Flagship | ⚠️ Flagship | pivot | ❌ | ❌ | ❌ |
| Nda'nda' | ❌ | ❌ | | ❌ | ❌ | ❌ |
| Yambassa (Nugunu) | ⚠️ Flagship (« nugunu », à confirmer) | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 3,1 %) | ❌ | ❌ |
| Badwe'e | ⚠️ Flagship koonzime/« bidwee » (à confirmer) ; ⚠️ OPUS ozm | ⚠️ Flagship | | ⚠️ Omnilingual (CER 4,8 %) | ⚠️ MMS-TTS ozm (NC) | ❌ |
| Bakaka | ⚠️ OPUS seul | ❌ | | ❌ | ❌ | ❌ |
| Cameroon Pidgin | ❌ (les modèles pcm portent sur le pidgin nigérian) | ❌ | ❌ | ⚠️ Omnilingual (CER 3,1 %) | ❌ (MMS pcm = Nigeria) | ⚠️ 155 phrases, non validées |
| Meta' | ⚠️ Flagship | ⚠️ Flagship | pivot | ⚠️ Omnilingual (CER 3,1 %) | ⚠️ MMS-TTS (NC) | ❌ |

**Bilan** : 0 langue ✅ en traduction, 11 langues ⚠️ dans les deux sens via Flagship (dont Yambassa et Badwe'e restent à confirmer), 4 langues ⚠️ dans un seul sens (eton, bassa'a, duala, bakaka, via OPUS), 5 langues ❌ (fe'efe'e, bamoun, mungaka, nda'nda', pidgin camerounais). 17 langues ont une ASR Apache-2.0 (Omnilingual), précision à mesurer sur notre modèle. Trois langues ont une TTS sous licence non commerciale.

---

## 7. Recommandation pour la finale

1. **Langues de démonstration** : **Ewondo** (vérifié dans le plus de sources et déjà dans Mboa), puis **Fulfulde** et **Duala**. Le **Pidgin camerounais** reste possible avec nos propres phrases validées, sans aucun modèle externe. Il vaut mieux 2 à 4 langues irréprochables que 20 langues approximatives.
2. **Urgence n°1 : faire valider les phrases par des locuteurs natifs.** Aujourd'hui, 0 des 620 lignes sont validées, alors que le README de Mboa affiche « Relu et validé ». C'est probablement là que des points ont été perdus en présélection. Le CSV et le guide de validation existent déjà : il manque les relecteurs (piste : Localizzz Africa ou Engage Africa NLP).
3. **Écrire à Flagship et à Engage Africa NLP cette semaine** pour clarifier la licence, demander l'autorisation d'usage pour le concours et accéder aux données.
4. **Architecture du moteur** : intention et paramètres d'abord, avec des gabarits validés. La traduction automatique ne sert qu'en secours, et toujours avec un avertissement.
5. **Voix (IVR)** : messages audio natifs pré-enregistrés, plus le clavier (DTMF), plus ASR et TTS fr/en (Vosk, Piper ou voix Android). Aucune fausse prononciation.
