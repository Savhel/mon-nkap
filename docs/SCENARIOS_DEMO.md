# Scénarios de démonstration (protocole du jury)

Le jury choisit une **opération**, une **langue nationale** et un **canal**, soumet la requête, puis **répète la
même opération sur un autre canal** et compare. Tout se fait sur un même serveur (`npm start`), avec le backend
simulé commun : un transfert fait sur mobile se voit dans le solde au guichet automatique.

Ouvrir côte à côte : `/mobile`, `/banque` (bouton « Aide dans ma langue »), `/canaux` (USSD et SMS), `/gab`,
et `/tableau` (onglet Journal) pour montrer l'interprétation de chaque requête en direct.

| # | Scénario du brief | Comment le montrer | Résultat attendu (vérifié par `npm test`) |
|---|---|---|---|
| 1 | Consultation du solde | Mobile : « solde » dans la langue ; USSD : menu 1 | Solde exact ; même `canonical` sur les deux canaux |
| 2 | Transfert d'argent | Mobile : transfert à Marie avec un montant dit en mots ; bouton Confirmer | Montant et bénéficiaire exacts ; exécuté une seule fois |
| 3 | Consultation des frais | Web : frais pour 20 000 FCFA | Frais et total expliqués |
| 4 | Historique | USSD : menu 4 | Dernières opérations, écrans ≤ 182 caractères |
| 5 | Correction | Mobile : transfert de 5 000, puis « non, plutôt 3 000 » dans la langue | Montant corrigé, nouvelle confirmation, l'ancienne n'est plus valable |
| 6 | Requête ambiguë | « envoyer à Paul » (deux Paul dans les contacts) | Question : lequel ? Rien n'est exécuté |
| 7 | Solde insuffisant | Transfert de 200 000 FCFA | Explication, montant manquant, rien n'est exécuté |
| 8 | Changement de langue | En cours de transfert : « parle-moi en duala », ou une phrase écrite directement dans l'autre langue | L'opération continue dans la nouvelle langue |
| 9 | Interaction multicanale | Préparer le transfert par USSD, confirmer par SMS avec le même numéro | Même opération, exécutée une seule fois (journal d'audit) |
| 10 | Terminologie financière | « c'est quoi les frais ? » dans la langue | Définition rédigée par un natif, dans la langue |

Bonus : retrait au **guichet automatique** (`/gab`) dans la langue ; voix (bouton micro) en français et anglais, et
dans les langues nationales selon les mesures de `data/eval/asr-*.json`.

## Ce qu'il faut annoncer honnêtement

- Les phrases en langue nationale affichent leur statut : « Validé par des natifs », « Brouillon » ou « français ».
- Le tableau de bord (`/tableau`) montre les métriques mesurées sur les phrases de test des natifs, langue par langue.
- Le backend est simulé tant que la documentation du bac à sable SAFINUM n'est pas fournie.
