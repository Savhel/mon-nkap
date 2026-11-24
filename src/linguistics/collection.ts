// Catalogue unique de ce que les locuteurs natifs doivent écrire pour qu'une langue soit prise en charge.
// Les modèles de tableurs (tools/collecte.ts) et l'import (tools/import-collecte.ts) sont générés à partir
// d'ici : ils ne peuvent pas diverger.
//
// Règle d'or : on ne demande JAMAIS de traduire une phrase française mot à mot. On décrit une SITUATION
// et le natif écrit ce qu'il dirait vraiment. C'est ce qui donne des formulations naturelles, celles que
// le jury utilisera.

export type Section = 'nombres' | 'lexique' | 'demandes' | 'reponses' | 'definitions';

/** Montants à faire dire : unités et dizaines pour apprendre les mots, puis montants composés pour vérifier. */
export const NUMBER_TARGETS: number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  11, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90,
  100, 200, 300, 500, 750,
  1000, 1500, 2000, 2500, 3000, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 50000,
  100000, 150000, 200000, 250000, 500000, 1000000,
];

export interface Concept { id: string; fr: string; hint: string }
/** Mots et expressions financières dont le moteur a besoin pour comprendre et répondre. */
export const CONCEPTS: Concept[] = [
  { id: 'money', fr: 'argent', hint: 'l’argent en général (« j’ai de l’argent »)' },
  { id: 'account', fr: 'compte', hint: 'le compte bancaire ou Mobile Money' },
  { id: 'balance', fr: 'solde', hint: 'l’argent qui reste sur le compte' },
  { id: 'send', fr: 'envoyer (de l’argent)', hint: 'toutes les façons courantes de dire « envoyer »' },
  { id: 'receive', fr: 'recevoir', hint: '' },
  { id: 'fees', fr: 'frais', hint: 'ce que le service prend en plus' },
  { id: 'cost', fr: 'combien ça coûte', hint: '' },
  { id: 'how_much', fr: 'combien', hint: '' },
  { id: 'history', fr: 'historique / mes dernières opérations', hint: '' },
  { id: 'airtime', fr: 'crédit téléphonique', hint: 'recharger, acheter du crédit' },
  { id: 'bill', fr: 'facture', hint: '' },
  { id: 'electricity', fr: 'électricité / courant (ENEO)', hint: '' },
  { id: 'water', fr: 'eau (CAMWATER)', hint: '' },
  { id: 'pay', fr: 'payer', hint: '' },
  { id: 'withdraw', fr: 'retirer (de l’argent)', hint: 'au guichet automatique' },
  { id: 'yes', fr: 'oui', hint: 'toutes les façons de dire oui, d’accord, c’est bon' },
  { id: 'no', fr: 'non', hint: '' },
  { id: 'confirm', fr: 'je confirme / vas-y', hint: '' },
  { id: 'cancel', fr: 'annuler / laisse tomber', hint: '' },
  { id: 'correction', fr: 'non, plutôt… / je voulais dire…', hint: 'pour corriger un montant ou un nom' },
  { id: 'to', fr: 'à (envoyer à quelqu’un)', hint: '' },
  { id: 'my', fr: 'mon / ma / mes', hint: '' },
  { id: 'number', fr: 'numéro (de téléphone)', hint: '' },
  { id: 'pin', fr: 'code secret (PIN)', hint: '' },
  { id: 'help', fr: 'aide / je ne comprends pas', hint: '' },
  { id: 'hello', fr: 'bonjour', hint: '' },
  { id: 'thanks', fr: 'merci', hint: '' },
  { id: 'what_is', fr: 'c’est quoi… ? / que veut dire… ?', hint: 'pour demander une explication' },
  { id: 'speak_language', fr: 'parle-moi en… / passe en…', hint: 'pour changer de langue' },
];

