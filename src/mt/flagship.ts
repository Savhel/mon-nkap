// Traduction automatique Flagship (MarianMT camerounais, via le service local services/mt_server.py),
// utilisée SOUS GARDE. Ces modèles ont été entraînés sur la Bible (voir docs/MT_EVALUATION.md) :
// - jamais pour une phrase contenant un chiffre (montant, numéro, référence) ;
// - une traduction n'est acceptée que si l'aller-retour (fr → langue → fr) retrouve le sens d'origine,
//   sans boucle de répétition et sans vocabulaire religieux absent de la phrase d'origine ;
// - elle est toujours étiquetée « traduction automatique ».

import { normalize, tokens } from '../core/text.ts';

export const FLAGSHIP_LANGS: Record<string, string> = { ewo: 'ewondo', fub: 'fufulde', bum: 'bulu', bbj: 'ghomala', ybb: 'yemba' };
const URL_BASE = process.env.CT_MT_URL ?? 'http://127.0.0.1:8091';
const TIMEOUT_MS = 4000;

const STOP = new Set('le la les de des du un une et a à au aux en pour par sur dans ce cette ces que qui est sont vous votre vos je tu il elle nous ils on ne pas plus se sa son ses mon ma mes y d l s n c qu'.split(' '));
const RELIGIOUS = ['dieu', 'seigneur', 'jesus', 'christ', 'evangile', 'esprit', 'saint', 'heureux', 'temoignage', 'prophete', 'pecheur', 'sauves', 'ressuscite', 'eternel', 'disciples', 'israel', 'sanctuaire', 'royaume'];

export interface MtResult { text: string; back: string; score: number; accepted: boolean; reason?: string; engine: string; ms: number }

async function call(pair: string, texts: string[]): Promise<{ translations: string[]; ms: number } | null> {
  try {
    const r = await fetch(`${URL_BASE}/translate`, { method: 'POST', body: JSON.stringify({ pair, texts }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.json() as { translations: string[]; ms: number };
  } catch { return null; }
}

/** Mots porteurs de sens (sans mots-outils), normalisés. */
function content(s: string): string[] { return tokens(s).filter((t) => t.length > 2 && !STOP.has(t)); }

/** Recouvrement F1 des mots porteurs de sens entre la phrase d'origine et l'aller-retour (0 à 1). */
export function overlap(a: string, b: string): number {
  const A = content(a), B = content(b);
  if (!A.length || !B.length) return 0;
  const setB = new Set(B);
  const stem = (w: string) => w.slice(0, 5);
  const stemsB = new Set(B.map(stem));
  const hit = A.filter((w) => setB.has(w) || stemsB.has(stem(w))).length;
  const p = hit / B.length, r = hit / A.length;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

function repetitive(s: string): boolean {
  const t = tokens(s);
  const counts = new Map<string, number>();
  for (const w of t) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.values()].some((c) => c >= 3) || t.length > 40;
}

export const MIN_SCORE = 0.6;

/** Français → langue nationale, avec contrôle par aller-retour. */
export async function frenchTo(lang: string, fr: string): Promise<MtResult | null> {
  const name = FLAGSHIP_LANGS[lang];
  if (!name) return null;
  const engine = `flagship:francais-${name}`;
  if (/\d/.test(fr)) return { text: '', back: '', score: 0, accepted: false, reason: 'contient un chiffre', engine, ms: 0 };
  const fwd = await call(`francais-${name}`, [fr]);
  if (!fwd) return null;
  const back = await call(`${name}-francais`, fwd.translations);
  if (!back) return null;
  const text = fwd.translations[0], b = back.translations[0];
  const score = Number(overlap(fr, b).toFixed(2));
  const src = normalize(fr);
  let reason: string | undefined;
  if (/\d/.test(text)) reason = 'chiffre inventé';
  else if (repetitive(text) || repetitive(b)) reason = 'boucle de répétition';
  else if (RELIGIOUS.some((w) => normalize(b).includes(w) && !src.includes(w))) reason = 'vocabulaire hors domaine';
  else if (score < MIN_SCORE) reason = `aller-retour infidèle (${score})`;
  return { text, back: b, score, accepted: !reason, reason, engine, ms: fwd.ms + back.ms };
}

/** Langue nationale → français, pour la compréhension. Les chiffres sont repris du texte d'origine, jamais de la traduction. */
export async function toFrench(lang: string, text: string): Promise<{ fr: string; engine: string; ms: number } | null> {
  const name = FLAGSHIP_LANGS[lang];
  if (!name) return null;
  const r = await call(`${name}-francais`, [text]);
  if (!r) return null;
  const fr = r.translations[0];
  if (repetitive(fr)) return null;
  return { fr: fr.replace(/\d+/g, ' '), engine: `flagship:${name}-francais`, ms: r.ms };
}
