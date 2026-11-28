// Voix NATIVE par enregistrements : aucune synthèse n'existe pour les langues nationales, donc on
// fait parler le moteur avec de vrais enregistrements de locuteurs, assemblés bout à bout.
//
// Une réponse = une suite de « clips » : des phrases fixes (« Votre solde disponible est de »), des
// montants décomposés (« cent mille » + « quarante mille » + « neuf cents » + « francs CFA ») et des
// noms (« Marie Ngo Bassa »). Les fichiers sont dans data/audio/<langue>/<clé>.<wav|ogg|m4a|mp3|opus|webm>
// (une note vocale WhatsApp convient). Si UN SEUL clip obligatoire manque, on ne bricole pas :
// la réponse native n'est pas jouée et le canal se rabat sur son comportement actuel.
//
// L'ordre des morceaux suit le français par défaut. Si une langue construit la phrase autrement
// (montant avant le verbe, par exemple), un natif l'indique dans data/audio/<langue>/plans.json,
// sans toucher au code : { "balance": ["$balance", "balance_is"] }.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { ReplyKind } from '../core/respond.ts';
import { fileURLToPath } from 'node:url';

export interface Phrase { key: string; fr: string; group: string; priority: 1 | 2; note?: string }

const FR_UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const FR_TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingts', 'quatre-vingt-dix'];

