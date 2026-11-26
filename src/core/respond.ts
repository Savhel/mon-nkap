// Génération des réponses dans la langue de l'utilisateur.
//
// Règle de base : on n'invente aucune phrase en langue nationale.
// - fr / en : gabarits rédigés ici.
// - langues nationales : la réponse est assemblée à partir des libellés du pack Mboa
//   (« Solde disponible : 150 000 FCFA »), qui sont des brouillons à faire valider. Si un libellé
//   manque, la ligne reste en français et la réponse est marquée « fallback ».
// - Les montants viennent toujours du backend et sont vérifiés après rendu (verifyNumbers).

import { readFileSync } from 'node:fs';
import { formatFcfa } from './amounts.ts';
import { speechPlan } from '../voice/native.ts';
import type { Transaction } from '../backend/types.ts';
import { runtimeFor } from '../linguistics/runtime.ts';
import { usable, type Entry } from '../linguistics/pack.ts';

/** reference = français / anglais, langues de référence (jamais présentées comme langues nationales validées). */
export type Quality = 'reference' | 'validated' | 'draft' | 'machine' | 'fallback';

export interface Reply {
  lang: string;
  text: string;          // texte dans la langue demandée
  fr: string;            // équivalent français (référence pour le jury et les canaux bilingues)
  quality: Quality;
  menu?: { key: string; label: string }[]; // choix numérotés (USSD, IVR, SMS)
  speech: string[]; // clips d'enregistrements natifs qui disent cette réponse (voir src/voice/native.ts)
  values: number[];      // montants affichés, pour le contrôle d'intégrité
  mt?: { text: string; back: string; score: number; accepted: boolean; reason?: string; engine: string }; // essai de traduction automatique (transparence)
}

type Pack = { phrases: Record<string, Record<string, string>>; ui: Record<string, Record<string, string>> };
const pack: Pack = JSON.parse(readFileSync(new URL('../../data/mboa-pack.json', import.meta.url), 'utf8'));
const PACK_LANGS = new Set(['ewo', 'dua', 'fub', 'wes']);

function label(id: string, lang: string): { text: string; ok: boolean } {
  const entry = pack.phrases[id] ?? pack.ui[id];
  const fr = entry?.fr ?? id;
  const t = entry?.[lang];
  return t ? { text: t, ok: true } : { text: fr, ok: false };
}

export type ReplyKind =
  | { kind: 'balance'; balance: number }
  | { kind: 'fee_quote'; amount: number; fee: number; total: number }
  | { kind: 'ask_amount'; beneficiary?: string }
  | { kind: 'ask_beneficiary'; amount?: number }
  | { kind: 'ask_which_beneficiary'; options: { name: string; phone: string }[] }
  | { kind: 'ask_intent' }
  | { kind: 'confirm_transfer'; amount: number; fee: number; total: number; beneficiary: string; phone: string; corrected?: 'amount' | 'beneficiary' }
  | { kind: 'transfer_done'; tx: Transaction; balance: number }
  | { kind: 'confirm_airtime'; amount: number; phone: string }
  | { kind: 'airtime_done'; tx: Transaction; balance: number }
  | { kind: 'confirm_bill'; biller: string; amount: number; fee: number; total: number }
  | { kind: 'bill_done'; tx: Transaction; balance: number }
  | { kind: 'confirm_withdraw'; amount: number; fee: number; total: number }
  | { kind: 'withdraw_done'; tx: Transaction; balance: number }
  | { kind: 'insufficient'; balance: number; required: number; missing: number }
  | { kind: 'limit_exceeded'; limit: number }
  | { kind: 'history'; items: Transaction[] }
  | { kind: 'explain'; term: string }
  | { kind: 'cancelled' }
  | { kind: 'language_switched' }
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'not_understood' }
  | { kind: 'backend_error' }
  | { kind: 'outcome_unknown'; reference: string };

