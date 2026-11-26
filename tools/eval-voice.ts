// Compare le texte de référence et, si demandé, la chaîne audio sur les mêmes annotations.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transcribe } from '../src/voice/speech.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { Engine } from '../src/core/engine.ts';
import { interpret } from '../src/core/nlu.ts';
import { levenshtein, normalize } from '../src/core/text.ts';
import { parseCsv } from '../src/linguistics/csv.ts';

const [lang, ...args] = process.argv.slice(2);
const textOnly = args.includes('--texte-seul');
const details = args.includes('--details');
if (!lang || !/^[a-z]{2,3}$/.test(lang) || args.some((arg) => !['--texte-seul', '--details'].includes(arg))) {
  console.error('Usage : node tools/eval-voice.ts <langue> [--texte-seul] [--details]');
  process.exit(1);
}

const dir = fileURLToPath(new URL(`../data/audio/${lang}/demandes/`, import.meta.url));
const rows = parseCsv(readFileSync(dir + 'labels.csv', 'utf8'));
const annotations = JSON.parse(readFileSync(new URL('../data/eval/voix-attendus.json', import.meta.url), 'utf8')) as Record<
  string, Record<string, { montant?: number; destinataire?: string; numero?: string; clarification?: boolean }>
>;
const contacts = await new MockBackend().listContacts('demo');

async function evaluate(text: string, situation: string, expectedIntent: string, expected: (typeof annotations)[string][string]) {
  const engine = new Engine(new MockBackend());
  if (['CORRECT', 'CONFIRM', 'CANCEL'].includes(expectedIntent)) {
    const initial = situation === 'cor2' ? 'envoie 5000 à Paul Mbarga' : 'envoie 5000 à Marie';
    await engine.handle({ sessionId: 'mesure', channel: 'api', lang: 'fr', text: initial });
  }
  const r = await engine.handle({ sessionId: 'mesure', channel: 'api', lang, text });
  const predicted = r.canonical.act === 'REQUEST' ? r.canonical.operation : r.canonical.act;
  const guess = interpret(text, lang, contacts);
  const names = r.canonical.entities.beneficiary?.name ? [r.canonical.entities.beneficiary.name] : guess.beneficiaryCandidates.map((candidate) => candidate.name);
  const requestedName = expected?.destinataire ? normalize(expected.destinataire) : null;
  const amount = guess.isCorrection ? guess.amounts.at(-1) : guess.amounts.length === 1 ? guess.amounts[0] : undefined;
  return {
    intention: predicted ?? 'UNKNOWN',
    intentionExacte: predicted === expectedIntent &&
      (expectedIntent !== 'CONFIRM' || r.status === 'executed') &&
      (expectedIntent !== 'CANCEL' || r.status === 'cancelled'),
    statut: r.status,
    montant: amount ?? null,
    montantExact: expected?.montant === undefined ? null : amount === expected.montant,
    destinataireExact: requestedName === null ? null : names.length > 0 && names.every((name) => normalize(name).split(' ').includes(requestedName)),
    numeroExact: expected?.numero === undefined ? null : guess.phone === expected.numero,
    clarificationExacte: expected?.clarification === undefined ? null : r.canonical.requiresClarification === expected.clarification,
    ouiEntenduATort: expectedIntent !== 'CONFIRM' && guess.isConfirm && !guess.isDeny,
    executionInattendue: expectedIntent !== 'CONFIRM' && r.status === 'executed',
  };
}

const normalized = (text: string) => normalize(text).replace(/ /g, '');
const items = [];
for (const row of rows) {
  if (!row.fichier || row.fichier !== basename(row.fichier)) throw new Error('Nom de fichier invalide dans labels.csv');
  const expected = annotations[lang]?.[row.fichier];
  const reference = row.texte_natif?.trim() ?? '';
  const texte = reference ? await evaluate(reference, row.situation_id, row.intention, expected) : null;
  const transcript = textOnly ? null : await transcribe(readFileSync(dir + row.fichier), lang);
  const voix = transcript ? await evaluate(transcript.text, row.situation_id, row.intention, expected) : null;
  items.push({
    fichier: row.fichier, situation: row.situation_id, attendu: row.intention, champsAttendus: expected,
    reference: reference || null, texte, voix, transcript,
  });
}

function summarize(section: 'texte' | 'voix') {
  const seen = items.flatMap((item) => item[section] ?? []);
  const score = (criterion: keyof (typeof seen)[number]) => {
    const values = seen.map((item) => item[criterion]).filter((value) => typeof value === 'boolean');
    return { exacts: values.filter(Boolean).length, total: values.length };
  };
  return {
    intentions: score('intentionExacte'), montants: score('montantExact'),
    destinataires: score('destinataireExact'), numeros: score('numeroExact'), clarifications: score('clarificationExacte'),
    ouiEntendusATort: score('ouiEntenduATort').exacts,
    executionsInattendues: score('executionInattendue').exacts,
  };
}

const paired = items.filter((item) => item.reference && item.transcript);
const characters = paired.reduce((n, item) => n + normalized(item.reference!).length, 0);
const errors = paired.reduce((n, item) => n + levenshtein(normalized(item.reference!), normalized(item.transcript!.text)), 0);
const summary = {
  lang, enregistrements: rows.length, texte: summarize('texte'), voix: textOnly ? null : summarize('voix'),
  moteurs: [...new Set(items.flatMap((item) => item.transcript?.engine ?? []))],
  cerSansTons: characters ? Number((100 * errors / characters).toFixed(1)) : null,
  corpus: `data/audio/${lang}/demandes`, statutDesDonnees: 'collecte de travail, non indépendante des règles existantes',
  measuredAt: new Date().toISOString(),
};
if (!textOnly) {
  const file = new URL(`../data/eval/voix-${lang}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ ...summary, items }, null, 1) + '\n');
}
console.log(JSON.stringify(details ? { ...summary, items } : summary, null, 1));