export interface Situation {
  id: string;
  intent: string;           // intention canonique attendue
  situation: string;        // ce qu'on décrit au natif (jamais une phrase à traduire)
  expect: Record<string, string | number>; // ce que le moteur doit extraire
}
/** Situations couvrant les 10 scénarios du jury. Plusieurs natifs écrivent chacun leurs propres phrases. */
export const SITUATIONS: Situation[] = [
  { id: 'bal1', intent: 'CONSULT_BALANCE', situation: 'Vous voulez savoir combien d’argent il vous reste sur votre compte.', expect: {} },
  { id: 'bal2', intent: 'CONSULT_BALANCE', situation: 'Vous demandez à voir votre solde, très brièvement (deux ou trois mots).', expect: {} },
  { id: 'tr1', intent: 'TRANSFER_MONEY', situation: 'Vous voulez envoyer 5 000 FCFA à Marie.', expect: { amount: 5000, beneficiary: 'Marie' } },
  { id: 'tr2', intent: 'TRANSFER_MONEY', situation: 'Vous voulez envoyer 25 000 FCFA à Aminatou. Dites le montant en lettres, comme vous le diriez à l’oral.', expect: { amount: 25000, beneficiary: 'Aminatou' } },
  { id: 'tr3', intent: 'TRANSFER_MONEY', situation: 'Vous voulez envoyer de l’argent à Paul, sans dire le montant.', expect: { beneficiary: 'Paul' } },
  { id: 'tr4', intent: 'TRANSFER_MONEY', situation: 'Vous voulez envoyer 150 000 FCFA au numéro 655 77 88 99.', expect: { amount: 150000, phone: '655778899' } },
  { id: 'fee1', intent: 'CHECK_FEES', situation: 'Vous voulez savoir combien coûtent les frais pour envoyer 20 000 FCFA.', expect: { amount: 20000 } },
  { id: 'fee2', intent: 'CHECK_FEES', situation: 'Vous demandez combien on vous prend quand vous envoyez de l’argent.', expect: {} },
  { id: 'his1', intent: 'VIEW_HISTORY', situation: 'Vous voulez voir vos dernières opérations.', expect: {} },
  { id: 'air1', intent: 'BUY_AIRTIME', situation: 'Vous voulez acheter 1 000 FCFA de crédit téléphonique.', expect: { amount: 1000 } },
  { id: 'bill1', intent: 'PAY_BILL', situation: 'Vous voulez payer votre facture d’électricité ENEO de 12 500 FCFA.', expect: { amount: 12500, biller: 'ENEO' } },
  { id: 'wd1', intent: 'WITHDRAW_MONEY', situation: 'Au guichet automatique, vous voulez retirer 10 000 FCFA.', expect: { amount: 10000 } },
  { id: 'cor1', intent: 'CORRECT', situation: 'Le système vous demande de confirmer un envoi de 5 000 FCFA, mais vous vouliez envoyer 3 000 FCFA. Vous le corrigez.', expect: { amount: 3000 } },
  { id: 'cor2', intent: 'CORRECT', situation: 'Le système vous propose d’envoyer à Paul, mais c’est à Marie que vous voulez envoyer. Vous le corrigez.', expect: { beneficiary: 'Marie' } },
  { id: 'yes1', intent: 'CONFIRM', situation: 'Le système vous demande de confirmer l’envoi. Vous acceptez.', expect: {} },
  { id: 'no1', intent: 'CANCEL', situation: 'Le système vous demande de confirmer l’envoi. Vous refusez, vous voulez tout annuler.', expect: {} },
  { id: 'amb1', intent: 'TRANSFER_MONEY', situation: 'Vous dites seulement que vous voulez envoyer de l’argent, sans dire à qui ni combien.', expect: {} },
  { id: 'term1', intent: 'EXPLAIN_TERM', situation: 'Vous ne savez pas ce que veut dire « frais » et vous le demandez.', expect: { term: 'fees' } },
  { id: 'term2', intent: 'EXPLAIN_TERM', situation: 'Vous demandez ce que veut dire « solde ».', expect: { term: 'balance' } },
  { id: 'lang1', intent: 'SWITCH_LANGUAGE', situation: 'Vous demandez au système de vous parler dans votre langue (dites le nom de la langue).', expect: {} },
  { id: 'mix1', intent: 'TRANSFER_MONEY', situation: 'Vous envoyez 2 000 FCFA à Paul en mélangeant votre langue et le français, comme on le fait souvent en ville.', expect: { amount: 2000, beneficiary: 'Paul' } },
  { id: 'greet1', intent: 'GREETING', situation: 'Vous saluez le service avant de faire votre demande.', expect: {} },
];