/** Catalogue unique des phrases à enregistrer : le script d'enregistrement est généré à partir d'ici. */
export const PHRASES: Phrase[] = [
  // Appel vocal
  { key: 'ivr_speak', group: 'Serveur vocal', priority: 1, fr: 'Dites votre demande après le bip. Par exemple : envoyer cinq mille francs à Marie. Ou tapez zéro pour réécouter.' },
  { key: 'ivr_again', group: 'Serveur vocal', priority: 1, fr: 'Autre chose ? Parlez après le bip, ou raccrochez.' },
  { key: 'ivr_heard_nothing', group: 'Serveur vocal', priority: 2, fr: 'Je n’ai rien entendu. Parlez plus près du téléphone.' },
  { key: 'press_1_confirm', group: 'Serveur vocal', priority: 1, fr: 'Tapez 1 pour confirmer.' },
  { key: 'press_2_cancel', group: 'Serveur vocal', priority: 1, fr: 'Tapez 2 pour annuler.' },
  { key: 'press_1', group: 'Serveur vocal', priority: 1, fr: 'Tapez 1 pour…', note: 'suivi du nom d’une personne' },
  { key: 'press_2', group: 'Serveur vocal', priority: 1, fr: 'Tapez 2 pour…', note: 'suivi du nom d’une personne' },
  { key: 'press_3', group: 'Serveur vocal', priority: 2, fr: 'Tapez 3 pour…', note: 'suivi du nom d’une personne' },
  { key: 'press_4', group: 'Serveur vocal', priority: 2, fr: 'Tapez 4 pour…', note: 'suivi du nom d’une personne' },
  // Solde, frais
  { key: 'balance_is', group: 'Solde et frais', priority: 1, fr: 'Votre solde disponible est de…', note: 'suivi d’un montant' },
  { key: 'fee_to_send', group: 'Solde et frais', priority: 1, fr: 'Pour envoyer…', note: 'suivi d’un montant' },
  { key: 'fee_fees_are', group: 'Solde et frais', priority: 1, fr: '…les frais sont de…', note: 'entre deux montants' },
  { key: 'fee_total', group: 'Solde et frais', priority: 1, fr: 'Total retiré de votre compte :…', note: 'suivi d’un montant' },
  // Transfert
  { key: 'ask_amount', group: 'Transfert', priority: 1, fr: 'Quel montant voulez-vous envoyer ?' },
  { key: 'ask_beneficiary', group: 'Transfert', priority: 1, fr: 'À qui voulez-vous envoyer l’argent ? Donnez un nom.' },
  { key: 'ask_which', group: 'Transfert', priority: 1, fr: 'Plusieurs personnes portent ce nom. Laquelle ?' },
  { key: 'corrected', group: 'Transfert', priority: 1, fr: 'C’est corrigé.' },
  { key: 'confirm_send', group: 'Transfert', priority: 1, fr: 'Vous allez envoyer…', note: 'suivi d’un montant' },
  { key: 'word_to', group: 'Transfert', priority: 1, fr: '…à…', note: 'entre le montant et le nom de la personne qui reçoit' },
  { key: 'word_fee', group: 'Transfert', priority: 1, fr: 'Frais :…', note: 'suivi d’un montant' },
  { key: 'word_total', group: 'Transfert', priority: 1, fr: 'Total :…', note: 'suivi d’un montant' },
  { key: 'confirm_q', group: 'Transfert', priority: 1, fr: 'Confirmez-vous ?' },
  { key: 'done_transfer', group: 'Transfert', priority: 1, fr: 'Transfert réussi :…', note: 'suivi d’un montant' },
  { key: 'word_sent_to', group: 'Transfert', priority: 1, fr: '…envoyés à…', note: 'entre le montant et le nom' },
  { key: 'word_new_balance', group: 'Transfert', priority: 1, fr: 'Nouveau solde :…', note: 'suivi d’un montant' },
  { key: 'cancelled', group: 'Transfert', priority: 1, fr: 'Opération annulée. Aucun argent n’a été envoyé.' },
  // Solde insuffisant, plafond
  { key: 'insufficient', group: 'Solde insuffisant', priority: 1, fr: 'Solde insuffisant.' },
  { key: 'word_you_have', group: 'Solde insuffisant', priority: 1, fr: 'Vous avez…', note: 'suivi d’un montant' },
  { key: 'word_needed', group: 'Solde insuffisant', priority: 1, fr: 'Il faut…', note: 'suivi d’un montant' },
  { key: 'incl_fees', group: 'Solde insuffisant', priority: 1, fr: '…frais compris.', note: 'après un montant' },
  { key: 'word_missing', group: 'Solde insuffisant', priority: 1, fr: 'Il manque…', note: 'suivi d’un montant' },
  { key: 'nothing_done', group: 'Solde insuffisant', priority: 1, fr: 'Aucune opération n’a été effectuée.' },
  { key: 'limit_exceeded', group: 'Solde insuffisant', priority: 2, fr: 'Ce montant dépasse votre plafond par jour, qui est de…', note: 'suivi d’un montant' },
  // Historique
  { key: 'history_intro', group: 'Historique', priority: 1, fr: 'Vos dernières opérations :' },
  { key: 'hist_transfer_out', group: 'Historique', priority: 1, fr: 'Envoi de…', note: 'suivi d’un montant puis d’un nom' },
  { key: 'hist_transfer_in', group: 'Historique', priority: 1, fr: 'Reçu…', note: 'suivi d’un montant puis d’un nom' },
  { key: 'hist_bill', group: 'Historique', priority: 1, fr: 'Facture de…', note: 'suivi d’un montant puis d’un nom' },
  { key: 'hist_airtime', group: 'Historique', priority: 2, fr: 'Crédit de…', note: 'suivi d’un montant' },
  { key: 'hist_deposit', group: 'Historique', priority: 2, fr: 'Dépôt de…', note: 'suivi d’un montant' },
  // Crédit et factures
  { key: 'confirm_airtime', group: 'Crédit et factures', priority: 2, fr: 'Acheter du crédit de communication de…', note: 'suivi d’un montant' },
  { key: 'airtime_no_fee', group: 'Crédit et factures', priority: 2, fr: 'Sans frais.' },
  { key: 'done_airtime', group: 'Crédit et factures', priority: 2, fr: 'Crédit envoyé :…', note: 'suivi d’un montant' },
  { key: 'confirm_bill', group: 'Crédit et factures', priority: 2, fr: 'Payer la facture…', note: 'suivi du nom (ENEO…) puis d’un montant' },
  { key: 'done_bill', group: 'Crédit et factures', priority: 2, fr: 'Facture payée :…', note: 'suivi du nom puis d’un montant' },
  // Conversation
  { key: 'greeting', group: 'Conversation', priority: 1, fr: 'Bonjour ! Que voulez-vous faire ? Solde, transfert, frais ou historique.' },
  { key: 'ask_intent', group: 'Conversation', priority: 1, fr: 'Je n’ai pas bien compris. Voulez-vous voir votre solde, envoyer de l’argent, connaître les frais ou voir votre historique ?' },
  { key: 'not_understood', group: 'Conversation', priority: 1, fr: 'Je n’ai pas compris. Pouvez-vous répéter autrement ?' },
  { key: 'switched', group: 'Conversation', priority: 1, fr: 'D’accord, on continue dans cette langue.' },
  { key: 'help', group: 'Conversation', priority: 2, fr: 'Je peux : donner votre solde, envoyer de l’argent, expliquer les frais, montrer l’historique, acheter du crédit, payer une facture.' },
  { key: 'backend_error', group: 'Conversation', priority: 2, fr: 'Le service est momentanément indisponible. Aucune opération n’a été effectuée. Réessayez.' },
  // Explications de termes
  { key: 'term_fees', group: 'Explications', priority: 1, fr: 'Les frais sont la somme que le service prend en plus du montant envoyé. Par exemple, pour envoyer dix mille francs avec cent francs de frais, dix mille cent francs sont retirés de votre compte.' },
  { key: 'term_balance', group: 'Explications', priority: 2, fr: 'Le solde est l’argent disponible sur votre compte en ce moment.' },
  { key: 'term_transfer', group: 'Explications', priority: 2, fr: 'Un transfert, c’est envoyer de l’argent de votre compte vers celui d’une autre personne.' },
  { key: 'term_beneficiary', group: 'Explications', priority: 2, fr: 'Le bénéficiaire est la personne qui reçoit l’argent. Vérifiez toujours son nom et son numéro.' },
  { key: 'term_pin', group: 'Explications', priority: 1, fr: 'Le code PIN est votre code secret. Ne le donnez jamais à personne, même à un agent.' },
  { key: 'term_history', group: 'Explications', priority: 2, fr: 'L’historique est la liste de vos dernières opérations : argent reçu, envoyé ou payé.' },
  { key: 'term_airtime', group: 'Explications', priority: 2, fr: 'Le crédit de communication sert à appeler, envoyer des SMS ou utiliser internet.' },
  { key: 'term_bill', group: 'Explications', priority: 2, fr: 'Une facture est une somme à payer pour un service, comme l’électricité ou l’eau.' },
  { key: 'term_limit', group: 'Explications', priority: 2, fr: 'Le plafond est le montant maximum que vous pouvez envoyer par jour.' },
  // Montants
  { key: 'fcfa', group: 'Montants', priority: 1, fr: 'francs CFA', note: 'dit après chaque montant' },
  { key: 'n_and', group: 'Montants', priority: 2, fr: 'et', note: 'FACULTATIF : seulement si votre langue relie les parties d’un nombre (ex. « cent mille ET quarante mille »)' },
  ...numberPhrases(),
  // Noms (données de démonstration)
  ...['Paul Mbarga', 'Paul Ekwalla', 'Marie Ngo Bassa', 'Aminatou Bello', 'ENEO', 'CAMWATER', 'CANAL'].map((n): Phrase => ({ key: nameKey(n), group: 'Noms', priority: 1, fr: n, note: 'dit comme on le prononce dans la langue' })),
];

