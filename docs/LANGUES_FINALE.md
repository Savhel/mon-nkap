# Langues et évaluation

| Langue | Démonstration sur le simulateur |
|---|---|
| Fulfulde de l’Adamaoua et pidgin camerounais | Expressions de la collecte, nombres reconnus par les packs et clips pour certaines réponses. Les ressources non relues restent signalées. |
| Ewondo et duala | Lexiques du projet et formes cardinales documentées. Les tests vérifient le montant et le bénéficiaire jusque dans le récapitulatif. |
| Basaa | Montants documentés dans une demande bancaire mixte. Les consignes et le récapitulatif sont en français. |
| Bulu | Mode mixte disponible, plus traduction expérimentale avec les deux paires Flagship chargées. |
| Ghomala’ et yemba | Ajoutés au sélecteur quand leurs deux directions Flagship sont chargées. Dialogue expérimental avec récapitulatif explicite. |
| Français et anglais | Parcours de référence. |

## Demandes testées par le moteur

Les exemples sont des demandes mixtes ou préparées à partir des lexiques du dépôt. Les transcriptions
et les tournures au sein d’une phrase complète doivent encore être évaluées par des locuteurs.

| Langue | Demande | Montant extrait |
|---|---|---:|
| Ewondo | lóm mɔ́nə bàkúdà bəbɛ à Marie | 2 000 FCFA |
| Duala | lóma mɔ́ni lokoli loba na bebwea betanu à Marie | 2 500 FCFA |
| Basaa / français | envoie hikóó à Marie | 1 000 FCFA |
| Bulu / français | envoie tɔ́jínì ébae à Marie | 2 000 FCFA |

Le parseur couvre une liste finie de formes et certaines additions explicitement documentées. Il
utilise les correspondances exactes après normalisation des diacritiques. Le montant reste soumis
au récapitulatif et à la confirmation. Lorsqu’un pack de collecte contient des nombres, sa grammaire
prend le relais pour cette langue.

