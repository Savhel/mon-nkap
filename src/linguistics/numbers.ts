// Grammaire des nombres d'une langue, APPRISE à partir des montants écrits par les natifs (collecte/<lang>/nombres.csv).
//
// - Les montants « atomiques » (1 à 19, dizaines, 100, 1 000, 1 000 000) donnent le vocabulaire.
// - Les montants composés (5 000, 25 000, 150 000…) servent à CHOISIR l'ordre de composition et à le vérifier :
//     additif                 : « cinq mille » = 5 × 1000 (français, anglais, pidgin)
//     multiplicateur d'abord  : « mille cinq » = 1000 × 5 (fréquent dans les langues bantoues)
// - Les mots qui reviennent dans les montants composés sans être des nombres sont des liaisons (« et », « na »…).
// - Tout montant écrit par un natif que la grammaire ne reconstruit pas est listé dans `failures` : on ne devine pas.
//   Un linguiste peut alors ajouter une règle ; la langue n'est déclarée « nombres pris en charge » que si
//   failures est vide.

import { tokens } from '../core/text.ts';

export interface NumberEntry { value: number; text: string; validated: boolean }
export type NumberOrder = 'additive' | 'multiplier_first';

export interface NumberGrammar {
  words: Record<string, number>;      // expression normalisée → valeur
  connectors: string[];               // mots de liaison à ignorer entre deux nombres
  order: NumberOrder;
  checked: number;                    // montants composés vérifiés
  failures: { value: number; text: string; got: number | null }[];
  ambiguous: string[];                // une même expression donnée pour deux valeurs différentes : écartée
  validatedOnly: boolean;
}

const MULTIPLIERS = new Set([100, 1000, 1_000_000]);
const isAtomic = (v: number) => v <= 19 || (v < 100 && v % 10 === 0) || MULTIPLIERS.has(v);

type Seg = { v: number; digits?: true; word?: string } | { c: string } | { other: string };

/** Découpe une suite de jetons en expressions numériques connues (la plus longue d'abord). */
function segment(toks: string[], words: Record<string, number>, connectors: Set<string>): Seg[] {
  const phrases = Object.keys(words).map((p) => p.split(' ')).sort((a, b) => b.length - a.length);
  const out: Seg[] = [];
  for (let i = 0; i < toks.length;) {
    if (/^\d+$/.test(toks[i])) { out.push({ v: Number(toks[i]), digits: true }); i++; continue; }
    const hit = phrases.find((p) => p.every((w, k) => toks[i + k] === w));
    if (hit) { out.push({ v: words[hit.join(' ')], word: hit.join(' ') }); i += hit.length; continue; }
    if (connectors.has(toks[i])) { out.push({ c: toks[i] }); i++; continue; }
    out.push({ other: toks[i] }); i++;
  }
  return out;
}

/** Suite à composer : des nombres, et « + » pour une liaison (« et », « na »…) placée entre deux nombres. */
export type Item = number | '+';

/**
 * Valeur d'une suite de nombres selon l'ordre de composition.
 * - additif : la liaison est une simple colle (« vingt et un »).
 * - multiplicateur d'abord : « M q » = M × q ; « M + q » = M + q (la liaison marque l'addition).
 */
export function compose(items: Item[], order: NumberOrder): number | null {
  const vals = items.filter((x): x is number => x !== '+');
  if (!vals.length) return null;
  if (order === 'additive') {
    let total = 0, cur = 0;
    for (const v of vals) {
      if (MULTIPLIERS.has(v)) {
        if (v === 100) cur = (cur || 1) * 100;
        else { total += (cur || 1) * v; cur = 0; }
      } else cur += v;
    }
    return total + cur;
  }
  let total = 0, i = 0;
  while (i < items.length) {
    const v = items[i];
    if (v === '+') { i++; continue; }
    if (!MULTIPLIERS.has(v)) { total += v; i++; continue; }
    // Multiplicateur : immédiatement suivi d'une liaison ou de rien → il compte pour lui-même.
    if (i + 1 >= items.length || items[i + 1] === '+') { total += v; i++; continue; }
    // Sinon, tout ce qui suit et reste inférieur à lui forme la quantité multipliée.
    let j = i + 1;
    while (j < items.length && (items[j] === '+' || (items[j] as number) < v)) j++;
    const q = compose(items.slice(i + 1, j), 'multiplier_first');
    total += v * (q ?? 1);
    i = j;
  }
  return total;
}

