// Bac à sable SAFINUM, canaux mobile et web : il n'y a pas de conversation. L'application bancaire du simulateur
// envoie, écran par écran, ses textes en français (`type: "ui_translation"`) ; on renvoie les mêmes clés traduites.
//
// Ordre, sans jamais inventer de texte en langue nationale :
//   1. catalogue relu (data/ui/safinum-<langue>.json) : textes écrits par des locuteurs, ou anglais rédigé ;
//   2. textes des natifs et libellés Mboa déjà au dépôt (correspondance exacte du français), puis le moteur Mboa
//      (vendor/mboa) : phrase validée ou composition de blocs validés, jamais de « mot-clé devant le français » ;
//   3. traduction automatique gardée (aller-retour, langue vérifiée, jamais de chiffre), mise en cache ;
//   4. sinon le français, tel quel.
// Chaque texte rendu garde exactement ses emplacements ({amount}, {name}…) et respecte max_chars ; sinon, le français.
// Les textes reçus sont enregistrés (data/ui/safinum-source.json) : c'est la liste à faire traduire par les natifs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchPackFromFrench } from '../core/translate.ts';
import { normalize } from '../core/text.ts';
import { allowDraft } from '../linguistics/pack.ts';
import { mboaTranslate } from '../linguistics/mboa-compose.ts';
import { nativeResponse } from '../core/respond.ts';
import { autoScreenText } from '../linguistics/auto-texts.ts';
import { frenchTo, MT_ROUTES } from '../mt/flagship.ts';

export interface UiString { text: string; context?: string; max_chars?: number | null }
export interface UiTranslationRequest { language?: string | null; source_language?: string; screen?: string; strings?: Record<string, UiString | string> }
export interface UiTranslationResponse { language: string; strings: Record<string, string> }

const ALIASES: Record<string, string> = { pcm: 'wes', pidgin: 'wes', kamtok: 'wes' };
// Boutons d'écran qui portent exactement l'action d'un libellé de menu déjà traduit par un natif.
const SAME_AS: Record<string, string> = { 'atm.balance': 'menu_balance', 'atm.withdraw': 'menu_withdraw' };
const dir = () => process.env.CT_UI_DIR ?? fileURLToPath(new URL('../../data/ui/', import.meta.url));
const budget = () => Number(process.env.CT_UI_BUDGET_MS ?? 3000); // le simulateur attend 10 s ; la traduction automatique échoue presque toujours sur ces textes courts

type Source = Record<string, { text: string; context?: string; max_chars?: number | null; screens: string[] }>;
type Machine = Record<string, Record<string, string>>; // langue → texte français → traduction acceptée

const read = <T>(file: string, empty: T): T => { try { return JSON.parse(readFileSync(dir() + file, 'utf8')) as T; } catch { return empty; } };
const save = (file: string, data: unknown) => { mkdirSync(dir(), { recursive: true }); writeFileSync(dir() + file, JSON.stringify(data, null, 1) + '\n'); };

type Curated = string | { text: string; fr?: string; valide?: boolean };
/** Catalogue relu d'une langue. Une entrée venue de la collecte (objet) n'est servie que si son français source n'a
 *  pas changé, et, tant qu'un second natif ne l'a pas validée, seulement avec les brouillons autorisés. */
function curated(lang: string, sources: Record<string, UiString>): Record<string, string> {
  const raw = read<Record<string, Curated>>(`safinum-${lang}.json`, {});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') { out[k] = v; continue; }
    if (!v || typeof v.text !== 'string') continue;
    if (v.fr && sources[k] && v.fr !== sources[k].text) continue;
    if (v.valide || allowDraft()) out[k] = v.text;
  }
  return out;
}

const placeholders = (s: string) => (s.match(/\{[A-Za-z0-9_]+\}/g) ?? []).sort().join('|');
/** Une traduction n'est utilisable que si elle garde les mêmes emplacements, n'ajoute aucun chiffre et tient dans la place. */
export function fits(src: string, out: string | undefined | null, max?: number | null): out is string {
  if (!out || !out.trim()) return false;
  if (placeholders(src) !== placeholders(out)) return false;
  const digits = (t: string) => t.replace(/\{[A-Za-z0-9_]+\}/g, '').replace(/\D/g, '');
  if (digits(out) !== digits(src)) return false;
  return !max || [...out].length <= max;
}

