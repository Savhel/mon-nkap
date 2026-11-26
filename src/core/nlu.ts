// Compréhension des requêtes financières : intention + paramètres (montant, bénéficiaire, etc.).
// Approche par lexiques versionnés (data/lexicons/*.json), sans modèle entraîné :
// chaque mot-clé ajouté par un linguiste est immédiatement pris en compte, et chaque décision
// est explicable au jury (mots reconnus, score).

import { readFileSync } from 'node:fs';
import type { Contact } from '../backend/types.ts';
import { extractAmounts, extractPhones } from './amounts.ts';
import { findPhrase, levenshtein, normalize, phraseDistance, tokens, tolerance, wordMatches } from './text.ts';
import { numeralizeFor, runtimeFor } from '../linguistics/runtime.ts';

export const INTENTS = ['balance', 'transfer', 'fees', 'history', 'airtime', 'bill_payment', 'withdraw', 'explain_term', 'help', 'greeting'] as const;
export type Intent = (typeof INTENTS)[number];

export interface Lexicon {
  status: 'available' | 'draft';
  intents: Record<Intent, string[]>;
  confirm: string[];
  deny: string[];
  correction: string[];
  beneficiaryMarkers: string[];
  terms: Record<string, string>;
  possessives?: string[];
}

export interface Interpretation {
  intent: Intent | null;
  confidence: number;
  scores: Partial<Record<Intent, number>>;
  matched: string[];
  amounts: number[];
  phone?: string;
  beneficiaryCandidates: Contact[];
  beneficiaryText?: string;
  biller?: string;
  term?: string;
  isConfirm: boolean;
  isDeny: boolean;
  isCorrection: boolean;
  switchTo?: string;
}

const lexiconCache = new Map<string, Lexicon | null>();
/**
 * Lexique d'une langue = lexique de base (data/lexicons/<lang>.json, brouillon pour les langues nationales)
 * + pack des natifs (data/packs/<lang>.json : mots validés et expressions apprises sur leurs phrases).
 * La langue n'est « available » que si le pack couvre tous les concepts indispensables et tous ses nombres.
 */
export function loadLexicon(lang: string): Lexicon | null {
  if (!lexiconCache.has(lang)) {
    let base: Lexicon | null = null;
    try { base = JSON.parse(readFileSync(new URL(`../../data/lexicons/${lang}.json`, import.meta.url), 'utf8')); } catch { base = null; }
    const pack = runtimeFor(lang)?.lexicon;
    if (pack && (base || Object.values(pack.intents).some((x) => x.length))) {
      const b: Lexicon = base ?? { status: 'draft', intents: {} as Lexicon['intents'], confirm: [], deny: [], correction: [], beneficiaryMarkers: [], terms: {} };
      const intents = { ...b.intents } as Record<string, string[]>;
      for (const [k, v] of Object.entries(pack.intents)) intents[k] = [...new Set([...(intents[k] ?? []), ...v])];
      base = {
        ...b, intents: intents as Lexicon['intents'],
        status: pack.complete ? 'available' : b.status,
        confirm: [...new Set([...b.confirm, ...pack.confirm])], deny: [...new Set([...b.deny, ...pack.deny])],
        correction: [...new Set([...b.correction, ...pack.correction])],
        terms: { ...b.terms, ...pack.terms }, possessives: [...(b.possessives ?? []), ...pack.possessives],
      };
    }
    lexiconCache.set(lang, base);
  }
  return lexiconCache.get(lang) ?? null;
}
export function clearLexiconCache(): void { lexiconCache.clear(); }

const LANGUAGE_NAMES: Record<string, string[]> = {
  fr: ['francais', 'french'], en: ['anglais', 'english'], ewo: ['ewondo'], dua: ['duala', 'douala'],
  fub: ['fulfulde', 'foulfoulde', 'peul', 'fulani'], wes: ['pidgin', 'kamtok'], bas: ['bassa', 'basaa'], bum: ['bulu', 'boulou'],
};
const SWITCH_MARKERS = ['parle', 'parlez', 'en', 'in', 'langue', 'language', 'speak', 'talk', 'change', 'passe', 'continue', 'continuer', 'tok'];
const BILLERS: Record<string, string[]> = { ENEO: ['eneo', 'electricite', 'courant', 'electricity', 'light'], CAMWATER: ['camwater', 'eau', 'water'], CANAL: ['canal', 'canal plus'] };

function anyPhrase(toks: string[], list: string[]): string | undefined {
  return list.find((p) => findPhrase(toks, p) >= 0);
}

function matchContacts(toks: string[], contacts: Contact[]): { candidates: Contact[]; text?: string } {
  let best = 0;
  let out: Contact[] = [];
  let text: string | undefined;
  for (const c of contacts) {
    const parts = tokens(c.name);
    let score = 0;
    const hits: string[] = [];
    for (const p of parts) {
      if (p.length < 3) continue;
      // Les noms propres sont mal transcrits par l'ASR (« amonado » pour « Aminatou ») : tolérance plus
      // large (40 %), même première lettre. Le nom complet et le numéro sont toujours confirmés.
      const hit = toks.find((t) => wordMatches(t, p) || (p.length >= 5 && t.length >= 4 && t[0] === p[0] && levenshtein(t, p) <= Math.floor(p.length * 0.4)));
      if (hit) { score++; hits.push(hit); }
    }
    if (score > best) { best = score; out = [c]; text = hits.join(' '); }
    else if (score === best && score > 0) out.push(c);
  }
  return { candidates: out, text };
}