export interface ResponseTemplate { id: string; fr: string; placeholders: string[] }
/** Réponses du système. Le natif réécrit chaque phrase naturellement, en gardant les {repères} tels quels. */
export const RESPONSES: ResponseTemplate[] = [
  { id: 'balance', fr: 'Votre solde disponible est de {solde}.', placeholders: ['solde'] },
  { id: 'fee_quote', fr: 'Pour envoyer {montant}, les frais sont de {frais}. Au total, {total} seront retirés de votre compte.', placeholders: ['montant', 'frais', 'total'] },
  { id: 'ask_amount', fr: 'Quel montant voulez-vous envoyer ?', placeholders: [] },
  { id: 'ask_amount_to', fr: 'Quel montant voulez-vous envoyer à {nom} ?', placeholders: ['nom'] },
  { id: 'ask_beneficiary', fr: 'À qui voulez-vous envoyer {montant} ? Donnez un nom ou un numéro.', placeholders: ['montant'] },
  { id: 'ask_which', fr: 'Plusieurs personnes portent ce nom. Laquelle ?', placeholders: [] },
  { id: 'ask_intent', fr: 'Je n’ai pas bien compris. Voulez-vous voir votre solde, envoyer de l’argent, connaître les frais ou voir votre historique ?', placeholders: [] },
  { id: 'confirm_transfer', fr: 'Vous allez envoyer {montant} à {nom} ({numero}). Frais : {frais}. Total : {total}. Confirmez-vous ?', placeholders: ['montant', 'nom', 'numero', 'frais', 'total'] },
  { id: 'corrected', fr: 'C’est corrigé.', placeholders: [] },
  { id: 'transfer_done', fr: 'Transfert réussi : {montant} envoyés à {nom}. Référence {reference}. Nouveau solde : {solde}.', placeholders: ['montant', 'nom', 'reference', 'solde'] },
  { id: 'confirm_airtime', fr: 'Acheter {montant} de crédit pour le {numero} ? Sans frais.', placeholders: ['montant', 'numero'] },
  { id: 'airtime_done', fr: 'Crédit envoyé : {montant} au {numero}. Nouveau solde : {solde}.', placeholders: ['montant', 'numero', 'solde'] },
  { id: 'confirm_bill', fr: 'Payer la facture {fournisseur} de {montant} ? Frais : {frais}. Total : {total}.', placeholders: ['fournisseur', 'montant', 'frais', 'total'] },
  { id: 'bill_done', fr: 'Facture {fournisseur} payée : {montant}. Nouveau solde : {solde}.', placeholders: ['fournisseur', 'montant', 'solde'] },
  { id: 'confirm_withdraw', fr: 'Retirer {montant} ? Frais : {frais}. Total : {total}. Confirmez-vous ?', placeholders: ['montant', 'frais', 'total'] },
  { id: 'withdraw_done', fr: 'Retrait effectué : {montant}. Prenez vos billets. Nouveau solde : {solde}.', placeholders: ['montant', 'solde'] },
  { id: 'insufficient', fr: 'Solde insuffisant. Vous avez {solde}, il faut {requis} frais compris. Il manque {manque}. Aucune opération n’a été effectuée.', placeholders: ['solde', 'requis', 'manque'] },
  { id: 'limit_exceeded', fr: 'Ce montant dépasse votre plafond de {plafond} par jour.', placeholders: ['plafond'] },
  { id: 'history_intro', fr: 'Vos dernières opérations :', placeholders: [] },
  { id: 'hist_sent', fr: 'envoyé', placeholders: [] },
  { id: 'hist_received', fr: 'reçu', placeholders: [] },
  { id: 'hist_airtime', fr: 'crédit', placeholders: [] },
  { id: 'hist_bill', fr: 'facture', placeholders: [] },
  { id: 'hist_withdraw', fr: 'retrait', placeholders: [] },
  { id: 'cancelled', fr: 'Opération annulée. Aucun argent n’a été envoyé.', placeholders: [] },
  { id: 'language_switched', fr: 'D’accord, on continue en {langue}.', placeholders: ['langue'] },
  { id: 'help', fr: 'Je peux : donner votre solde, envoyer de l’argent, expliquer les frais, montrer l’historique, acheter du crédit, payer une facture.', placeholders: [] },
  { id: 'greeting', fr: 'Bonjour ! Que voulez-vous faire ? Solde, transfert, frais ou historique.', placeholders: [] },
  { id: 'not_understood', fr: 'Je n’ai pas compris. Pouvez-vous le dire autrement ?', placeholders: [] },
  { id: 'which_language', fr: 'Je ne suis pas sûr de la langue. Dans quelle langue voulez-vous continuer ?', placeholders: [] },
  { id: 'backend_error', fr: 'Le service est momentanément indisponible. Aucune opération n’a été effectuée. Réessayez.', placeholders: [] },
  { id: 'menu_confirm', fr: 'Confirmer', placeholders: [] },
  { id: 'menu_cancel', fr: 'Annuler', placeholders: [] },
  { id: 'menu_balance', fr: 'Solde', placeholders: [] },
  { id: 'menu_transfer', fr: 'Envoyer de l’argent', placeholders: [] },
  { id: 'menu_fees', fr: 'Frais', placeholders: [] },
  { id: 'menu_history', fr: 'Historique', placeholders: [] },
  { id: 'menu_airtime', fr: 'Crédit téléphonique', placeholders: [] },
  { id: 'menu_bill', fr: 'Payer une facture', placeholders: [] },
  { id: 'menu_withdraw', fr: 'Retrait', placeholders: [] },
  { id: 'menu_language', fr: 'Langue', placeholders: [] },
  { id: 'menu_more', fr: 'Suite', placeholders: [] },
  { id: 'menu_free_text', fr: 'Ou écrivez votre demande', placeholders: [] },
];

