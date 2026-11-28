// Traductions automatiques NON relues (data/ui/safinum-auto-<langue>.json) : textes d'écran et phrases de
// conversation produits par une machine, tenus à part des textes des natifs. Ils ne servent que lorsqu'aucun texte de
// natif n'existe, et sont comptés à part (« automatique ») dans le journal, pour pouvoir les présenter comme tels.
// CT_AUTO_TEXTS=0 les désactive.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type AutoFile = { ecrans?: Record<string, { text: string; fr?: string }>; reponses?: Record<string, { text: string; fr?: string }> };
const dir = () => process.env.CT_UI_DIR ?? fileURLToPath(new URL('../../data/ui/', import.meta.url));
const cache = new Map<string, AutoFile | null>();

function load(lang: string): AutoFile | null {
  if (process.env.CT_AUTO_TEXTS === '0') return null;
  if (!cache.has(lang)) {
    try { cache.set(lang, JSON.parse(readFileSync(`${dir()}safinum-auto-${lang}.json`, 'utf8')) as AutoFile); } catch { cache.set(lang, null); }
  }
  return cache.get(lang) ?? null;
}

/** Texte d'écran automatique, seulement si son français source n'a pas changé. */
export function autoScreenText(lang: string, key: string, fr: string): string | null {
  const e = load(lang)?.ecrans?.[key];
  if (!e?.text || (e.fr && e.fr !== fr)) return null;
  return e.text;
}

/** Phrase de conversation automatique (repères {montant}… conservés), ou null. */
export function autoReply(lang: string, id: string): string | null {
  return load(lang)?.reponses?.[id]?.text ?? null;
}