/** Traduit un texte en préservant les emplacements : seuls les morceaux de texte entre eux passent par le modèle. */
async function machineTranslate(lang: string, src: string): Promise<string | null> {
  const out: string[] = [];
  for (const part of src.split(/(\{[A-Za-z0-9_]+\})/)) {
    if (/^\{[A-Za-z0-9_]+\}$/.test(part) || !/\p{L}{2,}/u.test(part) || /\d/.test(part)) { out.push(part); continue; }
    const lead = part.match(/^[\s:;,.!?«»"'()–-]*/)![0];
    const tail = part.slice(lead.length).match(/[\s:;,.!?«»"'()–-]*$/)![0];
    const core = part.slice(lead.length, part.length - tail.length);
    const mt = await frenchTo(lang, core);
    if (!mt?.accepted) return null;
    // Le modèle remet souvent la ponctuation finale : on garde celle du français (sinon « waɗugo? ? »).
    const text = /[.!?:;]/.test(tail) ? mt.text.replace(/[\s.!?:;]+$/u, '') : mt.text;
    out.push(lead + text + tail);
  }
  return out.join('');
}

const pending = new Map<string, Promise<string | null>>();
function machineOnce(lang: string, src: string): Promise<string | null> {
  const key = `${lang}\u0000${src}`;
  let p = pending.get(key);
  if (!p) {
    p = machineTranslate(lang, src).then((t) => {
      if (fits(src, t)) { const m = read<Machine>('safinum-machine.json', {}); (m[lang] ??= {})[src] = t; save('safinum-machine.json', m); }
      return t;
    }).catch(() => null).finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

function remember(screen: string | undefined, strings: Record<string, UiString>) {
  const store = read<Source>('safinum-source.json', {});
  let changed = false;
  for (const [key, s] of Object.entries(strings)) {
    const prev = store[key];
    const screens = new Set(prev?.screens ?? []);
    if (screen) screens.add(screen);
    if (!prev || prev.text !== s.text || prev.screens.length !== screens.size) {
      store[key] = { text: s.text, context: s.context, max_chars: s.max_chars ?? null, screens: [...screens].sort() };
      changed = true;
    }
  }
  if (changed) save('safinum-source.json', store);
}

export async function translateUiScreen(req: UiTranslationRequest): Promise<UiTranslationResponse & { stats: Record<string, number> }> {
  const strings: Record<string, UiString> = {};
  for (const [k, v] of Object.entries(req.strings ?? {})) {
    if (typeof v === 'string') strings[k] = { text: v };
    else if (v && typeof v === 'object' && typeof v.text === 'string') strings[k] = { text: v.text, context: v.context, max_chars: typeof v.max_chars === 'number' ? v.max_chars : null };
  }
  try { remember(req.screen, strings); } catch { /* l'enregistrement ne doit jamais casser l'écran */ }
  const asked = typeof req.language === 'string' && req.language.trim() ? req.language.trim().toLowerCase() : null;
  const lang = asked ? ALIASES[asked] ?? asked : null;
  const out: Record<string, string> = {};
  const stats = { curated: 0, native: 0, auto: 0, machine: 0, french: 0 };
  // Langue absente (rien à détecter sur des textes d'écran) ou français : on rend le français.
  if (!lang || lang === 'fr') {
    for (const [k, s] of Object.entries(strings)) out[k] = s.text;
    return { language: asked ?? 'fr', strings: out, stats: { ...stats, french: Object.keys(strings).length } };
  }

  const cur = curated(lang, strings);
  const cache = read<Machine>('safinum-machine.json', {})[lang] ?? {};
  const misses: [string, UiString][] = [];
  for (const [k, s] of Object.entries(strings)) {
    if (fits(s.text, cur[k], s.max_chars)) { out[k] = cur[k]; stats.curated++; continue; }
    const hit = matchPackFromFrench(lang, normalize(s.text), allowDraft());
    if (fits(s.text, hit?.text, s.max_chars)) { out[k] = hit!.text; stats.native++; continue; }
    const mboa = mboaTranslate(lang, s.text);
    if (fits(s.text, mboa?.text, s.max_chars)) { out[k] = mboa!.text; stats.native++; continue; }
    const same = SAME_AS[k] ? nativeResponse(lang, SAME_AS[k]) : null;
    if (fits(s.text, same, s.max_chars)) { out[k] = same!; stats.native++; continue; }
    const auto = autoScreenText(lang, k, s.text);
    if (fits(s.text, auto, s.max_chars)) { out[k] = auto!; stats.auto++; continue; }
    if (fits(s.text, cache[s.text], s.max_chars)) { out[k] = cache[s.text]; stats.machine++; continue; }
    out[k] = s.text;
    misses.push([k, s]);
  }

  // Traduction automatique des textes manquants, dans le temps imparti. Ce qui n'est pas prêt reste en français
  // pour cet écran, et sera servi depuis le cache à l'affichage suivant.
  if (misses.length && MT_ROUTES[lang]) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, budget()); });
    const result = { ...out };
    const work = (async () => {
      for (const [k, s] of misses) {
        const t = await machineOnce(lang, s.text);
        if (fits(s.text, t, s.max_chars)) { result[k] = t; stats.machine++; }
      }
    })();
    await Promise.race([work, deadline]);
    clearTimeout(timer);
    Object.assign(out, result);
  }
  stats.french = Object.keys(strings).length - stats.curated - stats.native - stats.auto - stats.machine;
  return { language: asked!, strings: out, stats };
}
