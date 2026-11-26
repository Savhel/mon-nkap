// Traduction automatique Flagship et OPUS-MT (via le service local services/mt_server.py),
// utilisée SOUS GARDE. Ces modèles ont été entraînés sur la Bible (voir docs/MT_EVALUATION.md) :
// - jamais pour une phrase contenant un chiffre (montant, numéro, référence) ;
// - une traduction n'est acceptée que si l'aller-retour (fr → langue → fr) retrouve le sens d'origine,
//   sans boucle de répétition et sans vocabulaire religieux absent de la phrase d'origine ;
// - elle est toujours étiquetée « traduction automatique ».

import { normalize, tokens } from '../core/text.ts';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { identify, loadLangId } from '../linguistics/langid.ts';

/**
 * Routes de traduction par langue. Flagship d'abord (entraîné dans les deux sens), sinon OPUS-MT (Apache-2.0) :
 * fra→langue avec un modèle, langue→fra avec un autre, ce qui permet le même contrôle par aller-retour.
 * OPUS n'est PAS utilisé pour le fulfulde ni le pidgin : ses codes fuv et pcm désignent les variétés du Nigeria.
 */
export interface MtRoute { engine: 'flagship' | 'opus' | 'madlad'; fromFr: string; toFr: string }
const flagship = (name: string): MtRoute => ({ engine: 'flagship', fromFr: `francais-${name}`, toFr: `${name}-francais` });
const opus = (name: string): MtRoute => ({ engine: 'opus', fromFr: `opus:francais-${name}`, toFr: `opus:${name}-francais` });
// OPUS est installé mais n'est routé pour AUCUNE langue : mesuré le 24/11 (docs/MT_EVALUATION.md), il écrit dans une
// autre langue bantoue que celle demandée (0 % de traductions acceptées après vérification de la langue) et sa
// compréhension produit des versets bibliques, parfois trompeurs (« solde » ewondo → « … les fit retirer … »).
// La fonction opus() reste disponible pour une langue où une future mesure lui donnerait raison.
export const MT_ROUTES: Record<string, MtRoute> = {
  ewo: flagship('ewondo'), fub: flagship('fufulde'), bum: flagship('bulu'), bbj: flagship('ghomala'), ybb: flagship('yemba'),
};
export const opusRoute = opus;
// Routes MESURÉES (tools/compare-mt.ts) : elles remplacent les routes par défaut langue par langue.
const measured = fileURLToPath(new URL('../../data/mt-routes.json', import.meta.url));
if (existsSync(measured)) {
  const { routes } = JSON.parse(readFileSync(measured, 'utf8')) as { routes: Record<string, { engine: MtRoute['engine']; fromFr: string; toFr: string }> };
  for (const [lang, r] of Object.entries(routes)) MT_ROUTES[lang] = { engine: r.engine, fromFr: r.fromFr, toFr: r.toFr };
}
/** Langues ayant une route de traduction (nom gardé pour compatibilité avec le moteur). */
export const FLAGSHIP_LANGS: Record<string, string> = Object.fromEntries(Object.entries(MT_ROUTES).map(([k, r]) => [k, r.engine]));
const URL_BASE = process.env.CT_MT_URL ?? 'http://127.0.0.1:8091';
const TIMEOUT_MS = 4000;

const STOP = new Set('le la les de des du un une et a à au aux en pour par sur dans ce cette ces que qui est sont vous votre vos je tu il elle nous ils on ne pas plus se sa son ses mon ma mes y d l s n c qu'.split(' '));
const RELIGIOUS = ['dieu', 'seigneur', 'jesus', 'christ', 'evangile', 'esprit', 'saint', 'heureux', 'temoignage', 'prophete', 'pecheur', 'sauves', 'ressuscite', 'eternel', 'disciples', 'israel', 'sanctuaire', 'royaume'];

export interface MtResult { text: string; back: string; score: number; accepted: boolean; reason?: string; engine: string; ms: number }

async function call(pair: string, texts: string[]): Promise<{ translations: string[]; ms: number } | null> {
  try {
    const r = await fetch(`${URL_BASE}/translate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pair, texts }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null;
    const result = await r.json() as { translations?: unknown; ms?: unknown };
    if (!Array.isArray(result.translations) || result.translations.length !== texts.length ||
        !result.translations.every((value) => typeof value === 'string' && value.trim() && value.length <= 1500)) return null;
    return { translations: result.translations as string[], ms: typeof result.ms === 'number' && Number.isFinite(result.ms) ? result.ms : 0 };
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
  const route = MT_ROUTES[lang];
  if (!route) return null;
  const engine = route.fromFr.includes(':') ? route.fromFr : `flagship:${route.fromFr}`;
  if (/\d/.test(fr)) return { text: '', back: '', score: 0, accepted: false, reason: 'contient un chiffre', engine, ms: 0 };
  const fwd = await call(route.fromFr, [fr]);
  if (!fwd) return null;
  const back = await call(route.toFr, fwd.translations);
  if (!back) return null;
  const text = fwd.translations[0], b = back.translations[0];
  const score = Number(overlap(fr, b).toFixed(2));
  const src = normalize(fr);
  let reason: string | undefined;
  if (/\d/.test(text)) reason = 'chiffre inventé';
  else if (normalize(text) === src) reason = 'texte source recopié';
  else if (repetitive(text) || repetitive(b)) reason = 'boucle de répétition';
  else if (RELIGIOUS.some((w) => normalize(b).includes(w) && !src.includes(w))) reason = 'vocabulaire hors domaine';
  else if (score < MIN_SCORE) reason = `aller-retour infidèle (${score})`;
  else reason = wrongLanguage(lang, text, route.engine);
  return { text, back: b, score, accepted: !reason, reason, engine, ms: fwd.ms + back.ms };
}

/**
 * Un aller-retour fidèle ne prouve pas que la traduction est dans la BONNE langue : un modèle multilingue peut écrire
 * dans une langue voisine qu'il sait retraduire (mesuré : OPUS « duala » produit une autre langue bantoue).
 * On vérifie donc la langue produite avec l'identification de langue (profils appris sur de vraies phrases).
 * Pour un modèle multilingue (OPUS, MADLAD), une langue sans profil est refusée : on ne peut pas la vérifier.
 */
export function wrongLanguage(lang: string, text: string, engine: MtRoute['engine']): string | undefined {
  const model = loadLangId();
  if (!model || !model.profiles[lang]) return engine === 'flagship' ? undefined : 'langue de sortie non vérifiable';
  const g = identify(text, model, { minGrams: 6, minConfidence: 0.5 });
  return g.lang === lang ? undefined : `langue de sortie incorrecte (${g.lang ?? 'inconnue'})`;
}

/** Langue nationale → français, pour la compréhension. Les chiffres sont repris du texte d'origine, jamais de la traduction. */
export async function toFrench(lang: string, text: string): Promise<{ fr: string; engine: string; ms: number } | null> {
  const route = MT_ROUTES[lang];
  if (!route) return null;
  const r = await call(route.toFr, [text]);
  if (!r) return null;
  const fr = r.translations[0];
  if (repetitive(fr)) return null;
  return { fr: fr.replace(/\d+/g, ' '), engine: route.toFr.includes(':') ? route.toFr : `flagship:${route.toFr}`, ms: r.ms };
}
