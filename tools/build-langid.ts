// Construit et MESURE l'identification de langue.
//   node tools/build-langid.ts ewo=chemin/validated_sentences.tsv dua=… wes=…
// - Langues nationales : vraies phrases Common Voice (CC0). 80 % pour apprendre, 20 % mis de côté pour mesurer.
// - Français et anglais : textes du projet (lexiques, situations, réponses, définitions).
// - Phrases des natifs (packs, partie entraînement) ajoutées automatiquement quand elles existent.
// Écrit data/langid/profiles.json : fréquences de suites de caractères + résultats de la mesure. Aucune phrase.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProfile, identify, type LangIdModel } from '../src/linguistics/langid.ts';
import { DEFINITIONS, RESPONSES, SITUATIONS, CONCEPTS } from '../src/linguistics/collection.ts';
import { loadPack, splitOf } from '../src/linguistics/pack.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const texts: Record<string, string[]> = {};
const sources: Record<string, string> = {};

for (const arg of process.argv.slice(2)) {
  const [lang, file] = arg.split('=');
  const rows = readFileSync(file, 'utf8').replace(/^﻿/, '').split('\n');
  const col = rows[0].split('\t').indexOf('sentence');
  texts[lang] = rows.slice(1).map((r) => r.split('\t')[col]).filter((s) => s && s.trim());
  sources[lang] = `Common Voice 27.0 (CC0), ${texts[lang].length} phrases`;
}
const lex = (l: string) => { const d = JSON.parse(readFileSync(`${root}data/lexicons/${l}.json`, 'utf8')); return [...Object.values(d.intents).flat(), ...d.confirm, ...d.deny, ...d.correction] as string[]; };
texts.fr = [...lex('fr'), ...SITUATIONS.map((s) => s.situation), ...RESPONSES.map((r) => r.fr.replace(/\{[a-z_]+\}/g, '')), ...DEFINITIONS.map((d) => d.fr), ...CONCEPTS.map((c) => c.fr)];
sources.fr = `textes du projet (${texts.fr.length} phrases et expressions)`;
texts.en = lex('en');
sources.en = `lexique anglais du projet (${texts.en.length} expressions)`;
for (const l of Object.keys(texts)) {
  const pack = loadPack(l);
  const native = pack?.utterances.filter((u) => u.split === 'train' && u.validated).map((u) => u.text) ?? [];
  if (native.length) { texts[l].push(...native); sources[l] += ` + ${native.length} phrases de natifs`; }
}

const split = (xs: string[]) => ({ train: xs.filter((x) => splitOf(x) === 'train'), test: xs.filter((x) => splitOf(x) === 'test') });
const parts = Object.fromEntries(Object.entries(texts).map(([l, xs]) => [l, split(xs)]));
const model: LangIdModel = { version: 1, built: new Date().toISOString(), sources, profiles: Object.fromEntries(Object.entries(parts).map(([l, p]) => [l, buildProfile(p.train)])) };

function measure(cut: (s: string) => string) {
  const out: Record<string, { n: number; correct: number; unknown: number; confusedWith: Record<string, number> }> = {};
  for (const [l, p] of Object.entries(parts)) {
    const r = { n: 0, correct: 0, unknown: 0, confusedWith: {} as Record<string, number> };
    for (const s of p.test) {
      const g = identify(cut(s), model);
      r.n++;
      if (g.lang === l) r.correct++;
      else if (g.lang === null) r.unknown++;
      else r.confusedWith[g.lang] = (r.confusedWith[g.lang] ?? 0) + 1;
    }
    out[l] = r;
  }
  return out;
}
const full = measure((s) => s);
const short = measure((s) => s.split(/\s+/).slice(0, 3).join(' '));
model.evaluation = { method: 'phrases mises de côté (20 %), jamais vues à l’apprentissage', full, firstThreeWords: short };
mkdirSync(`${root}data/langid`, { recursive: true });
writeFileSync(`${root}data/langid/profiles.json`, JSON.stringify(model));

const P = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
console.log('Langue | phrases test | phrase entière : juste / « inconnue » / erreur | 3 premiers mots : juste / « inconnue » / erreur');
for (const l of Object.keys(parts)) {
  const f = full[l], s = short[l];
  const errF = f.n - f.correct - f.unknown, errS = s.n - s.correct - s.unknown;
  console.log(`${l} | ${f.n} | ${P(f.correct, f.n)} / ${P(f.unknown, f.n)} / ${P(errF, f.n)} ${JSON.stringify(f.confusedWith)} | ${P(s.correct, s.n)} / ${P(s.unknown, s.n)} / ${P(errS, s.n)} ${JSON.stringify(s.confusedWith)}`);
}
