// Mesure la reconnaissance vocale (Omnilingual ASR) sur de VRAIES voix camerounaises : la partie « test » de
// Common Voice (CC0), dont les locuteurs ne servent à rien d'autre ici.
//   node tools/measure-asr.ts <lang> <test.tsv> <archive.tar.gz> [--max 300]
// Sortie : data/eval/asr-<lang>.json (chiffres seulement : aucune phrase ni aucun audio n'est conservé).
// Deux mesures : stricte (tons et lettres spéciales comptent) et « sans tons » (ce que le moteur utilise,
// puisqu'il normalise le texte avant de le comprendre).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { transcribe, ASR_MODEL } from '../src/voice/speech.ts';
import { normalize } from '../src/core/text.ts';

const [lang, tsv, archive] = process.argv.slice(2);
const max = Number(process.argv[process.argv.indexOf('--max') + 1]) || 300;
if (!lang || !tsv || !archive) { console.error('Usage : node tools/measure-asr.ts <lang> <test.tsv> <archive.tar.gz> [--max 300]'); process.exit(1); }

const rows = readFileSync(tsv, 'utf8').split('\n');
const head = rows[0].split('\t');
const [cPath, cSent, cClient] = ['path', 'sentence', 'client_id'].map((k) => head.indexOf(k));
const items = rows.slice(1).map((r) => r.split('\t')).filter((r) => r[cPath]).slice(0, max).map((r) => ({ path: r[cPath], ref: r[cSent], speaker: r[cClient] }));

const work = mkdtempSync(`${tmpdir()}/ct-asr-`);
try {
  // Extraction des seuls clips de test (l'archive contient aussi des milliers d'autres enregistrements).
  const listing = execFileSync('tar', ['tzf', archive], { maxBuffer: 1 << 28 }).toString().split('\n');
  const wanted = new Set(items.map((i) => i.path));
  const members = listing.filter((m) => wanted.has(m.split('/').pop() ?? ''));
  writeFileSync(`${work}/list`, members.join('\n'));
  execFileSync('tar', ['xzf', archive, '-C', work, '-T', `${work}/list`]);
  const where = new Map(members.map((m) => [m.split('/').pop()!, `${work}/${m}`]));

  const strict = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const lev = <T>(a: T[], b: T[]) => {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[b.length];
  };
  const acc = { strict: { we: 0, w: 0, ce: 0, c: 0 }, loose: { we: 0, w: 0, ce: 0, c: 0 } };
  let audio = 0, decode = 0, n = 0;
  const speakers = new Set<string>();
  const examples: string[] = [];
  for (const it of items) {
    const f = where.get(it.path);
    if (!f) continue;
    const tr = await transcribe(new Uint8Array(readFileSync(f)));
    audio += tr.audioSeconds; decode += tr.decodeMs; n++; speakers.add(it.speaker);
    for (const [k, norm] of [['strict', strict], ['loose', normalize]] as const) {
      const r = norm(it.ref), h = norm(tr.text);
      acc[k].we += lev(r.split(' ').filter(Boolean), h.split(' ').filter(Boolean)); acc[k].w += r.split(' ').filter(Boolean).length;
      acc[k].ce += lev([...r.replace(/ /g, '')], [...h.replace(/ /g, '')]); acc[k].c += r.replace(/ /g, '').length;
    }
    if (examples.length < 3) examples.push(`  référence : ${it.ref}\n  entendu   : ${tr.text}`);
  }
  const P = (e: number, t: number) => Number(((100 * e) / t).toFixed(1));
  const out = {
    lang, model: ASR_MODEL, corpus: 'Common Voice 27.0, partie test (CC0)', clips: n, speakers: speakers.size, audioMinutes: Number((audio / 60).toFixed(1)),
    wer: { strict: P(acc.strict.we, acc.strict.w), withoutTones: P(acc.loose.we, acc.loose.w) },
    cer: { strict: P(acc.strict.ce, acc.strict.c), withoutTones: P(acc.loose.ce, acc.loose.c) },
    realTimeFactor: Number((decode / 1000 / audio).toFixed(3)), measuredAt: new Date().toISOString(),
  };
  const dir = fileURLToPath(new URL('../data/eval/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}asr-${lang}.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  console.log('Exemples (non conservés) :\n' + examples.join('\n'));
} finally { rmSync(work, { recursive: true, force: true }); }
