// Identification de la langue d'un texte, par profils de suites de caractères (1 à 3 lettres).
// Méthode classique, légère (quelques dizaines de Ko), explicable, sans réseau.
// Les profils sont appris sur de vraies phrases (Common Voice, CC0) par tools/build-langid.ts et mesurés sur des
// phrases mises de côté. Seules des fréquences sont conservées, jamais les phrases elles-mêmes.
// Règle : si le texte est trop court ou si deux langues sont trop proches, on répond « inconnue » au lieu de deviner.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface LangProfile { total: number; grams: Record<string, number> }
export interface LangIdModel { version: 1; built: string; sources: Record<string, string>; profiles: Record<string, LangProfile>; evaluation?: unknown }
export interface LangGuess { lang: string | null; confidence: number; ranking: { lang: string; p: number }[]; reason?: string }

const N = 3;
export function grams(text: string): string[] {
  const t = text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  for (const w of t.split(' ').filter(Boolean)) {
    const s = `_${w}_`;
    for (let n = 1; n <= N; n++) for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  }
  return out;
}

export function buildProfile(texts: string[], keep = 600): LangProfile {
  const c = new Map<string, number>();
  for (const t of texts) for (const g of grams(t)) c.set(g, (c.get(g) ?? 0) + 1);
  const top = [...c].sort((a, b) => b[1] - a[1]).slice(0, keep);
  return { total: top.reduce((s, [, n]) => s + n, 0), grams: Object.fromEntries(top) };
}

export function identify(text: string, model: LangIdModel, opts: { minGrams?: number; minConfidence?: number; only?: string[] } = {}): LangGuess {
  const g = grams(text);
  const langs = Object.keys(model.profiles).filter((l) => !opts.only || opts.only.includes(l));
  if (g.length < (opts.minGrams ?? 12)) return { lang: null, confidence: 0, ranking: [], reason: 'texte trop court' };
  const scores = langs.map((l) => {
    const p = model.profiles[l];
    const V = Object.keys(p.grams).length + 1;
    let s = 0;
    for (const x of g) s += Math.log(((p.grams[x] ?? 0) + 0.5) / (p.total + 0.5 * V));
    return { lang: l, s: s / g.length };
  });
  // Probabilités relatives (softmax sur les log-vraisemblances moyennes, avec une température qui étale les écarts).
  const max = Math.max(...scores.map((x) => x.s));
  const exps = scores.map((x) => ({ lang: x.lang, e: Math.exp((x.s - max) * 8) }));
  const z = exps.reduce((a, x) => a + x.e, 0);
  const ranking = exps.map((x) => ({ lang: x.lang, p: Number((x.e / z).toFixed(3)) })).sort((a, b) => b.p - a.p);
  const confidence = ranking[0]?.p ?? 0;
  // Le pidgin camerounais emprunte presque tout son vocabulaire à l'anglais : les n-grammes le confondent.
  // Ses mots-outils, eux, ne sont pas de l'anglais écrit (« a wan », « na », « weti », « dey »…).
  if (langs.includes('wes') && (ranking[0]?.lang === 'en' || confidence < (opts.minConfidence ?? 0.7)) && pidginMarked(text)) {
    return { lang: 'wes', confidence, ranking, reason: 'mots-outils du pidgin' };
  }
  if (confidence < (opts.minConfidence ?? 0.7)) return { lang: null, confidence, ranking, reason: 'deux langues trop proches' };
  return { lang: ranking[0].lang, confidence, ranking };
}

const PIDGIN_STRONG = new Set(['wan', 'weti', 'wetin', 'dey', 'mony', 'tasen', 'tausen', 'abeg', 'sabi', 'komot', 'comot', 'wey', 'pikin', 'sotai']);
const PIDGIN_WEAK = new Set(['na', 'ma', 'ya', 'di', 'don', 'fit', 'no', 'for']);
/** Un mot-outil propre au pidgin, ou deux mots-outils plus courants (« na », « ma », « ya », « di »…). */
export function pidginMarked(text: string): boolean {
  const toks = text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').split(/[^a-z]+/).filter(Boolean);
  if (toks.some((t) => PIDGIN_STRONG.has(t))) return true;
  // « for + verbe » (« for send », « for pay ») : là où l'anglais dirait « to send ».
  if (toks.some((t, i) => t === 'for' && ['send', 'pay', 'buy', 'remove', 'see', 'know', 'take', 'give', 'do', 'get', 'withdraw'].includes(toks[i + 1]))) return true;
  return toks.filter((t) => PIDGIN_WEAK.has(t) && t !== 'no' && t !== 'for').length >= 2;
}

let cached: LangIdModel | null | undefined;
/** Remplace le modèle chargé (tests). */
export function setLangIdModel(m: LangIdModel | null | undefined): void { cached = m; }
export function loadLangId(): LangIdModel | null {
  if (cached === undefined) {
    const f = fileURLToPath(new URL('../../data/langid/profiles.json', import.meta.url));
    cached = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as LangIdModel : null;
  }
  return cached;
}