const GLOSSARY: Record<string, { fr: string; en: string }> = {
  fees: { fr: "Les frais sont la somme que le service prélève en plus du montant envoyé. Exemple : pour envoyer 10 000 FCFA avec 100 FCFA de frais, 10 100 FCFA sont retirés de votre compte.", en: 'Fees are the amount the service charges on top of the money you send. Example: sending 10,000 FCFA with a 100 FCFA fee takes 10,100 FCFA from your account.' },
  balance: { fr: "Le solde est l'argent disponible sur votre compte en ce moment.", en: 'Your balance is the money available in your account right now.' },
  transfer: { fr: "Un transfert consiste à envoyer de l'argent de votre compte vers celui d'une autre personne.", en: "A transfer sends money from your account to someone else's account." },
  beneficiary: { fr: "Le bénéficiaire est la personne qui reçoit l'argent. Vérifiez toujours son nom et son numéro.", en: 'The beneficiary is the person who receives the money. Always check their name and number.' },
  airtime: { fr: 'Le crédit de communication sert à appeler, envoyer des SMS ou utiliser internet sur un téléphone.', en: 'Airtime is credit used to make calls, send SMS or use mobile internet.' },
  bill: { fr: "Une facture est une somme à payer pour un service, par exemple l'électricité (ENEO) ou l'eau (CAMWATER).", en: 'A bill is an amount owed for a service such as electricity (ENEO) or water (CAMWATER).' },
  history: { fr: "L'historique est la liste de vos dernières opérations : argent reçu, envoyé ou payé.", en: 'Your history is the list of your latest operations: money received, sent or paid.' },
  pin: { fr: 'Le code PIN est votre code secret. Ne le donnez jamais à personne, même à un agent.', en: 'Your PIN is your secret code. Never give it to anyone, not even an agent.' },
  limit: { fr: 'Le plafond est le montant maximum que vous pouvez envoyer par jour.', en: 'The limit is the maximum amount you can send per day.' },
  withdraw: { fr: 'Un retrait, c’est sortir de l’argent liquide de votre compte, au guichet automatique ou chez un agent.', en: 'A withdrawal takes cash out of your account, at an ATM or an agent.' },
};
const TERM_LABEL: Record<string, string> = { fees: 'step_fees', balance: 'step_balance', transfer: 'transfer_title', beneficiary: 'recipient', history: 'history', pin: 'pin_never_share' };