function numberPhrases(): Phrase[] {
  const out: Phrase[] = [];
  const w = (d: number, p: number): string => {
    if (p === 0) return FR_UNITS[d];
    if (p === 1) return FR_TENS[d];
    if (p === 2) return d === 1 ? 'cent' : `${FR_UNITS[d]} cents`;
    if (p === 3) return d === 1 ? 'mille' : `${FR_UNITS[d]} mille`;
    if (p === 4) return `${FR_TENS[d]} mille`;
    return d === 1 ? 'cent mille' : `${FR_UNITS[d]} cent mille`;
  };
  // Priorité 1 : ce qu'il faut pour les montants de la démonstration (solde 150 000, transferts, frais).
  const demo = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000, 30000, 40000, 50000, 100000]);
  for (let p = 0; p <= 5; p++) for (let d = 1; d <= 9; d++) {
    const v = d * 10 ** p;
    out.push({ key: `n_${v}`, group: 'Montants', priority: demo.has(v) ? 1 : 2, fr: w(d, p) });
  }
  return out;
}

export function nameKey(name: string): string {
  return 'name_' + name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Montant → clips : chaque partie non nulle (centaines de mille, dizaines de mille, milliers,
 *  centaines, dizaines, unités), reliées par « et » si la langue l'a enregistré, puis « francs CFA ». */
export function amountClips(n: number): string[] {
  if (!Number.isInteger(n) || n <= 0 || n >= 1_000_000) return ['n_unsupported'];
  const parts: string[] = [];
  let p = 0, rest = n;
  while (rest > 0) { const d = rest % 10; if (d) parts.unshift(`n_${d * 10 ** p}`); rest = Math.floor(rest / 10); p++; }
  return [...parts.flatMap((k, i) => (i ? ['?n_and', k] : [k])), 'fcfa'];
}

type Vars = Record<string, number | string | undefined>;
const DEFAULT_PLANS: Record<string, string[]> = {
  balance: ['balance_is', '$balance'],
  fee_quote: ['fee_to_send', '$amount', 'fee_fees_are', '$fee', 'fee_total', '$total'],
  ask_amount: ['ask_amount'],
  ask_beneficiary: ['ask_beneficiary'],
  ask_which_beneficiary: ['ask_which'],
  ask_intent: ['ask_intent'],
  confirm_transfer: ['?corrected', 'confirm_send', '$amount', 'word_to', '$beneficiary', 'word_fee', '$fee', 'word_total', '$total', 'confirm_q'],
  transfer_done: ['done_transfer', '$amount', 'word_sent_to', '$counterparty', 'word_new_balance', '$balance'],
  confirm_airtime: ['confirm_airtime', '$amount', 'airtime_no_fee', 'confirm_q'],
  airtime_done: ['done_airtime', '$amount', 'word_new_balance', '$balance'],
  confirm_bill: ['confirm_bill', '$biller', '$amount', 'word_fee', '$fee', 'word_total', '$total', 'confirm_q'],
  bill_done: ['done_bill', '$counterparty', '$amount', 'word_new_balance', '$balance'],
  insufficient: ['insufficient', 'word_you_have', '$balance', 'word_needed', '$required', 'incl_fees', 'word_missing', '$missing', 'nothing_done'],
  limit_exceeded: ['limit_exceeded', '$limit'],
  history_item: ['$hist', '$amount', '$counterparty'],
  explain: ['$term'],
  cancelled: ['cancelled'], language_switched: ['switched'], help: ['help'], greeting: ['greeting'], not_understood: ['not_understood'], backend_error: ['backend_error'],
};
const AMOUNT_VARS = new Set(['balance', 'amount', 'fee', 'total', 'required', 'missing', 'limit']);

const AUDIO_ROOT = (process.env.CT_AUDIO_DIR ?? fileURLToPath(new URL('../../data/audio/', import.meta.url))).replace(/\/?$/, '/');
const EXTS = ['wav', 'ogg', 'opus', 'm4a', 'mp3', 'webm', 'aac'];
const KEY_RE = /^\??[a-z0-9_]+$/;

function plansFor(lang: string): Record<string, string[]> {
  const f = `${AUDIO_ROOT}${lang}/plans.json`;
  if (!existsSync(f)) return DEFAULT_PLANS;
  try { return { ...DEFAULT_PLANS, ...JSON.parse(readFileSync(f, 'utf8')) }; } catch { return DEFAULT_PLANS; }
}

function expand(plan: string[], v: Vars): string[] {
  const out: string[] = [];
  for (const step of plan) {
    if (!step.startsWith('$')) { out.push(step); continue; }
    const name = step.slice(1), val = v[name];
    if (val === undefined || val === '') continue;
    if (AMOUNT_VARS.has(name)) out.push(...amountClips(Number(val)));
    else if (name === 'term') out.push(`term_${val}`);
    else if (name === 'hist') out.push(`hist_${val}`);
    else out.push(nameKey(String(val)));
  }
  return out;
}

/** Suite de clips qui dit cette réponse dans cette langue (sans vérifier qu'ils existent). */
export function speechPlan(r: ReplyKind, lang: string): string[] {
  const plans = plansFor(lang);
  switch (r.kind) {
    case 'confirm_transfer': return expand(plans.confirm_transfer, { ...r }).filter((k) => r.corrected || k !== '?corrected').map((k) => (k === '?corrected' ? 'corrected' : k));
    case 'transfer_done': case 'airtime_done': case 'bill_done':
      return expand(plans[r.kind], { amount: r.tx.amount, counterparty: r.tx.counterparty, balance: r.balance });
    case 'history':
      return ['history_intro', ...r.items.slice(0, 4).flatMap((t) => expand(plans.history_item, { hist: t.type, amount: t.amount, counterparty: t.counterparty }))];
    case 'explain': return expand(plans.explain, { term: r.term });
    default: return expand(plans[r.kind] ?? ['not_understood'], r as unknown as Vars);
  }
}

// --- Fichiers ---------------------------------------------------------------------------------

export function clipFile(lang: string, key: string): string | null {
  for (const e of EXTS) { const f = `${AUDIO_ROOT}${lang}/${key}.${e}`; if (existsSync(f)) return f; }
  return null;
}

/** Clés obligatoires absentes (les clés « ?… » sont facultatives). */
export function missingClips(lang: string, plan: string[]): string[] {
  if (!/^[a-z]{2,3}$/.test(lang)) return plan.filter((k) => !k.startsWith('?'));
  return [...new Set(plan.filter((k) => !k.startsWith('?') && !clipFile(lang, k)))];
}
export const hasNativeVoice = (lang: string, plan: string[]) => plan.length > 0 && missingClips(lang, plan).length === 0;

/** Ce qui est enregistré pour une langue, par rapport au catalogue. */
export function coverage(lang: string) {
  const dir = `${AUDIO_ROOT}${lang}`;
  const files = existsSync(dir) ? readdirSync(dir) : [];
  const have = (k: string) => files.some((f) => f.startsWith(k + '.') && EXTS.includes(f.slice(k.length + 1)));
  const p1 = PHRASES.filter((p) => p.priority === 1 && p.key !== 'n_and');
  return {
    lang,
    recorded: PHRASES.filter((p) => have(p.key)).length,
    total: PHRASES.length,
    priority1: { recorded: p1.filter((p) => have(p.key)).length, total: p1.length },
    missingPriority1: p1.filter((p) => !have(p.key)).map((p) => p.key),
  };
}

type Decode = (bytes: Uint8Array) => Promise<{ samples: Float32Array; sampleRate: number }>;
const decoded = new Map<string, { mtime: number; samples: Float32Array }>();

/** Coupe le silence au début et à la fin, et ramène le volume à un niveau commun. */
function tidy(s: Float32Array): Float32Array {
  let peak = 0; for (const x of s) peak = Math.max(peak, Math.abs(x));
  if (peak < 1e-4) return new Float32Array(0);
  const thr = peak * 0.04, pad = 1600; // 100 ms gardées de chaque côté
  let a = 0, b = s.length - 1;
  while (a < b && Math.abs(s[a]) < thr) a++;
  while (b > a && Math.abs(s[b]) < thr) b--;
  const out = s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad));
  const g = 0.85 / peak; for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

/** Assemble les clips en un seul audio 16 kHz. Renvoie null si un clip obligatoire manque. */
export async function assemble(lang: string, plan: string[], decode: Decode): Promise<Float32Array | null> {
  if (!/^[a-z]{2,3}$/.test(lang) || !plan.every((k) => KEY_RE.test(k)) || missingClips(lang, plan).length) return null;
  const gap = new Float32Array(1600 * 1.5); // 150 ms entre deux morceaux
  const pieces: Float32Array[] = [];
  for (const k of plan) {
    const f = clipFile(lang, k.replace(/^\?/, ''));
    if (!f) continue; // clip facultatif absent
    const mtime = statSync(f).mtimeMs;
    let c = decoded.get(f);
    if (!c || c.mtime !== mtime) { c = { mtime, samples: tidy((await decode(new Uint8Array(readFileSync(f)))).samples) }; decoded.set(f, c); }
    if (pieces.length) pieces.push(gap);
    pieces.push(c.samples);
  }
  const out = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of pieces) { out.set(p, o); o += p.length; }
  return out;
}