export function interpret(text: string, lang: string, contacts: Contact[] = []): Interpretation {
  const toks = tokens(text);
  // Code-switching : on écoute toujours le lexique de la langue choisie, plus le français et l'anglais.
  const lexes = [...new Set([lang, 'fr', 'en'])].map((l) => [l, loadLexicon(l)] as const).filter((x): x is readonly [string, Lexicon] => x[1] !== null);

  const scores: Partial<Record<Intent, number>> = {};
  const matched: string[] = [];
  for (const [l, lex] of lexes) {
    const weight = l === lang ? 1 : 0.8;
    for (const intent of INTENTS) {
      for (const phrase of lex.intents[intent] ?? []) {
        if (findPhrase(toks, phrase) >= 0) {
          const s = weight * tokens(phrase).length;
          if (s > (scores[intent] ?? 0) - 1e-9) matched.push(`${intent}:${phrase}`);
          scores[intent] = Math.max(scores[intent] ?? 0, s) + 0.01;
        }
      }
    }
  }

  // Montants dits avec les mots de la langue (grammaire apprise des natifs) → chiffres, puis extraction habituelle.
  const amounts = extractAmounts(numeralizeFor(lang, text)).map((a) => a.value);
  const phone = extractPhones(text)[0];
  const { candidates, text: beneficiaryText } = matchContacts(toks, contacts);
  // Fournisseur : mot exact seulement (la tolérance aux fautes faisait de « coûtent » un « courant », donc ENEO).
  const exact = (k: string) => { const p = tokens(k); return toks.some((_, i) => p.every((w, j) => toks[i + j] === w)); };
  const biller = Object.entries(BILLERS).find(([, kws]) => kws.some(exact))?.[0];

  // Indices structurels : un montant + un bénéficiaire sans verbe reconnu évoque un transfert.
  if (!scores.transfer && amounts.length && (candidates.length || phone) && !scores.airtime && !scores.bill_payment) scores.transfer = 0.6;
  // "frais" l'emporte sur "transfert" dans "combien coûtent les frais d'un transfert".
  if (scores.fees && scores.transfer) scores.fees += 0.5;
  let term: string | undefined;
  for (const [, lex] of lexes) {
    for (const [word, key] of Object.entries(lex.terms)) if (findPhrase(toks, word) >= 0) { term = key; break; }
    if (term) break;
  }

  // « C'est quoi les frais ? » demande une explication ; « c'est quoi MON solde ? » demande une donnée.
  const nativePossessives = new Set(lexes.flatMap(([, lex]) => (lex.possessives ?? []).flatMap((p) => tokens(p))));
  const possessive = toks.some((t) => ['mon', 'ma', 'mes', 'my', 'wo', 'maa', 'mwao'].includes(t) || nativePossessives.has(t));
  if (scores.explain_term && (!term || possessive)) delete scores.explain_term;
  if (scores.explain_term) for (const k of Object.keys(scores) as Intent[]) if (k !== 'explain_term') scores[k] = (scores[k] ?? 0) * 0.5;

  // « Oui » ou « non » : avec la tolérance aux fautes, les deux peuvent être entendus à la fois. En fulfulde,
  // « mi djabbi » (je confirme) et « mi djabbay » (j'annule) ne diffèrent que par la fin, et la reconnaissance
  // vocale a rendu « annuler » par « mijabai », pris pour un oui. On garde le plus proche, et un oui n'est
  // retenu que s'il est NETTEMENT plus proche (2 lettres d'écart au moins). Dans le doute, rien n'est confirmé.
  // Seules comptent les expressions réellement proches (tolérance + 1) : « no », très court, est à deux
  // lettres de presque tout mot court et ne doit pas bloquer un « mi jabbi ».
  const nearest = (pick: (l: Lexicon) => string[]) => Math.min(Infinity, ...lexes.flatMap(([, lex]) => pick(lex).map((p) => {
    const d = phraseDistance(toks, p);
    return d <= tolerance(p.replace(/\s+/g, '')) + 1 ? d : Infinity;
  })));
  const confirmHeard = lexes.some(([, lex]) => anyPhrase(toks, lex.confirm) !== undefined);
  const denyHeard = lexes.some(([, lex]) => anyPhrase(toks, lex.deny) !== undefined);
  const clearlyYes = confirmHeard && nearest((l) => l.deny) - nearest((l) => l.confirm) >= 2;
  const isConfirm = clearlyYes || /^(1|oui|yes)$/.test(normalize(text));
  const isDeny = (denyHeard && !clearlyYes) || /^(2|non|no)$/.test(normalize(text));
  const isCorrection = lexes.some(([, lex]) => anyPhrase(toks, lex.correction) !== undefined);

  let switchTo: string | undefined;
  if (toks.some((t) => SWITCH_MARKERS.includes(t))) {
    for (const [code, names] of Object.entries(LANGUAGE_NAMES)) if (names.some((n) => toks.some((t) => wordMatches(t, n)))) switchTo = code;
  }

  const ranked = (Object.entries(scores) as [Intent, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const intent = top && top[1] >= 0.5 ? top[0] : null;
  const confidence = !top ? 0 : Math.min(1, top[1] / ((second?.[1] ?? 0) + top[1]));

  return { intent, confidence, scores, matched, amounts, phone, beneficiaryCandidates: candidates, beneficiaryText, biller, term, isConfirm, isDeny, isCorrection, switchTo };
}