function frenchAndEnglish(r: ReplyKind, lang: 'fr' | 'en'): string {
  const F = (n: number) => formatFcfa(n, lang);
  const fr = lang === 'fr';
  switch (r.kind) {
    case 'balance': return fr ? `Votre solde disponible est de ${F(r.balance)}.` : `Your available balance is ${F(r.balance)}.`;
    case 'fee_quote': return fr ? `Pour envoyer ${F(r.amount)}, les frais sont de ${F(r.fee)}. Total retiré : ${F(r.total)}.` : `To send ${F(r.amount)}, the fee is ${F(r.fee)}. Total debited: ${F(r.total)}.`;
    case 'ask_amount': return fr ? `Quel montant voulez-vous envoyer${r.beneficiary ? ` à ${r.beneficiary}` : ''} ?` : `How much do you want to send${r.beneficiary ? ` to ${r.beneficiary}` : ''}?`;
    case 'ask_beneficiary': return fr ? `À qui voulez-vous envoyer${r.amount ? ` ${F(r.amount)}` : " l'argent"} ? Donnez un nom ou un numéro.` : `Who do you want to send${r.amount ? ` ${F(r.amount)}` : ' the money'} to? Give a name or a number.`;
    case 'ask_which_beneficiary': return fr ? 'Plusieurs contacts correspondent. Lequel ?' : 'Several contacts match. Which one?';
    case 'ask_intent': return fr ? 'Je n’ai pas bien compris. Voulez-vous voir votre solde, envoyer de l’argent, connaître les frais ou voir votre historique ?' : "I didn't understand. Do you want your balance, to send money, the fees or your history?";
    case 'confirm_transfer': return (r.corrected ? (fr ? 'C’est corrigé. ' : 'Corrected. ') : '') + (fr
      ? `Vous allez envoyer ${F(r.amount)} à ${r.beneficiary} (${r.phone}). Frais : ${F(r.fee)}. Total : ${F(r.total)}. Confirmez-vous ?`
      : `You will send ${F(r.amount)} to ${r.beneficiary} (${r.phone}). Fee: ${F(r.fee)}. Total: ${F(r.total)}. Do you confirm?`);
    case 'transfer_done': return fr ? `Transfert réussi : ${F(r.tx.amount)} envoyés à ${r.tx.counterparty}. Référence ${r.tx.id}. Nouveau solde : ${F(r.balance)}.` : `Transfer successful: ${F(r.tx.amount)} sent to ${r.tx.counterparty}. Reference ${r.tx.id}. New balance: ${F(r.balance)}.`;
    case 'confirm_airtime': return fr ? `Acheter ${F(r.amount)} de crédit pour le ${r.phone} ? Sans frais.` : `Buy ${F(r.amount)} of airtime for ${r.phone}? No fee.`;
    case 'airtime_done': return fr ? `Crédit envoyé : ${F(r.tx.amount)} au ${r.tx.counterparty}. Nouveau solde : ${F(r.balance)}.` : `Airtime sent: ${F(r.tx.amount)} to ${r.tx.counterparty}. New balance: ${F(r.balance)}.`;
    case 'confirm_bill': return fr ? `Payer la facture ${r.biller} de ${F(r.amount)} ? Frais : ${F(r.fee)}. Total : ${F(r.total)}.` : `Pay the ${r.biller} bill of ${F(r.amount)}? Fee: ${F(r.fee)}. Total: ${F(r.total)}.`;
    case 'bill_done': return fr ? `Facture ${r.tx.counterparty} payée : ${F(r.tx.amount)}. Nouveau solde : ${F(r.balance)}.` : `${r.tx.counterparty} bill paid: ${F(r.tx.amount)}. New balance: ${F(r.balance)}.`;
    case 'confirm_withdraw': return fr ? `Retirer ${F(r.amount)} ? Frais : ${F(r.fee)}. Total : ${F(r.total)}. Confirmez-vous ?` : `Withdraw ${F(r.amount)}? Fee: ${F(r.fee)}. Total: ${F(r.total)}. Do you confirm?`;
    case 'withdraw_done': return fr ? `Retrait effectué : ${F(r.tx.amount)}. Prenez vos billets. Nouveau solde : ${F(r.balance)}.` : `Withdrawal done: ${F(r.tx.amount)}. Take your cash. New balance: ${F(r.balance)}.`;
    case 'insufficient': return fr ? `Solde insuffisant. Vous avez ${F(r.balance)}, il faut ${F(r.required)} frais compris. Il manque ${F(r.missing)}. Aucune opération n’a été effectuée.` : `Insufficient balance. You have ${F(r.balance)}, ${F(r.required)} is needed including fees. ${F(r.missing)} is missing. Nothing was executed.`;
    case 'limit_exceeded': return fr ? `Ce montant dépasse le plafond de ${F(r.limit)} par jour.` : `This amount exceeds the daily limit of ${F(r.limit)}.`;
    case 'history': return (fr ? 'Vos dernières opérations : ' : 'Your latest operations: ') + r.items.map((t) => `${t.date.slice(0, 10)} ${histLabel(t, lang)} ${F(t.amount)}${t.counterparty ? ` (${t.counterparty})` : ''}`).join(' ; ') + '.';
    case 'explain': return GLOSSARY[r.term]?.[lang] ?? (fr ? 'Je ne connais pas encore ce terme.' : "I don't know this term yet.");
    case 'cancelled': return fr ? 'Opération annulée. Aucun argent n’a été envoyé.' : 'Operation cancelled. No money was sent.';
    case 'language_switched': return fr ? 'D’accord, on continue en français.' : "OK, let's continue in English.";
    case 'help': return fr ? 'Je peux : donner votre solde, envoyer de l’argent, expliquer les frais, montrer l’historique, acheter du crédit, payer une facture.' : 'I can: give your balance, send money, explain fees, show your history, buy airtime, pay a bill.';
    case 'greeting': return fr ? 'Bonjour ! Que voulez-vous faire ? Solde, transfert, frais ou historique.' : 'Hello! What would you like to do? Balance, transfer, fees or history.';
    case 'not_understood': return fr ? 'Je n’ai pas compris. Pouvez-vous répéter autrement ?' : "I didn't understand. Can you say it another way?";
    case 'outcome_unknown': return fr
      ? `Statut en cours de vérification. Ne refaites pas le transfert. Référence : ${r.reference}.`
      : `Checking the transaction status. Do not resend. Reference: ${r.reference}.`;
    case 'backend_error': return fr ? 'Le service est momentanément indisponible. Aucune opération n’a été effectuée. Réessayez.' : 'The service is temporarily unavailable. Nothing was executed. Please retry.';
  }
}

function histLabel(t: Transaction, lang: string): string {
  const fr = lang !== 'en';
  return ({ transfer_out: fr ? 'envoi' : 'sent', transfer_in: fr ? 'reçu' : 'received', airtime: fr ? 'crédit' : 'airtime', bill: fr ? 'facture' : 'bill', deposit: fr ? 'dépôt' : 'deposit', withdrawal: fr ? 'retrait' : 'withdrawal' })[t.type];
}

