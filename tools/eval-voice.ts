// Mesure la chaîne vocale de bout en bout sur les VRAIES voix des natifs (accord écrit : docs/authorizations/) :
// enregistrement → reconnaissance vocale (Omnilingual ASR) → moteur → intention, oui / non.
//   node tools/eval-voice.ts <lang>          (lit data/audio/<lang>/demandes/labels.csv)
// Sortie : data/eval/voix-<lang>.json. Ce sont les phrases que le moteur a aussi apprises à l'écrit : la mesure
// porte sur ce que la reconnaissance vocale fait perdre, pas sur des phrases inédites.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transcribe, ASR_MODEL } from '../src/voice/speech.ts';
import { interpret } from '../src/core/nlu.ts';
import { normalize } from '../src/core/text.ts';
import { parseCsv } from '../src/linguistics/csv.ts';
import { ENGINE_TO_CANONICAL } from '../src/linguistics/runtime.ts';

const lang = process.argv[2];
if (!lang || !/^[a-z]{2,3}$/.test(lang)) { console.error('Usage : node tools/eval-voice.ts <lang>'); process.exit(1); }
const dir = fileURLToPath(new URL(`../data/audio/${lang}/demandes/`, import.meta.url));
const rows = parseCsv(readFileSync(dir + 'labels.csv', 'utf8')) as Record<string, string>[];

const lev = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
};
let ce = 0, c = 0, ok = 0, unsafe = 0, yesNo = 0, audio = 0;
const items = [];
for (const r of rows) {
  const t = await transcribe(new Uint8Array(readFileSync(dir + r.fichier)));
  audio += t.audioSeconds;
  const i = interpret(t.text, lang);
  const got = i.isConfirm && !i.isDeny ? 'CONFIRM' : i.isDeny && ['CONFIRM', 'CANCEL'].includes(r.intention) ? 'CANCEL' : i.intent ? ENGINE_TO_CANONICAL[i.intent] ?? i.intent : null;
  const ref = normalize(r.texte_natif ?? '').replace(/ /g, ''), hyp = normalize(t.text).replace(/ /g, '');
  if (ref) { ce += lev(ref, hyp); c += ref.length; }
  if (got === r.intention) ok++;
  if (['CONFIRM', 'CANCEL'].includes(r.intention)) yesNo++;
  if (r.intention !== 'CONFIRM' && i.isConfirm && !i.isDeny) unsafe++;   // un oui entendu là où le natif n'a pas dit oui
  items.push({ fichier: r.fichier, situation: r.situation_id, attendu: r.intention, obtenu: got, entendu: t.text, montants: i.amounts });
}
const out = {
  lang, model: ASR_MODEL, corpus: `data/audio/${lang}/demandes (voix de natifs, accord écrit)`, enregistrements: rows.length,
  audioMinutes: Number((audio / 60).toFixed(1)),
  cerSansTons: c ? Number(((100 * ce) / c).toFixed(1)) : null,
  intentionsJustes: ok, intentionsJustesPct: Number(((100 * ok) / rows.length).toFixed(1)),
  ouiNonMesures: yesNo, ouiEntendusATort: unsafe,
  statutDesDonnees: 'brouillon (phrases non relues par un second natif)', measuredAt: new Date().toISOString(), items,
};
const outDir = fileURLToPath(new URL('../data/eval/', import.meta.url));
writeFileSync(`${outDir}voix-${lang}.json`, JSON.stringify(out, null, 1));
const { items: _, ...summary } = out;
console.log(JSON.stringify(summary, null, 1));
