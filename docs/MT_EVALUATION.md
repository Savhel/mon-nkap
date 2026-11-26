# Évaluation des modèles de traduction Flagship (cameroon-int8)

*Test réalisé le 24/11/2026 vers 0 h 45 (heure de Douala). Modèles `flagship-ai/cameroon-int8` (révision du 4 juin 2026), CTranslate2 4.9.1 en int8 sur CPU, recherche en faisceau de taille 4. Les sorties ci-dessous sont **brutes, non retouchées**.*

## Méthode
1. Sept phrases bancaires françaises sont traduites vers la langue, puis la traduction est retraduite en français (aller-retour).
2. Les 8 libellés de Mboa (écrits par l'équipe) sont traduits de la langue vers le français.
3. On teste des phrases courtes, et un montant écrit en chiffres.

## Résultat en une phrase
Les modèles ont été entraînés sur la **Bible**. Sur du vocabulaire bancaire, ils produisent des phrases religieuses sans rapport (« Heureux les enfants ! », « l'Evangile »), répètent des mots en boucle et **perdent les montants** (« 150 000 francs » devient une phrase sans nombre ; « 5 000 » devient « ujineere ujineere… »). Seule exception : « Je veux envoyer de l'argent à Paul » fait correctement l'aller-retour en fulfulde, bulu et ghomala'. C'est une phrase très proche du style biblique.

## Conséquence pour Mon Nkap
- **Interdit** pour générer seul une réponse contenant un montant, des frais ou un avertissement : le brief de la finale classe ces erreurs comme des défauts majeurs.
- **Utilisable sous garde** pour des phrases courtes sans chiffres : le résultat n'est affiché que si l'aller-retour redonne le sens d'origine, et il est marqué « traduction automatique ».
- Licence : la fiche du dépôt indique CC BY-NC 4.0, mais les README par paire indiquent `license: cc-by-4.0`. La contradiction reste à lever avec Flagship.

## Sorties brutes : français → langue → français
```
== fr -> ewondo -> fr (1013 ms pour 7 phrases x2)
  Votre solde est de 150 000 francs.
    ewondo: E mam ma mënë mibëlë mina mibëlë mibè.
    retour: Ces choses sont vous-mêmes, vous aussi, vous-mêmes.
  Je veux envoyer de l'argent à Paul.
    ewondo: Mayi na mayi lom mòni▁abë Paulus.
    retour: Je veux que je▁souffre l'argent de Paul.
  Combien coûtent les frais ?
    ewondo: Eyë mam mësë ya?
    retour: Qu'est-ce que tout ce qu'il y a?
  Le transfert a réussi.
    ewondo: Ndò mvulna angakòbò.
    retour: Et le paralytique parlait.
  Solde insuffisant.
    ewondo: Mbëmbë mbëmbë foe.
    retour: La bonté de l'Evangile.
  Voulez-vous confirmer ?
    ewondo: Yë miayi tsig ntol?
    retour: Est-ce que vous êtes▁jugés?
  Bonjour, comment allez-vous ?
    ewondo: Mina, eyë miakë ya?
    retour: Vous, comment allez-vous?
== fr -> fufulde -> fr (1154 ms pour 7 phrases x2)
  Votre solde est de 150 000 francs.
    fufulde: Ɓooyma, nden kam mi ɗon winndana limgal duuɓi cappanɗe cappanɗe ngeendam.
    retour: Mais maintenant j'écris le nombre de cinq▁mille années de vie.
  Je veux envoyer de l'argent à Paul.
    fufulde: Mi yiɗi nelugo ceede haa Pol.
    retour: Je veux▁envoyer l'argent à Paul.
  Combien coûtent les frais ?
    fufulde: Ɗume ɗuuɗɗum coottaari na?
    retour: Qu'est-ce qui sera accompli?
  Le transfert a réussi.
    fufulde: Yimɓe njahri nastugo.
    retour: Et ils s'embarquèrent pour entrer.
  Solde insuffisant.
    fufulde: Onon soorraaɓe naafikaare nde'e.
    retour: Vous qui êtes sauvés, ces choses sont mauvais.
  Voulez-vous confirmer ?
    fufulde: On ngiɗi gooŋga?
    retour: Vous voulez la vérité?
  Bonjour, comment allez-vous ?
    fufulde: Koo moy maajum, noy on ɗon njahata?
    retour: Qui d'entre les hommes, comment allez-vous?
== fr -> bulu -> fr (1378 ms pour 7 phrases x2)
  Votre solde est de 150 000 francs.
    bulu: E mfaʼa wônan, mfaʼa wônan, mfaʼa wônan, mfaʼa wônan, mfaʼa wônan, mfaʼa wônan.
    retour: Pour vous, pour vous, pour vous, pour vous, pour vous, pour vous, pour vous.
  Je veux envoyer de l'argent à Paul.
    bulu: Ma kômbô lôme moné be Paul.
    retour: Je veux▁envoyer l'argent à Paul.
  Combien coûtent les frais ?
    bulu: Jé mia ye boban aya?
    retour: Que ferez-vous donc?
  Le transfert a réussi.
    bulu: Mbôlô nkôman▁ô nga boban.
    retour: Or il y avait eu un désir de voleur.
  Solde insuffisant.
    bulu: Awôʼô mbômaʼane menan▁ô nji bo.
    retour: En effet, il n'y a pas de rendre témoignage.
  Voulez-vous confirmer ?
    bulu: Ye mia kômbô tyiñe yemelan?
    retour: Veux-tu être reconnus?
  Bonjour, comment allez-vous ?
    bulu: Mbôlô, mia ye bo aya?
    retour: Que ferez-vous, en effet?
== fr -> ghomala -> fr (1115 ms pour 7 phrases x2)
  Votre solde est de 150 000 francs.
    ghomala: Ywə yə o gɔ tsə a mcwəpuŋ a mcwəpuŋ.
    retour: Ce que tu dois bien, c'est le mal.
  Je veux envoyer de l'argent à Paul.
    ghomala: Gɑ̌ wə shəŋ nthəm ŋkhap bi Polo.
    retour: Je veux▁envoyer de l'argent à Paul.
  Combien coûtent les frais ?
    ghomala: A shyə m pa' a bɑ a cəŋtə ŋkhəm a?
    retour: C'est à cause de▁cela que je suis arrivé jusqu'à moi?
  Le transfert a réussi.
    ghomala: Tsə tsyə a bɑ ǎ ku'nyə a.
    retour: Et le nom qui est▁aimé est agréable.
  Solde insuffisant.
    ghomala: Sɔ' m nə ywə yə a bɑ ǎ cyə a.
    retour: Quant à ce qui est▁passé,
  Voulez-vous confirmer ?
    ghomala: Po piŋ shəŋ nə ŋkwinthɛ̌ a?
    retour: Vous cherchez donc à en rendre témoignage?
  Bonjour, comment allez-vous ?
    ghomala: ▁Ghɔm guŋ mcwə awɛ, po nəŋ bɑ́ gɑ́ kɑ?
    retour: Et vous, vous avez toujours la parole, et quel est▁cela?
== fr -> yemba -> fr (3008 ms pour 7 phrases x2)
  Votre solde est de 150 000 francs.
    yemba: Pɛ ezéŋ ŋgwɛ̄ ajū mīi, mɛ́ lɔkɔ ntswɛ́tɛ ajū mīi, mɛ́ lɔkɔ ntswɛ́tɛ ajū mīi, mɛ́ lɔkɔ ntswɛ́tɛ.
    retour: afin que vous▁soyez appelés à l'amour de l'amour.
  Je veux envoyer de l'argent à Paul.
    yemba: Meŋ▁á si ŋkɔ̄ŋɔ▁á mbū Pɔ́ɔl.
    retour: Je l'ai fait à Paul.
  Combien coûtent les frais ?
    yemba: Awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ awíɛ?
    retour: Ou bien, qui est-ce, qui est-ce, qui est-ce?
  Le transfert a réussi.
    yemba: Ŋ́gɔ́ éyi, afʉʼ zīi mɛ́ gɔ le lɔ̄k nzwíʼtɛ▁á mbū Ndém, a le lɔ̄k nzwíʼtɛ▁á mbū yí.
    retour: C'est là qu'il a été ressuscité de Dieu.
  Solde insuffisant.
    yemba: Ajū mīi a▁á si ŋgɔ́▁á ŋiŋ yīi, a▁á si ŋgɔ́▁á ŋiŋ yīi, a▁á si ŋgɔ́▁á ŋiŋ yīi, a▁á si ŋkɔ̄ŋɔ.
    retour: Celui qui est▁celui qui est▁celui qui est▁celui qui est▁celui qui est.
  Voulez-vous confirmer ?
    yemba: Pɛ ké mbiŋ ŋgɔ́ éyi, pɛ é si ŋkɔ̄ŋɔ ŋ́gɛ, ŋ́gɔ́ éyi, pɛ é si ŋkɔ̄ŋɔ ŋ́gɛ, pɛ é si ŋkɔ̄ŋɔ ŋ́gɛ akɔ̄?
    retour: Vous êtes-vous donc capables de▁faire connaître l'Evangile?
  Bonjour, comment allez-vous ?
    yemba: Ajʉʼ mɛ́t, mbɔ pɛ é si nzɛ́ttɛ ŋ́gɛ, pɛ é si ŋkɔ̄ŋɔ ŋ́gɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á légɛ, pɛ ezhɛ́▁á lég
    retour: C'est pourquoi vous▁savez que vous▁savez que vous croyez que vous croyez que vous croyez que vous croyez que vous croyez que c'est vous qui croyez.
```

## Sorties brutes : libellés Mboa (langue → français) et phrases courtes
```
== ewondo -> fr (phrases Mboa)
  Solde disponible  |  Mɔ́nə ó nə́ a kɔ́ntə  =>  Heureux ce qu'il y a de plus en plus de temps, qu'il y ait de plus en plus de temps.
  Effectuer un transfert  |  Lóm mɔ́nə  =>  Heureux les enfants!
  Consulter les frais  |  Yěn frais  =>  Et il y avait un autre frère, un autre, un autre, un autre, un autre, un autre, un autre, un autre, un autre, un autre, un autre, un autre.
  Solde insuffisant pour effectuer ce transfert.  |  Mɔ́nə wɔ́ mə ayi kɔ́ŋ amú lóm ya.  =>  Quelques-uns de ces hommes s'enfuiront à l'égard.
  Votre transfert a été envoyé avec succès.  |  Mɔ́nə wɔ́ mə mana kə̌ mvaé.  =>  "Il y a un autre, un autre, un autre, un autre.
  Confirmer le transfert  |  Confirmer lóm mɔ́nə  =>  Conduiseur de leurs enfants
  Historique  |  Mɔ́nə ó ńlóm ńtié  =>  Heureux cœur de l'Esprit-Saint!
  Ne partagez jamais votre code PIN.  |  Ó kat ki mod code PIN wɔ́ — tegə́ mbú ńsɛ̌.  =>  "Il n'y a point de personne qui peut être guérie; il n'y a point de personne qui peut être guérie."
== fufulde -> fr (phrases Mboa)
  Solde disponible  |  Ceede ɗe mbaawɗaa huutoraade  =>  Ils n'ont pas le pouvoir d'aller jusqu'à ce jour-là.
  Effectuer un transfert  |  Neldu ceede  =>  Ayez donc part à l'argent de l'argent.
  Consulter les frais  |  Ƴeew njoɓdi  =>  "Il y avait des vents dans le sanctuaire et des vents dans le sanctuaire."
  Solde insuffisant pour effectuer ce transfert.  |  Ceede maa heewaani ngam nelde ndee.  =>  Et votre témoignage fut rempli pour l'enverrement.
  Votre transfert a été envoyé avec succès.  |  Ceede maa nelaama boɗɗum.  =>  Et votre témoignage sera▁envoyé.
  Confirmer le transfert  |  Tabbitin nelde  =>  Tablier l'Enfant
  Historique  |  Golle ɓennuɗe  =>  Les enfants de cette génération sont dans leurs cœurs, et ils sont dans leurs cœurs, et ils sont dans leurs cœurs, et ils sont dans leurs cœurs, et ils sont dans leurs cœurs.
  Ne partagez jamais votre code PIN.  |  Wata hollu mo’o fuu kod PIN maa — abada.  =>  Quand tout▁celui qui aura été appelé de lui-même sera sauvé, qu'il sera éloigné de lui, qu'il sera éloigné de lui, qu'il sera éloigné de lui.
== placeholders/short fr -> ewondo ['Miayi kë lom Paulus efunga.', 'Miayi lom efaè ya YY.', 'Ndò bëngalom mòni, asu yë na bëwoe mòni.', 'Mvòm mvòm woe', 'Ndò mam mëte mëte mëte mënë mëkyëbë, asu yë na mëkyëbë, asu yë na mëkyëbë.', 'Owe', 'Ndò hm ki na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na: Asu yë na:']
== placeholders/short fr -> fufulde ['On ngaddan deftere ujineere ujineere ujineere ujineere haa Pol.', "On neldan ko fotti'en Roma haa YY.", "Sooje'en ceede cardi, ɓe ɗon ndokki ceede, ɓe ɗon ndokki ceede.", 'Ndaa ceede mooɗon ceede mooɗon', 'Yiɗaaɓe Allah, kanjum woni Allah.', " ⁇ Ooho, o wi'i:  ⁇ Ooho, o wi'i:", 'Ngam maajum, naa non sam.']
== requête ewondo ->fr [('Ma yi lom mone a Paul', 'Et moi, je suis dans Paul, et je suis dans Paul, et je suis dans Paul.'), ('Mone wom ane ya?', '"Qu\'est-ce que votre œil?"')]
== requête fufulde ->fr [('Mi yiɗi nelugo ceede haa Pol', 'Et je veux▁envoyer le prix à Paul.'), ('Ceede am njelu?', 'Quelle est mon témoignage?')]
```

## Comparaison des moteurs (24/11/2026) : Flagship, OPUS-MT

Mesure reproductible : `npm run mt:compare` (`data/eval/mt-compare.json`). Pour chaque langue et chaque moteur, les
20 réponses et définitions du service sans chiffre font l'aller-retour français → langue → français. Une traduction
est **acceptée** seulement si : l'aller-retour est fidèle (≥ 0,6), aucun chiffre n'est inventé, pas de boucle, pas de
vocabulaire religieux absent de l'original, **et la langue produite est bien la langue demandée** (vérifiée par
l'identification de langue apprise sur Common Voice ; refusée si la langue n'est pas vérifiable pour un modèle
multilingue).

| Langue | Moteur | Fidélité moyenne | Acceptées |
|---|---|---|---|
| Fulfulde | Flagship | 0,27 | **15 %** |
| Ewondo | Flagship / OPUS | 0,09 / 0,30 | 0 % / 0 % |
| Duala | OPUS | 0,28 | 0 % |
| Bulu | Flagship / OPUS | 0,16 / 0,26 | 0 % / 0 % |
| Ghomala', Yemba | Flagship | 0,14 / 0,03 | 0 % |
| Basaa, Eton, Koonzime, Bakaka | OPUS | 0,11 / 0,28 / 0,02 / 0,23 | 0 % |

**Pourquoi la vérification de la langue est indispensable.** Sans elle, OPUS « réussissait » 15 % des allers-retours en
duala et 10 % en ewondo. Mais ce qu'il écrit n'est pas du duala : il produit une autre langue bantoue qu'il sait
retraduire. Sortie brute pour « Je veux envoyer de l'argent à Paul. » demandé en duala :
`Komme mme, ha, ke nyishaho polelo ya Paulo yokuza, mme Paulo yena aza kandi kandi kandi andi.` ; pour « Opération
annulée. Aucun argent n'a été envoyé. » : `Bahati. ❤️`.

**Compréhension (langue → français)**, sur les libellés Mboa dont le sens est connu (brouillons, indicatif) :
« Lóma mɔ́ni » (duala, *envoyer de l'argent*) → OPUS `Romain d'aujourd'hui` ; « Mɔ́nə ó nə́ a kɔ́ntə » (ewondo, *solde*)
→ OPUS `Et il les fit retirer de devant le siège judicial.`, Flagship `Heureux ce qu'il y a de plus grand dans le
sépulcre,`. Une telle sortie peut faire croire à un retrait : OPUS n'est donc routé pour **aucune** langue.

**Décision** : le service de traduction est obligatoire et toujours démarré ; Flagship reste la route pour l'ewondo,
le fulfulde, le bulu, le ghomala' et le yemba (comprendre une demande, proposer une réponse sous garde) ; OPUS reste
installé pour de futures mesures. Pour le duala et l'ewondo, la qualité vient des phrases des natifs (packs de langue).

## Ajout de MADLAD-400 3B (24/11/2026)

MADLAD-400 (Google, Apache-2.0, 492 langues) ne connaît, parmi nos langues, que le **basaa** (`<2bas>`), le **bulu**
(`<2bum>`) et le **peul générique** (`<2ff>`) — ni le duala, ni l'ewondo, ni le pidgin, ni le ghomala', ni le yemba
(vérifié dans son vocabulaire). Mesure avec la même méthode :

| Langue | Flagship | OPUS | MADLAD |
|---|---|---|---|
| Fulfulde | **15 % acceptées** (fidélité 0,27) | — | 0 % (0,24) |
| Basaa | — | 0 % (0,11) | 0 % (0,31) |
| Bulu | 0 % (0,16) | 0 % (0,26) | 0 % (0,19) |

Exemples bruts : basaa « Je veux envoyer de l'argent à Paul. » → `A yé a yé a yé a yé a yé a yé a yé.` ; « Quel est
mon solde ? » → `Ki le mon solde ?` (copie du français, d'où une « fidélité » trompeuse) ; bulu → `Me ye'ele Paul na,
me ye'ele nye mveane Zambe.` (retour : « je suis le don de Dieu ») ; peul → `Mi yiɗi mi jaɓa Paul ceede.` (retour :
« Je voulais accepter Paul pour de l'argent »). Environ 2 s par phrase sur processeur, contre 0,2 s pour Flagship.

**Décision** : MADLAD reste installé (chargé seulement à la demande) mais n'est routé pour aucune langue.
Dès que les natifs auront fourni des phrases en basaa ou en bulu, l'identification de langue pourra vérifier ses
sorties et la comparaison (`npm run mt:compare`) sera relancée.

## Ghomala' : compréhension par la traduction (sonde du 26 novembre 2026)

Le ghomala' fait partie du bac à sable SAFINUM et le modèle Flagship ghomala ↔ français est installé. Aucune phrase de
natif n'existe pour le mesurer : la sonde a donc fait traduire 10 demandes françaises en ghomala' par le modèle, puis
retraduire en français, et passé le résultat au moteur. Ce n'est pas une mesure de qualité, seulement un test du circuit.

| Demande française | Retour en français | Compris |
|---|---|---|
| envoie de l'argent à Marie | « et a envoyé l'argent à Marie » | transfert |
| je veux payer ma facture d'électricité | « Je veux, moi aussi, parce que je suis dans les cieux. » | — |
| je veux retirer de l'argent | « je veux être là un argent fort. » | — |
| oui | « Oui, je veux aussi. » | oui |
| **annule** | « Car il est prière de dire : » | **transfert** |

Une demande sur sept comprise, sorties de style biblique, et « annule » pris pour un transfert.

**Décision** : le ghomala' n'est **pas** activé (compréhension « indisponible ») : une langue qui comprend « annuler »
comme « envoyer de l'argent » serait un défaut majeur. Il faut des phrases de natifs.
