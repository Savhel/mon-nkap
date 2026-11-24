// Évalue le moteur sur les phrases de TEST des natifs, langue par langue.
//   node tools/evaluate.ts [langues…] [--brouillons]
// Résultats détaillés : data/eval/<langue>.json. Les chiffres affichés sont ceux mesurés, rien d'autre.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { evaluateLanguage } from '../src/eval/evaluate.ts';
import { PACK_DIR } from '../src/linguistics/pack.ts';

const args = process.argv.slice(2);
const includeDrafts = args.includes('--brouillons');
const langs = args.filter((a) => !a.startsWith('--'));
const out = fileURLToPath(new URL('../data/eval/', import.meta.url));
mkdirSync(out, { recursive: true });
const P = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)} %`);
for (const lang of langs.length ? langs : readdirSync(PACK_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))) {
  const ev = await evaluateLanguage(lang, { includeDrafts });
  writeFileSync(`${out}${lang}.json`, JSON.stringify({ ...ev, at: new Date().toISOString() }, null, 1));
  if (!ev.n) { console.log(`${lang} : ${ev.note}`); continue; }
  console.log(`${lang} (${ev.n} phrases de test${includeDrafts ? ', brouillons inclus' : ''}) : intention ${P(ev.intentAccuracy)} · montant ${P(ev.amountAccuracy)} (${ev.amountN}) · bénéficiaire ${P(ev.beneficiaryAccuracy)} (${ev.beneficiaryN}) · clarification ${P(ev.clarificationRate)} (${ev.clarificationN}) · cohérence 3 canaux ${P(ev.crossChannelConsistency)} · latence p50 ${ev.latencyMs?.p50} ms`);
  for (const x of ev.items.filter((i) => !i.intentOk)) console.log(`   ✗ [${x.situation}] « ${x.text} » → ${x.predicted} (attendu ${x.expected})`);
}
