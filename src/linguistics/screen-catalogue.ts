// Une seule traduction par mot : les textes d'écran écrits par les natives (data/ui/safinum-<langue>.json) font foi.
// Ce module retrouve, pour un texte français donné, la traduction qu'une native a déjà écrite pour un écran, afin que
// le même mot ne soit pas rendu de deux façons (menu USSD, boutons du GAB, autres écrans).

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allowDraft } from './pack.ts';

const dir = () => process.env.CT_UI_DIR ?? fileURLToPath(new URL('../../data/ui/', import.meta.url));
type Entry = string | { text: string; fr?: string; valide?: boolean };
const cache = new Map<string, { mtime: number; byFr: Map<string, string> }>();

/** Forme de comparaison : apostrophes, espaces et casse unifiés. */
export const frKey = (s: string) => s.normalize('NFC').replace(/[’‘ʼ`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

function load(lang: string): Map<string, string> {
  const file = `${dir()}safinum-${lang}.json`;
  let mtime = 0;
  try { mtime = statSync(file).mtimeMs; } catch { return new Map(); }
  const hit = cache.get(lang);
  if (hit && hit.mtime === mtime) return hit.byFr;
  const byFr = new Map<string, string>();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Entry>;
    let source: Record<string, { text: string }> = {};
    try { source = JSON.parse(readFileSync(`${dir()}safinum-source.json`, 'utf8')); } catch { /* sans liste source */ }
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('_') || !v) continue;
      const text = typeof v === 'string' ? v : v.text;
      const fr = typeof v === 'string' ? source[k]?.text : v.fr ?? source[k]?.text;
      if (!text || !fr) continue;
      if (typeof v !== 'string' && !v.valide && !allowDraft()) continue;
      const key = frKey(fr);
      if (!byFr.has(key)) byFr.set(key, text); // la première entrée du fichier l'emporte : ordre stable
    }
  } catch { /* fichier illisible : aucune correspondance */ }
  cache.set(lang, { mtime, byFr });
  return byFr;
}

/** Traduction d'écran d'une native pour ce texte français exact, ou null. */
export function screenTextForFrench(lang: string, fr: string): string | null {
  return load(lang).get(frKey(fr)) ?? null;
}
