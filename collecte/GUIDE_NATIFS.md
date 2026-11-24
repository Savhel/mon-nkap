# Guide pour les locuteurs natifs

Merci de nous aider. Grâce à vous, une personne qui parle votre langue pourra demander son solde, envoyer
de l'argent ou payer une facture **dans sa langue**, sur son téléphone, sur internet ou par USSD.

Il n'y a pas de bonne ou de mauvaise réponse, sauf une : **écrivez comme vous parlez vraiment**, pas comme
dans un livre et pas en traduisant le français mot à mot.

## Avant de commencer

- Vous recevez un dossier à votre langue (par exemple `dua/` pour le duala) avec cinq tableurs. Ouvrez-les
  avec Excel, LibreOffice ou Google Sheets.
- Dans chaque tableur, remplissez la colonne **auteur** avec votre prénom et votre nom.
- Écrivez votre langue avec l'orthographe que vous utilisez d'habitude. Si vous hésitez entre deux
  écritures, mettez l'autre dans la colonne **commentaire**.
- Si les gens disent souvent un mot en français au milieu de la phrase (par exemple « facture »), **gardez-le** :
  c'est comme cela que les vrais utilisateurs parleront.

## Les cinq tableurs, dans l'ordre

| Tableur | Ce que vous faites | Durée |
|---|---|---|
| `nombres.csv` | Pour chaque montant (1, 2… 5 000, 25 000, 150 000…), écrivez comment on le **dit** dans votre langue. Si on dit d'habitude le montant en français, écrivez-le aussi dans « autre_facon ». | 30 min |
| `lexique.csv` | Pour chaque mot (argent, solde, envoyer, oui, non, annuler…), écrivez le mot ou l'expression, et les autres façons de le dire dans « variantes », séparées par « / ». | 20 min |
| `demandes.csv` | **Le plus important.** Chaque ligne décrit une situation (« Vous voulez envoyer 5 000 FCFA à Marie »). Écrivez la phrase que **vous** diriez. Trois lignes par situation : si deux personnes l'écrivent différemment, c'est encore mieux. Ajoutez des lignes si vous voulez. | 45 min |
| `reponses.csv` | Ce que le service répond. Réécrivez chaque phrase naturellement dans votre langue. **Gardez exactement les repères entre accolades** comme `{montant}` ou `{nom}` : le système y mettra le vrai montant. | 45 min |
| `definitions.csv` | Expliquez simplement, comme à un parent, ce que veulent dire « frais », « solde », « bénéficiaire »… | 30 min |

## La relecture (obligatoire)

Une ligne n'est utilisée que si **une deuxième personne**, qui parle aussi la langue, l'a relue :

1. Elle écrit son nom dans la colonne **relecteur** (jamais le même nom que l'auteur).
2. Dans **statut**, elle écrit `valide` si la phrase est correcte et naturelle, ou `a_revoir` sinon, avec
   la raison dans **commentaire**.

Faites particulièrement attention aux **montants**, aux **frais** et aux **avertissements** : une erreur sur
ces phrases peut faire perdre de l'argent à quelqu'un.

## Ce qu'on ne vous demandera jamais

- Inventer une phrase que personne ne dit.
- Donner des informations personnelles : les noms (Marie, Paul, Aminatou) et les numéros sont fictifs.

## Accord d'utilisation

En remplissant ces tableurs, vous acceptez que vos phrases soient utilisées par l'équipe pour le
SAFINUM Innovate Challenge et pour améliorer le service. Votre nom n'apparaît que dans les colonnes auteur
et relecteur, pour la traçabilité ; il n'est jamais affiché aux utilisateurs. Vous pouvez demander à tout
moment que vos lignes soient retirées.

Si vous acceptez aussi d'**enregistrer votre voix** (pour que le service puisse parler votre langue), un
accord écrit séparé vous sera demandé : voir `data/audio/README.md`.