- Ewondo, données de terrain d’Olivier Moussa Loumpata dans *Numeral Systems of the World's Languages*. [Formes attestées](https://lingweb.eva.mpg.de/channumerals/Ewondo.htm)
- Duala, tables pédagogiques Sawa et dictionnaire de Paul Helmlinger (*ikólí*, avec exemple composé). [Table Sawa](https://peuplesawa.com/fr/bnnews.php?nid=116&profil=0&seite=4&sites=0&vip=0), [dictionnaire](https://www.mboasawa.com/communaute/upload/files/2021/09/9zNbLuBrLEtdScZoSnYi_14_9b79902cb642a17db942bf39167e1ab3_file.pdf)
- Basaa, chapitre « Basaa » de Larry M. Hyman, § 3.4, dans *The Bantu Languages*. [Données linguistiques](https://s3-eu-west-1.amazonaws.com/s3-euw1-ap-pe-ws4-cws-documents.ri-prod/9781138799677/Bantu_Languages_Part_2.pdf)
- Bulu, données de terrain d’Étienne Zé Amvela, Université de Douala, dans *Numeral Systems of the World's Languages*. [Formes attestées](https://lingweb.eva.mpg.de/channumerals/Bulu-Bantu.htm)

## Transcrire avec le code de la langue

Le CTC Sherpa-ONNX reste le mode léger. Le serveur optionnel Meta Omnilingual LLM-ASR reçoit
`fub_Latn`, `ewo_Latn`, `dua_Latn`, `bas_Latn` ou `bum_Latn` selon la sélection.
En cas d’indisponibilité, l’application peut utiliser le CTC déjà chargé. Le mobile et le web
demandent toujours une relecture avant l’envoi du texte.

Sur la machine de démonstration, installer le paquet officiel `omnilingual-asr` dans un environnement
Python dédié d’après le guide Meta. Lancer `python services/asr_server.py` dans cet environnement,
puis démarrer Mon Nkap avec `CT_ASR_LLM_URL=http://127.0.0.1:8092`. Le service écoute uniquement en
local. Les modèles sont chargés à son démarrage. Meta annonce environ 6,1 Gio de poids et 5 Gio de
VRAM pour le modèle par défaut `omniASR_LLM_300M_v2`. Ces chiffres viennent de la fiche Meta et
restent à confirmer sur la machine de démo.
[Guide Meta](https://github.com/facebookresearch/omnilingual-asr/blob/main/src/omnilingual_asr/models/inference/README.md)

Comparer le texte de référence et la sortie du micro avec `CT_ALLOW_DRAFT=1 node tools/eval-voice.ts fub`
et `CT_ALLOW_DRAFT=1 node tools/eval-voice.ts wes`. Utiliser `--texte-seul` pour évaluer le moteur
sur les transcriptions du dépôt, sans modèle vocal. `--details` affiche aussi le résultat de chaque
fichier. Le rapport distingue l’intention, les montants, les bénéficiaires, les numéros et les
clarifications. Il signale les confirmations entendues à tort et les exécutions inattendues.
Les champs financiers ne sont mesurés que lorsqu’ils disposent d’une annotation explicite.

Les transcriptions de la collecte couvrent 41 demandes en fulfulde et 23 en pidgin. Avec les variantes
de la collecte activées et le même protocole de mesure, le fulfulde passe de 24 à 38 intentions exactes sur 41, et le pidgin de 20 à 23 sur 23. Les deux
formulations fulfulde d’acceptation « mi yidi yerbougo » laissent encore le récapitulatif en attente.
Le refus explicite « mi yida yerbougo » annule le brouillon. Les exemples servent aussi à affiner
le lexique. Pour mesurer la généralisation, préparer des phrases et des voix nouvelles.

Un numéro camerounais peut être dicté chiffre par chiffre en français ou en anglais camerounais
du parcours pidgin. Le parseur exige neuf chiffres (+237 facultatif). Une suite incomplète
n’est pas réutilisée comme montant.

## Traduire les réponses

Le dialogue traduit en bulu utilise les paires Flagship dans les deux sens. Dans une réponse qui
contient des valeurs, le moteur peut faire traduire une courte annonce sans données financières et
la juxtaposer au récapitulatif exact. L’annonce n’est affichée que si la vérification par aller-retour
l’accepte. La confirmation reste une action explicite. [Sources Flagship](https://huggingface.co/flagship-ai/cameroon-int8)

Les formes cardinales et le protocole vocal ont des tests locaux. Le test du protocole envoie de
l’audio réel à un fournisseur simulé pour vérifier le format et le code de langue. Les performances
du modèle conditionné et la qualité des annonces traduites restent à mesurer sur la machine de démo.

## Ajouter les contributions d’une langue

`npm run collecte -- bas bum` crée les feuilles à remplir pour le basaa et le bulu. Un relecteur
distinct peut ensuite valider les entrées. `npm run import-collecte -- bas bum` les rend disponibles
avec les packs. Les menus USSD utilisent aussi les libellés des packs validés. Pour les libellés
de menus, viser 17 caractères sur une seule ligne afin de tenir sur l’écran USSD.

## Collecte en ligne, sur invitation

La page `/collecte` permet à un locuteur natif d’écrire et d’enregistrer au micro, depuis son
téléphone, les demandes, réponses, explications, nombres et mots du catalogue. Elle n’est pas
ouverte à tous, pour éviter les fausses données :

1. L’administrateur (`/admin`, onglet « Collecte des natifs », serveur lancé avec `CT_ADMIN_KEY`)
   crée une invitation pour une langue. Le code (`XXXX-XXXX-XXXX`) n’est affiché qu’une fois ; seule
   son empreinte est gardée. Une invitation se révoque à tout moment.
2. Le natif ouvre `/collecte`, saisit son code et donne son accord. Aucun nom n’est enregistré :
   il apparaît sous un pseudonyme (`c-4f9a2b`).
3. Chaque envoi attend dans `data/collecte/<langue>/` (hors Git), audio compris (30 s au plus,
   vérifié au décodage). Le texte est gardé tel qu’écrit, tons compris.
4. L’administrateur écoute, puis accepte ou rejette. Accepter ajoute une ligne à la fin de
   `collecte/<langue>/<feuille>.csv` en brouillon (auteur = pseudonyme, sans relecteur) : elle ne
   devient validée qu’après la relecture d’un second natif. L’audio d’une demande acceptée rejoint
   `data/audio/<langue>/demandes/` et son `labels.csv`, pour `tools/eval-voice.ts`.

## Traductions automatiques non relues (28 novembre)

Pour que les écrans de la sandbox SAFINUM (mobile, web, guichet) et les réponses de conversation ne retombent pas sur le
français, des traductions **automatiques, non relues par un locuteur** comblent les manques, dans des fichiers séparés :
`data/ui/safinum-auto-<langue>.json`.

| Règle | Effet |
|---|---|
| Ordre | texte de natif, puis libellé Mboa, puis **automatique non relu**, puis français |
| Garde-fous | mêmes repères (`{name}`, `{montant}`…), aucun chiffre ajouté, longueur maximale respectée ; sinon le français |
| Montants | toujours insérés par le système, jamais écrits par la traduction |
| Traçabilité | comptés à part dans le journal (« automatiques non relus ») ; réponses de conversation marquées `quality: machine` |
| Désactivation | `CT_AUTO_TEXTS=0` |

Couverture des écrans (105 textes) : basaa, bulu, ghomala', medumba, haoussa, ewondo et duala sont couverts presque
entièrement par ces textes automatiques ; fulfulde et pidgin le sont par les natives (5 et 1 textes automatiques).
Chaque texte automatique doit être relu par un locuteur avant d'être considéré comme fiable.
