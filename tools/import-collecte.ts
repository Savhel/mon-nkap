// Transforme les tableurs remplis par les natifs (collecte/<lang>/*.csv) en packs de langue (data/packs/<lang>.json).
//   node tools/import-collecte.ts            toutes les langues présentes dans collecte/
//   node tools/import-collecte.ts dua ewo    seulement celles-ci
// Affiche ce qui est validé et chaque ligne rejetée avec sa raison.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/linguistics/csv.ts';
import { buildPack, packReport, type Sheets } from '../src/linguistics/importer.ts';
import { PACK_DIR } from '../src/linguistics/pack.ts';

const root = fileURLToPath(new URL('../collecte/', import.meta.url));
const langs = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(root).filter((d) => statSync(root + d).isDirectory());
mkdirSync(PACK_DIR, { recursive: true });

for (const lang of langs) {
  const sheets: Sheets = {};
  for (const name of ['nombres', 'lexique', 'demandes', 'reponses', 'definitions'] as const) {
    const f = `${root}${lang}/${name}.csv`;
    if (existsSync(f)) sheets[name] = parseCsv(readFileSync(f, 'utf8'));
  }
  const pack = buildPack(lang, sheets);
  writeFileSync(`${PACK_DIR}${lang}.json`, JSON.stringify(pack, null, 1));
  const r = packReport(pack);
  console.log(`${lang} : nombres ${r.numbers} · concepts ${r.concepts} · demandes ${r.utterances} (dont ${r.testUtterances} en test) · réponses ${r.responses} · définitions ${r.definitions} · rejets ${r.rejected}   (validés/total)`);
  for (const x of pack.rejected) console.log(`   ✗ ${x.sheet}.csv ligne ${x.row} : ${x.reason}`);
}