export interface Definition { id: string; fr: string }
/** Termes financiers à expliquer DANS la langue (scénario 10 du jury). */
export const DEFINITIONS: Definition[] = [
  { id: 'fees', fr: 'Les frais sont la somme que le service prélève en plus du montant envoyé. Par exemple, pour envoyer 10 000 FCFA avec 100 FCFA de frais, 10 100 FCFA sont retirés de votre compte.' },
  { id: 'balance', fr: 'Le solde est l’argent disponible sur votre compte en ce moment.' },
  { id: 'transfer', fr: 'Un transfert, c’est envoyer de l’argent de votre compte vers celui d’une autre personne.' },
  { id: 'beneficiary', fr: 'Le bénéficiaire est la personne qui reçoit l’argent. Vérifiez toujours son nom et son numéro.' },
  { id: 'airtime', fr: 'Le crédit téléphonique sert à appeler, envoyer des SMS ou utiliser internet sur un téléphone.' },
  { id: 'bill', fr: 'Une facture est une somme à payer pour un service, par exemple l’électricité (ENEO) ou l’eau (CAMWATER).' },
  { id: 'history', fr: 'L’historique est la liste de vos dernières opérations : argent reçu, envoyé ou payé.' },
  { id: 'pin', fr: 'Le code PIN est votre code secret. Ne le donnez jamais à personne, même à un agent.' },
  { id: 'limit', fr: 'Le plafond est le montant maximum que vous pouvez envoyer par jour.' },
  { id: 'withdraw', fr: 'Un retrait, c’est sortir de l’argent liquide de votre compte, au guichet automatique ou chez un agent.' },
];

/** Colonnes communes de traçabilité, ajoutées à chaque tableur. */
export const TRACE_COLUMNS = ['auteur', 'relecteur', 'statut', 'commentaire'];

/** Une ligne n'est « validée » que si un second natif, différent de l'auteur, l'a relue et marquée valide. */
export function isValidated(row: Record<string, string>): boolean {
  const a = (row.auteur ?? '').trim().toLowerCase();
  const r = (row.relecteur ?? '').trim().toLowerCase();
  const s = (row.statut ?? '').trim().toLowerCase();
  return !!a && !!r && a !== r && /^valid/.test(s);
}
