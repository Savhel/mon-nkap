// Importe le pack de phrases de Mboa (extension de présélection) en JSON.
// Toutes les traductions sont importées avec le statut "draft" : aucune n'a été
// validée par un locuteur natif (voir docs/RESOURCE_AUDIT.md §2).
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('./mboa-phrases.source.js', import.meta.url), 'utf8');
const ctx = { globalThis: {} }; ctx.globalThis.MBOA = {}; vm.createContext(ctx);
vm.runInContext(src.replace('const M = globalThis.MBOA;', 'const M = globalThis.MBOA; globalThis.__P = () => P;').replace(/\}\)\(\);\s*$/, 'globalThis.__P2 = typeof P !== "undefined" ? P : null; })();'), ctx);
const M = ctx.globalThis.MBOA;
const phrases = {};
for (const row of (ctx.globalThis.__P2 || [])) {
  const [id, intent, , fr, en, tr] = row;
  phrases[id] = { intent, fr: fr[0], en: en[0], ...Object.fromEntries(Object.entries(tr).map(([k, v]) => [k === 'pcm' ? 'wes' : k, v])) };
}
const ui = {};
for (const [k, v] of Object.entries(M.ui || {})) { const { pcm, ...rest } = v; ui[k] = { ...rest, wes: pcm }; }
const out = { source: 'https://github.com/PIO-VIA/Mboa (mboa/src/packs/phrases.js)', status: 'draft', note: 'Aucune ligne validée par un locuteur natif au 2026-11-23. pcm de Mboa = Kamtok, renommé wes.', phrases, ui };
writeFileSync(new URL('../data/mboa-pack.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('phrases', Object.keys(phrases).length, 'ui', Object.keys(ui).length);
