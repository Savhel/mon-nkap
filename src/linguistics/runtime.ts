// Ressources dérivées d'un pack de langue, prêtes pour le moteur :
// - grammaire des nombres (apprise sur les montants écrits par les natifs) ;
// - lexique de compréhension : mots du lexique natif + expressions DISCRIMINANTES apprises sur les phrases
//   d'ENTRAÎNEMENT des natifs (les phrases de test ne servent jamais à apprendre) ;
// - réponses et définitions rédigées par les natifs.
// Tout est explicable : chaque mot appris est listé avec l'intention qu'il signale et sa fréquence.

import { tokens } from '../core/text.ts';
import { learnGrammar, numeralize, type NumberGrammar } from './numbers.ts';
import { loadPack, usable, type LangPack } from './pack.ts';

/** Intentions canoniques (représentation commune) → intentions internes du moteur. */
export const CANONICAL_TO_ENGINE: Record<string, string> = {
  CONSULT_BALANCE: 'balance', TRANSFER_MONEY: 'transfer', CHECK_FEES: 'fees', VIEW_HISTORY: 'history',
  BUY_AIRTIME: 'airtime', PAY_BILL: 'bill_payment', WITHDRAW_MONEY: 'withdraw', EXPLAIN_TERM: 'explain_term',
  GREETING: 'greeting', HELP: 'help',
};
export const ENGINE_TO_CANONICAL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CANONICAL_TO_ENGINE).map(([k, v]) => [v, k])),
  confirm: 'CONFIRM', cancel: 'CANCEL', correction: 'CORRECT', language_switch: 'SWITCH_LANGUAGE', choose: 'CHOOSE_OPTION',
};

const CONCEPT_INTENTS: Record<string, string[]> = {
  balance: ['balance'], transfer: ['send'], fees: ['fees', 'cost'], history: ['history'], airtime: ['airtime'],
  bill_payment: ['bill', 'electricity', 'water'], withdraw: ['withdraw'], help: ['help'], greeting: ['hello'], explain_term: ['what_is'],
};
const CONCEPT_TERMS: Record<string, string> = { fees: 'fees', balance: 'balance', send: 'transfer', airtime: 'airtime', bill: 'bill', pin: 'pin', history: 'history', withdraw: 'withdraw' };
// Noms et fournisseurs des situations : jamais appris comme mots d'intention.
const NOT_KEYWORDS = new Set(['marie', 'paul', 'aminatou', 'eneo', 'camwater', 'fcfa', 'cfa', 'franc', 'francs']);

export interface LearnedPhrase { phrase: string; intent: string; count: number; precision: number }
export interface PackLexicon {
  intents: Record<string, string[]>;
  confirm: string[]; deny: string[]; correction: string[]; possessives: string[];
  terms: Record<string, string>;
  learned: LearnedPhrase[];
  complete: boolean; // les concepts indispensables sont tous validés et les nombres sont tous reconstruits
}

export interface LangRuntime { pack: LangPack; grammar: NumberGrammar; lexicon: PackLexicon }

const forms = (p: LangPack, id: string) => (p.concepts[id] ?? []).filter(usable).map((e) => e.text);

/** Expressions (1 ou 2 mots) très associées à une intention dans les phrases d'entraînement des natifs. */
export function learnPhrases(p: LangPack, grammar: NumberGrammar): LearnedPhrase[] {
  const numberWords = new Set(Object.keys(grammar.words).flatMap((w) => w.split(' ')));
  const train = p.utterances.filter((u) => u.split === 'train' && usable(u));
  const byPhrase = new Map<string, Map<string, number>>();
  for (const u of train) {
    const t = tokens(u.text).filter((w) => !/^\d+$/.test(w));
    const grams = new Set<string>();
    t.forEach((w, i) => { grams.add(w); if (i + 1 < t.length) grams.add(`${w} ${t[i + 1]}`); });
    for (const g of grams) {
      if (g.split(' ').some((w) => NOT_KEYWORDS.has(w) || numberWords.has(w)) || g.replace(/ /g, '').length < 3) continue;
      const m = byPhrase.get(g) ?? new Map<string, number>();
      m.set(u.intent, (m.get(u.intent) ?? 0) + 1);
      byPhrase.set(g, m);
    }
  }
  const out: LearnedPhrase[] = [];
  for (const [phrase, m] of byPhrase) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [intent, count] = [...m].sort((a, b) => b[1] - a[1])[0];
    const precision = count / total;
    if (count >= 2 && precision >= 0.8) out.push({ phrase, intent, count, precision: Number(precision.toFixed(2)) });
  }
  return out.sort((a, b) => b.count - a.count);
}

function buildLexicon(p: LangPack, grammar: NumberGrammar): PackLexicon {
  const learned = learnPhrases(p, grammar);
  const intents: Record<string, string[]> = {};
  for (const [intent, concepts] of Object.entries(CONCEPT_INTENTS)) intents[intent] = concepts.flatMap((c) => forms(p, c));
  const confirm = [...forms(p, 'yes'), ...forms(p, 'confirm')];
  const deny = [...forms(p, 'no'), ...forms(p, 'cancel')];
  const correction = [...forms(p, 'correction')];
  for (const l of learned) {
    const engine = CANONICAL_TO_ENGINE[l.intent];
    if (engine) (intents[engine] ??= []).push(l.phrase);
    else if (l.intent === 'CONFIRM') confirm.push(l.phrase);
    else if (l.intent === 'CANCEL') deny.push(l.phrase);
    else if (l.intent === 'CORRECT') correction.push(l.phrase);
  }
  const terms: Record<string, string> = {};
  for (const [c, key] of Object.entries(CONCEPT_TERMS)) for (const f of forms(p, c)) terms[f] = key;
  const core = ['yes', 'no', 'send', 'balance', 'fees', 'history', 'cancel', 'correction'];
  const complete = core.every((c) => (p.concepts[c] ?? []).some((e) => e.validated)) && grammar.failures.length === 0 && Object.keys(grammar.words).length > 0;
  return { intents, confirm, deny, correction, possessives: forms(p, 'my'), terms, learned, complete };
}

const cache = new Map<string, LangRuntime | null>();
export function runtimeFor(lang: string): LangRuntime | null {
  if (!cache.has(lang)) {
    const pack = loadPack(lang);
    if (!pack) { cache.set(lang, null); return null; }
    const grammar = learnGrammar(pack.numbers.filter(usable).map((n) => ({ value: n.value, text: n.text, validated: n.validated })));
    cache.set(lang, { pack, grammar, lexicon: buildLexicon(pack, grammar) });
  }
  return cache.get(lang) ?? null;
}
export function clearRuntimeCache(): void { cache.clear(); }

/** Texte où les montants dits en langue nationale sont remplacés par des chiffres (le reste est inchangé). */
export function numeralizeFor(lang: string, text: string): string {
  const rt = runtimeFor(lang);
  return rt && Object.keys(rt.grammar.words).length ? numeralize(text, rt.grammar) : text;
}