/** Réponse en langue nationale à partir des libellés existants : « libellé : valeur », une ligne par information. */
function national(r: ReplyKind, lang: string): { text: string; ok: boolean } {
  const F = (n: number) => formatFcfa(n, 'fr');
  let ok = true;
  const L = (id: string) => { const x = label(id, lang); ok &&= x.ok; return x.text; };
  const lines: string[] = [];
  switch (r.kind) {
    case 'balance': lines.push(`${L('available_balance')} : ${F(r.balance)}`); break;
    case 'fee_quote': lines.push(`${L('amount')} : ${F(r.amount)}`, `${L('step_fees')} : ${F(r.fee)}`, `${L('total_to_debit')} : ${F(r.total)}`); break;
    case 'ask_amount': lines.push(`${L('amount_to_send')} ?${r.beneficiary ? ` (${r.beneficiary})` : ''}`); break;
    case 'ask_beneficiary': lines.push(`${L('recipient')} ?${r.amount ? ` (${F(r.amount)})` : ''}`); break;
    case 'ask_which_beneficiary': lines.push(`${L('recipient')} ?`); break;
    case 'confirm_transfer':
      lines.push(`${L('step_summary')} :`, `${L('recipient')} : ${r.beneficiary} (${r.phone})`, `${L('amount')} : ${F(r.amount)}`, `${L('step_fees')} : ${F(r.fee)}`, `${L('total_to_debit')} : ${F(r.total)}`);
      break;
    case 'confirm_withdraw': lines.push(`${L('amount')} : ${F(r.amount)}`, `${L('step_fees')} : ${F(r.fee)}`, `${L('total_to_debit')} : ${F(r.total)}`); break;
    case 'transfer_done': case 'airtime_done': case 'bill_done': case 'withdraw_done':
      lines.push(L('tx_success'), `${L('amount')} : ${F(r.tx.amount)}`, `${L('recipient')} : ${r.tx.counterparty}`, `${L('reference')} : ${r.tx.id}`, `${L('balance_after')} : ${F(r.balance)}`);
      break;
    case 'confirm_airtime': lines.push(`${L('amount')} : ${F(r.amount)}`, `${L('phone')} : ${r.phone}`, `${L('step_fees')} : ${L('free')}`); break;
    case 'confirm_bill': lines.push(`${L('service_payment')} : ${r.biller}`, `${L('amount')} : ${F(r.amount)}`, `${L('step_fees')} : ${F(r.fee)}`, `${L('total_to_debit')} : ${F(r.total)}`); break;
    case 'insufficient': lines.push(L('err_insufficient'), `${L('available_balance')} : ${F(r.balance)}`, `${L('total_to_debit')} : ${F(r.required)}`, `− ${F(r.missing)}`); break;
    case 'history': lines.push(`${L('history')} :`, ...r.items.map((t) => `${t.date.slice(0, 10)} · ${F(t.amount)}${t.counterparty ? ` · ${t.counterparty}` : ''}`)); break;
    case 'cancelled': lines.push(L('cancel')); break;
    case 'language_switched': lines.push(`${L('language')} ✓`); break;
    case 'greeting': lines.push(L('hello')); break;
    case 'backend_error': lines.push(L('err_network')); break;
    case 'explain': {
      const id = TERM_LABEL[r.term];
      if (id) lines.push(`${L(id)} :`);
      ok = false; // Pas de définition rédigée en langue nationale : la définition reste en français.
      lines.push(GLOSSARY[r.term]?.fr ?? '');
      break;
    }
    default: ok = false; lines.push(frenchAndEnglish(r, 'fr'));
  }
  return { text: lines.join('\n'), ok };
}

/**
 * Réponse rédigée par les natifs (pack de langue), valeurs insérées par le système dans les {repères}.
 * Renvoie null si une seule phrase nécessaire manque : on retombe alors sur l'assemblage de libellés.
 */
