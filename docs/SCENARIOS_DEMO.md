# Scénarios de démonstration (protocole du jury)

Le jury choisit une **opération**, une **langue nationale** et un **canal**, soumet la requête, puis **répète la
même opération sur un autre canal** et compare. Tout se fait sur un même serveur (`npm start`), avec le backend
simulé commun : un transfert fait sur mobile se voit dans le solde au guichet automatique.

Depuis l’accueil `/`, ouvrir côte à côte `/mobile`, `/banque` (bouton « Aide dans ma langue »), `/canaux` (USSD et SMS), `/gab`,
et `/tableau` (onglet Journal) pour montrer l'interprétation de chaque requête en direct.

## Parcours jury en 90 secondes

1. Ouvrir `/mobile`, `/banque`, `/canaux` et `/tableau` sur le même serveur. Choisir **Fulfulde**.
2. Demander au jury un montant entre **2 000 et 10 000 FCFA** et le saisir dans « a yidi yerbinego [montant] FCFA ha Marie na » (formulation de collecte, brouillon). Si le jury parle, lui laisser corriger la transcription, appuyer sur **Envoyer**, puis vérifier le récapitulatif avant **Confirmer**.
3. Corriger avec « non plutôt [nouveau montant] FCFA ». Vérifier le numéro **655778899**, les frais et le total, puis confirmer. Sur USSD, choisir la langue avec **5**, entrer une demande libre ou choisir **2** pour un transfert guidé. Suivre **98** si l’écran propose une suite et **1** pour confirmer. **0** revient au menu depuis le dialogue. Une session expire après deux minutes d’inactivité.
4. Rejouer l’opération corrigée sur un deuxième canal. Dans **Comparer les canaux**, montrer le montant, les frais, le total et le bénéficiaire identiques, avec une référence distincte par transfert et la durée de chaque confirmation. L’onglet **Journal** montre aussi les tours de clarification et de correction.
5. Pour une explication financière à l’oral, demander la définition des frais. Le bouton de lecture utilise un clip complet lorsqu’il existe. Le récapitulatif reste visible pour tous les montants, y compris si aucun enregistrement ne couvre une réponse.

`node --test tests/finale.test.ts tests/safinum.test.ts` vérifie les transferts via les endpoints locaux,
l’ancienne confirmation refusée après correction, le débit unique, le rapprochement après perte d’une
réponse, l’expiration et les frais. Les tests SAFINUM démarrent un faux service financier.
Pour mesurer les vraies voix du dépôt après installation du modèle sur la machine de démonstration :

```bash
CT_ALLOW_DRAFT=1 node tools/eval-voice.ts fub
CT_ALLOW_DRAFT=1 node tools/eval-voice.ts wes
CT_REQUIRE_MT=1 node --test tests/mt.test.ts
```

Les voix et certains textes viennent de la collecte. L’évaluation vocale sur ces enregistrements doit
être annoncée comme une mesure sur les données collectées. La précision sur une formulation inédite
se vérifie pendant la répétition avec des locuteurs.

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
- Le mode local débite le simulateur. Le middleware officiel se configure avec les accès de l’équipe.

## Montrer la couverture sans la surestimer

Le tableau **Langues et modes disponibles** présente les modes actifs sur le serveur. Pour passer
à une autre langue bancaire pendant la démonstration, choisir l’ewondo ou le duala et utiliser les
menus ou les libellés du lexique avec un montant écrit en chiffres. Pour montrer une capacité vocale
supplémentaire, ouvrir le basaa depuis l’accueil et relire la transcription. Avec les deux paires
Flagship chargées, essayer le parcours bulu en le présentant comme expérimental.

La [liste officielle des codes d’Omnilingual ASR](https://github.com/facebookresearch/omnilingual-asr/blob/main/src/omnilingual_asr/models/wav2vec2_llama/lang_ids.py)
documente la couverture de transcription. Les clips du dépôt et la validation des parcours
bancaires nécessitent des ressources distinctes.