/** Apprend la grammaire d'une langue à partir des montants écrits par les natifs. */
export function learnGrammar(entries: NumberEntry[], opts: { validatedOnly?: boolean } = {}): NumberGrammar {
  const validatedOnly = opts.validatedOnly ?? false;
  const usable = entries.filter((e) => e.text.trim() && (!validatedOnly || e.validated));
  const words: Record<string, number> = {};
  const ambiguous = new Set<string>();
  for (const e of usable) {
    if (!isAtomic(e.value)) continue;
    const p = tokens(e.text).join(' ');
    if (!p) continue;
    if (p in words && words[p] !== e.value) ambiguous.add(p);
    else words[p] = e.value;
  }
  for (const p of ambiguous) delete words[p];

  // Liaisons : mots présents dans plusieurs montants composés sans être des nombres connus.
  const composite = usable.filter((e) => !isAtomic(e.value));
  const counts = new Map<string, number>();
  for (const e of composite) {
    for (const s of segment(tokens(e.text), words, new Set())) if ('other' in s) counts.set(s.other, (counts.get(s.other) ?? 0) + 1);
  }
  const connectors = [...counts].filter(([, n]) => n >= 2).map(([w]) => w);
  const cset = new Set(connectors);

  const evalOrder = (order: NumberOrder) => {
    const failures: NumberGrammar['failures'] = [];
    for (const e of composite) {
      const segs = segment(tokens(e.text), words, cset);
      const got = segs.some((s) => 'other' in s) ? null : compose(segs.map((s): Item => ('v' in s ? s.v : '+')), order);
      if (got !== e.value) failures.push({ value: e.value, text: e.text, got });
    }
    return failures;
  };
  const add = evalOrder('additive'), mul = evalOrder('multiplier_first');
  const order: NumberOrder = mul.length < add.length ? 'multiplier_first' : 'additive';
  // Les montants composés écrits par les natifs sont aussi gardés tels quels (expressions figées) :
  // ils sont reconnus même si la grammaire ne sait pas les reconstruire. La mesure `failures` est faite AVANT.
  for (const e of composite) {
    const p = tokens(e.text).join(' ');
    if (p && !(p in words) && !ambiguous.has(p)) words[p] = e.value;
  }
  return { words, connectors, order, checked: composite.length, failures: order === 'additive' ? add : mul, ambiguous: [...ambiguous], validatedOnly };
}

/**
 * Remplace, dans un texte, chaque montant dit avec les mots de la langue par sa valeur en chiffres.
 * Le reste du texte est conservé (normalisé) : l'extraction habituelle des montants s'applique ensuite.
 */
export function numeralize(text: string, g: NumberGrammar): string {
  if (!Object.keys(g.words).length) return text;
  // Un montant écrit en chiffres avec séparateur de milliers (« 12 500 », « 150.000 ») est un seul nombre :
  // sans cela, « 12 500 » devenait 12 + 500 = 512.
  const toks = tokens(text.replace(/\b\d{1,3}(?:[ .  ]\d{3})+\b/g, (m) => m.replace(/\D/g, '')));
  if (!toks.length) return text;
  const segs = segment(toks, g.words, new Set(g.connectors));
  const out: string[] = [];
  let run: Item[] = [];
  let runWord = '';
  let pending: string[] = [];
  const flush = () => {
    // Des chiffres dits un par un (« six five five seven seven… ») sont une dictée, pas un montant :
    // ils sont recollés (« 65577… ») pour que la détection des numéros de téléphone s'applique.
    if (run.length >= 2 && run.every((x) => x !== '+' && x < 10)) out.push(run.join(''));
    // « un » / « one » seul n'est pas un montant : en pidgin, la reconnaissance vocale écrit « one » pour
    // « wan » (vouloir) : « i one sen five thousand » donnait les montants 1 et 5 000.
    else if (run.length === 1 && run[0] === 1 && runWord) out.push(runWord);
    else if (run.length) { const v = compose(run, g.order); out.push(v === null ? '' : String(v)); }
    out.push(...pending);
    run = []; runWord = ''; pending = [];
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Chiffres écrits : gardés tels quels, jamais additionnés à d'autres chiffres (sinon le numéro
    // « 655 77 88 99 » devenait un montant). Devant un multiplicateur dit en mots, c'est un produit,
    // quel que soit l'ordre de la langue (« 25 ké » = 25 × 1 000).
    if ('v' in s && s.digits) {
      flush();
      const next = segs[i + 1];
      if (next && 'v' in next && !next.digits && MULTIPLIERS.has(next.v)) { out.push(String(s.v * next.v)); i++; }
      else out.push(String(s.v));
      continue;
    }
    if ('v' in s) { if (pending.length) run.push('+'); pending = []; run.push(s.v); runWord = run.length === 1 ? s.word ?? '' : ''; } // liaison entre deux nombres
    else if ('c' in s && run.length) pending.push(s.c);
    else { flush(); out.push('c' in s ? s.c : s.other); }
  }
  flush();
  return out.filter(Boolean).join(' ');
}