const LANG_NAMES: Record<string, string> = { fr: 'français', en: 'English', ewo: 'Ewondo', dua: 'Duala', fub: 'Fulfulde', wes: 'Pidgin', bas: 'Basaa', bum: 'Bulu' };
function nativeReply(r: ReplyKind, lang: string): { text: string; quality: Quality } | null {
  const rt = runtimeFor(lang);
  if (!rt) return null;
  const used: Entry[] = [];
  const F = (n: number) => formatFcfa(n, 'fr');
  const T = (id: string, vals: Record<string, string> = {}): string | null => {
    const e = rt.pack.responses[id];
    if (!e || !usable(e)) return null;
    used.push(e);
    if (Object.keys(vals).some((key) => !e.text.includes(`{${key}}`))) return null;
    return e.text.replace(/\{([a-z_]+)\}/g, (_, k: string) => vals[k] ?? `{${k}}`);
  };
  const D = (id: string): string | null => { const e = rt.pack.definitions[id]; if (!e || !usable(e)) return null; used.push(e); return e.text; };
  let text: string | null = null;
  switch (r.kind) {
    case 'balance': text = T('balance', { solde: F(r.balance) }); break;
    case 'fee_quote': text = T('fee_quote', { montant: F(r.amount), frais: F(r.fee), total: F(r.total) }); break;
    case 'ask_amount': text = r.beneficiary ? T('ask_amount_to', { nom: r.beneficiary }) : T('ask_amount'); break;
    case 'ask_beneficiary': text = r.amount ? T('ask_beneficiary', { montant: F(r.amount) }) : null; break;
    case 'ask_which_beneficiary': text = T('ask_which'); break;
    case 'ask_intent': text = T('ask_intent'); break;
    case 'confirm_transfer': {
      const c = T('confirm_transfer', { montant: F(r.amount), nom: r.beneficiary, numero: r.phone, frais: F(r.fee), total: F(r.total) });
      const pre = r.corrected ? T('corrected') : '';
      text = c === null || pre === null ? null : (pre ? `${pre} ${c}` : c);
      break;
    }
    case 'transfer_done': text = T('transfer_done', { montant: F(r.tx.amount), nom: r.tx.counterparty ?? '', reference: r.tx.id, solde: F(r.balance) }); break;
    case 'confirm_airtime': text = T('confirm_airtime', { montant: F(r.amount), numero: r.phone }); break;
    case 'airtime_done': text = T('airtime_done', { montant: F(r.tx.amount), numero: r.tx.counterparty ?? '', solde: F(r.balance) }); break;
    case 'confirm_bill': text = T('confirm_bill', { fournisseur: r.biller, montant: F(r.amount), frais: F(r.fee), total: F(r.total) }); break;
    case 'bill_done': text = T('bill_done', { fournisseur: r.tx.counterparty ?? '', montant: F(r.tx.amount), solde: F(r.balance) }); break;
    case 'confirm_withdraw': text = T('confirm_withdraw', { montant: F(r.amount), frais: F(r.fee), total: F(r.total) }); break;
    case 'withdraw_done': text = T('withdraw_done', { montant: F(r.tx.amount), solde: F(r.balance) }); break;
    case 'insufficient': text = T('insufficient', { solde: F(r.balance), requis: F(r.required), manque: F(r.missing) }); break;
    case 'limit_exceeded': text = T('limit_exceeded', { plafond: F(r.limit) }); break;
    case 'history': {
      const intro = T('history_intro');
      const lines = r.items.map((t) => {
        const lbl = T({ transfer_out: 'hist_sent', transfer_in: 'hist_received', airtime: 'hist_airtime', bill: 'hist_bill', deposit: 'hist_received', withdrawal: 'hist_withdraw' }[t.type]);
        return lbl === null ? null : `${t.date.slice(0, 10)} · ${lbl} · ${F(t.amount)}${t.counterparty ? ` · ${t.counterparty}` : ''}`;
      });
      text = intro === null || lines.some((l) => l === null) ? null : [intro, ...lines].join('\n');
      break;
    }
    case 'explain': text = D(r.term); break;
    case 'language_switched': text = T('language_switched', { langue: LANG_NAMES[lang] ?? lang }); break;
    case 'cancelled': case 'help': case 'greeting': case 'not_understood': case 'backend_error': text = T(r.kind); break;
  }
  if (text === null) return null;
  return { text, quality: used.every((e) => e.validated) ? 'validated' : 'draft' };
}

