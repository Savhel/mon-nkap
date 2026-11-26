// Extraction des montants et numéros de téléphone, en chiffres ou en lettres (français, anglais).
// Un montant n'est jamais traduit ni deviné : soit il est lu sans ambiguïté, soit le moteur demande.

import { levenshtein, normalize } from './text.ts';

const FR: Record<string, number> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, nonante: 90,
};
const EN: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const UNITS: Record<string, number> = { ...EN, ...FR };
const HUNDRED = new Set(['cent', 'cents', 'hundred']);
const THOUSAND = new Set(['mille', 'mil', 'thousand', 'k']);
const MILLION = new Set(['million', 'millions', 'mio']);
const GLUE = new Set(['et', 'and']);
// Multiplicateurs du pidgin (mille) : jamais comptés ici, seulement repérés pour ne pas lire un montant tronqué.
const FOREIGN_MULTIPLIERS = new Set(['tasen', 'tausen', 'tauzen', 'ke', 'kay']);
const CURRENCY = new Set(['f', 'fr', 'frs', 'franc', 'francs', 'fcfa', 'cfa', 'xaf']);

export interface AmountMatch { value: number; start: number; end: number; raw: string; currency: boolean }

function isNumberWord(t: string): boolean {
  return t in UNITS || HUNDRED.has(t) || THOUSAND.has(t) || MILLION.has(t) || /^\d+$/.test(t) || /^\d+k$/.test(t);
}

const REPAIRABLE = Object.keys(UNITS).filter((w) => w.length >= 4).concat(['mille', 'cent', 'cents', 'million', 'thousand', 'hundred']);
/**
 * Mot-nombre le plus proche, à une édition près. Pour un mot de 4 lettres, seule une lettre
 * MANQUANTE est acceptée (« ving » → « vingt », « ille » → « mille ») : « pour » ne devient pas « four ».
 */
function repairNumberWord(t: string): string[] | null {
  const stem = t.replace(/^(de|d|des)(?=[a-z]{4,})/, '');
  for (const cand of [t, stem]) {
    const hit = REPAIRABLE.find((w) => levenshtein(cand, w) <= 1 && (cand.length >= 5 || w.length === cand.length + 1));
    if (hit) return [hit];
  }
  return null;
}

/** Jetons pour les nombres : garde les chiffres, sépare "5k", "5000f", recolle "quatre vingt". */
function numberTokens(text: string): string[] {
  const n = normalize(text.replace(/(\d)[ .\u00a0\u202f](?=\d{3}(?!\d))/g, '$1'))
    .replace(/(\d)(f|fcfa|frs?|francs?)\b/g, '$1 $2')
    .replace(/(\d)k\b/g, '$1 k')
    .replace(/-/g, ' ');
  const out = n.split(' ').filter(Boolean);
  // Réparation des fautes d'ASR sur les nombres, UNIQUEMENT à côté d'un autre mot-nombre
  // (« deving mille » → « vingt mille », « trante mille » → « trente mille »).
  // Le montant réparé est toujours répété à l'utilisateur avant toute exécution.
  const anchor = (x: string | undefined) => !!x && (isNumberWord(x) || CURRENCY.has(x));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < out.length; i++) {
      const t = out[i];
      if (isNumberWord(t) || t.length < 4 || !(anchor(out[i + 1]) || anchor(out[i - 1]))) continue;
      const fixed = repairNumberWord(t);
      if (fixed) out.splice(i, 1, ...fixed);
    }
  }
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === 'quatre' && (out[i + 1] === 'vingt' || out[i + 1] === 'vingts')) { out.splice(i, 2, '80'); }
  }
  return out;
}

function valueOf(run: string[]): number | null {
  let total = 0, current = 0, seen = false;
  for (const t of run) {
    if (GLUE.has(t)) continue;
    if (/^\d+$/.test(t)) { current += Number(t); seen = true; continue; }
    if (t in UNITS) { current += UNITS[t]; seen = true; continue; }
    if (HUNDRED.has(t)) { current = (current || 1) * 100; seen = true; continue; }
    if (THOUSAND.has(t)) { total += (current || 1) * 1000; current = 0; seen = true; continue; }
    if (MILLION.has(t)) { total += (current || 1) * 1_000_000; current = 0; seen = true; continue; }
    return null;
  }
  return seen ? total + current : null;
}

export function extractAmounts(text: string): AmountMatch[] {
  // Les numéros de téléphone ne sont jamais des montants.
  const toks = numberTokens(text.replace(/(?:\+?237[ .-]?)?[62](?:[ .\-\u00a0]?\d){8}(?![\d])/g, ' '));
  const found: AmountMatch[] = [];
  let i = 0;
  while (i < toks.length) {
    if (!isNumberWord(toks[i]) || toks[i] === 'k') { i++; continue; }
    let j = i;
    while (j < toks.length && (isNumberWord(toks[j]) || (GLUE.has(toks[j]) && j + 1 < toks.length && isNumberWord(toks[j + 1])))) {
      // Après des chiffres, seul un multiplicateur prolonge le montant (« 5 mille », « 25 k »). Sinon
      // « 3000 one » (particule « one » en fulfulde) devenait 3 001, et « 3000 5 » devenait 3 005.
      if (j > i && /^\d+$/.test(toks[j - 1]) && !(HUNDRED.has(toks[j]) || THOUSAND.has(toks[j]) || MILLION.has(toks[j]))) break;
      j++;
    }
    // "un"/"une"/"one" seuls sont des articles ("un transfert"), pas des montants.
    const run = toks.slice(i, j);
    const lone = run.length === 1 && ['un', 'une', 'one'].includes(run[0]);
    const v = lone ? null : valueOf(run);
    const isPhone = run.length === 1 && /^[62]\d{8}$/.test(run[0]);
    // Suivi d'un multiplicateur d'une autre langue que ce lecteur ne sait pas compter (« five tasen » en pidgin) :
    // le montant est incomplet. Mieux vaut ne rien lire (le moteur redemande) que lire 5 au lieu de 5 000.
    const foreignMultiplier = j < toks.length && FOREIGN_MULTIPLIERS.has(toks[j]);
    if (v !== null && !isPhone && !foreignMultiplier) {
      const currency = j < toks.length && CURRENCY.has(toks[j]);
      found.push({ value: v, start: i, end: j, raw: run.join(' '), currency });
    }
    i = Math.max(j, i + 1);
  }
  return found;
}

/** Numéros camerounais : 9 chiffres commençant par 6 (mobile) ou 2 (fixe), avec ou sans +237. */
export function extractPhones(text: string): string[] {
  const compact = text.replace(/(?<=\d)[ .\-\u00a0](?=\d)/g, '');
  const out: string[] = [];
  for (const m of compact.matchAll(/(?:\+?237)?([62]\d{8})(?!\d)/g)) out.push(m[1]);
  return out;
}

export function formatFcfa(value: number, lang: string): string {
  const grouped = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '\u202f');
  return `${grouped} FCFA`;
}
