// Moteur Mboa (vendor/mboa, phrases et blocs relus par les natifs) : traduit une phrase française d'écran,
// soit par correspondance exacte avec une phrase validée, soit par composition de blocs validés (chaque mot doit
// être couvert, grammaire stricte, polarité respectée). Rien d'autre : pas de « mot-clé devant le français ».
// Le moteur est chargé une seule fois, dans un contexte isolé.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['ns.js', 'entities.js', 'detect.js', 'phrases.js', 'blocks.js', 'engine.js'];
const LANGS: Record<string, string> = { ewo: 'ewo', dua: 'dua', fub: 'fub', wes: 'pcm', pcm: 'pcm' };

type MboaResult = { kind?: string; out?: string | null; status?: string } | null;
let engine: { translate(text: string, lang: string): MboaResult } | null | undefined;

function load() {
  if (engine !== undefined) return engine;
  try {
    const sandbox: Record<string, unknown> = {};
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    for (const f of FILES) vm.runInContext(readFileSync(new URL(`../../vendor/mboa/${f}`, import.meta.url), 'utf8'), ctx, { filename: `mboa/${f}` });
    engine = (sandbox.MBOA as { engine: typeof engine }).engine ?? null;
  } catch {
    engine = null;
  }
  return engine;
}

/** Traduction validée par Mboa, ou null. Les sorties composées perdent leur repère « ≈ » (réservé à l'extension). */
export function mboaTranslate(lang: string, text: string): { text: string; kind: 'exact' | 'composed' } | null {
  const target = LANGS[lang];
  const e = target ? load() : null;
  if (!e) return null;
  let r: MboaResult;
  try { r = e.translate(text, target!); } catch { return null; }
  if (!r || !r.out || (r.kind !== 'exact' && r.kind !== 'composed')) return null;
  if (r.status !== 'validated') return null;
  return { text: r.out.replace(/^≈\s*/, ''), kind: r.kind };
}