function menuFor(r: ReplyKind, lang: string): Reply['menu'] {
  const fr = lang === 'fr', en = lang === 'en';
  const native = (id: string) => { const e = runtimeFor(lang)?.pack.responses[id]; return e && usable(e) ? e.text : null; };
  const yes = fr ? 'Confirmer' : en ? 'Confirm' : native('menu_confirm') ?? label('validate', lang).text;
  const no = fr ? 'Annuler' : en ? 'Cancel' : native('menu_cancel') ?? label('cancel', lang).text;
  if (r.kind.startsWith('confirm_')) return [{ key: '1', label: yes }, { key: '2', label: no }];
  if (r.kind === 'ask_which_beneficiary') return r.options.map((o, i) => ({ key: String(i + 1), label: `${o.name} (${o.phone})` }));
  return undefined;
}

export function valuesOf(r: ReplyKind): number[] {
  switch (r.kind) {
    case 'balance': return [r.balance];
    case 'fee_quote': case 'confirm_bill': case 'confirm_withdraw': return [r.amount, r.fee, r.total];
    case 'confirm_transfer': return [r.amount, r.fee, r.total];
    case 'transfer_done': case 'airtime_done': case 'bill_done': case 'withdraw_done': return [r.tx.amount, r.balance];
    case 'confirm_airtime': return [r.amount];
    case 'insufficient': return [r.balance, r.required, r.missing];
    case 'history': return r.items.map((t) => t.amount);
    case 'ask_amount': return [];
    case 'ask_beneficiary': return r.amount ? [r.amount] : [];
    case 'limit_exceeded': return [r.limit];
    default: return [];
  }
}

/** Contrôle d'intégrité : chaque montant attendu apparaît tel quel dans le texte rendu. */
export function verifyNumbers(text: string, values: number[], lang: string): boolean {
  return values.every((v) => text.includes(formatFcfa(v, lang === 'en' ? 'en' : 'fr')));
}

export function render(r: ReplyKind, lang: string): Reply {
  const fr = frenchAndEnglish(r, 'fr');
  let text: string; let quality: Quality;
  if (lang === 'fr') { text = fr; quality = 'reference'; }
  else if (lang === 'en') { text = frenchAndEnglish(r, 'en'); quality = 'reference'; }
  else if (nativeReply(r, lang)) { const n = nativeReply(r, lang)!; text = n.text; quality = n.quality; }
  else if (PACK_LANGS.has(lang)) { const n = national(r, lang); text = n.text; quality = n.ok ? 'draft' : 'fallback'; }
  else { text = fr; quality = 'fallback'; }
  const values = valuesOf(r);
  if (!verifyNumbers(text, values, lang) || !verifyNumbers(fr, values, 'fr')) {
    throw new Error(`intégrité : un montant attendu manque dans la réponse ${r.kind}/${lang}`);
  }
  return { lang, text, fr, quality, menu: menuFor(r, lang), values, speech: speechPlan(r, lang) };
}

/**
 * Libellés d'interface (menus du GAB, de l'USSD, de l'application) dans une langue, avec leur provenance :
 * phrase validée par les natifs, sinon brouillon Mboa, sinon français (annoncé comme tel).
 */
const MENU_FR: Record<string, string> = {
  menu_balance: 'Solde', menu_transfer: 'Envoyer de l’argent', menu_fees: 'Frais', menu_history: 'Historique', menu_airtime: 'Crédit téléphonique',
  menu_bill: 'Payer une facture', menu_withdraw: 'Retrait', menu_language: 'Langue', menu_confirm: 'Confirmer', menu_cancel: 'Annuler', menu_more: 'Suite', menu_free_text: 'Ou écrivez votre demande',
};
const MENU_MBOA: Record<string, string> = { menu_balance: 'step_balance', menu_transfer: 'transfer_title', menu_fees: 'step_fees', menu_history: 'history', menu_language: 'language', menu_confirm: 'validate', menu_cancel: 'cancel' };
export function uiLabels(lang: string): Record<string, { text: string; quality: Quality }> {
  const out: Record<string, { text: string; quality: Quality }> = {};
  for (const [id, fr] of Object.entries(MENU_FR)) {
    const e = runtimeFor(lang)?.pack.responses[id];
    if (lang === 'fr') out[id] = { text: fr, quality: 'reference' };
    else if (e && usable(e)) out[id] = { text: e.text, quality: e.validated ? 'validated' : 'draft' };
    else if (MENU_MBOA[id] && PACK_LANGS.has(lang) && label(MENU_MBOA[id], lang).ok) out[id] = { text: label(MENU_MBOA[id], lang).text, quality: 'draft' };
    else out[id] = { text: fr, quality: 'fallback' };
  }
  return out;
}
