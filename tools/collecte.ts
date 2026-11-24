// Génère les tableurs de collecte pour les locuteurs natifs, une langue par dossier.
//   node tools/collecte.ts dua ewo fub wes [autres codes…]
// Un tableur déjà présent n'est JAMAIS écrasé (il contient peut-être le travail d'un natif).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { CONCEPTS, DEFINITIONS, NUMBER_TARGETS, RESPONSES, SITUATIONS, TRACE_COLUMNS } from '../src/linguistics/collection.ts';
import { writeCsv } from '../src/linguistics/csv.ts';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../collecte/', import.meta.url));
const langs = process.argv.slice(2);
if (!langs.length) { console.error('Usage : node tools/collecte.ts <code langue> […]   ex. dua ewo fub wes'); process.exit(1); }

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/ /g, ' ');
const blank = TRACE_COLUMNS.map(() => '');
const SLOTS_PER_SITUATION = 3; // trois lignes vides par situation : un natif peut en ajouter autant qu'il veut

const sheets: Record<string, { header: string[]; rows: (string | number)[][] }> = {
  nombres: {
    header: ['valeur', 'en_chiffres', 'comment_on_le_dit', 'autre_facon', ...TRACE_COLUMNS],
    rows: NUMBER_TARGETS.map((v) => [v, `${fmt(v)} FCFA`, '', '', ...blank]),
  },
  lexique: {
    header: ['id', 'en_francais', 'precision', 'mot_ou_expression', 'variantes', ...TRACE_COLUMNS],
    rows: CONCEPTS.map((c) => [c.id, c.fr, c.hint, '', '', ...blank]),
  },
  demandes: {
    header: ['situation_id', 'intention', 'situation', 'phrase', ...TRACE_COLUMNS],
    rows: SITUATIONS.flatMap((s) => Array.from({ length: SLOTS_PER_SITUATION }, () => [s.id, s.intent, s.situation, '', ...blank])),
  },
  reponses: {
    header: ['id', 'en_francais', 'reperes_a_garder', 'votre_phrase', ...TRACE_COLUMNS],
    rows: RESPONSES.map((r) => [r.id, r.fr, r.placeholders.map((p) => `{${p}}`).join(' '), '', ...blank]),
  },
  definitions: {
    header: ['id', 'en_francais', 'votre_explication', ...TRACE_COLUMNS],
    rows: DEFINITIONS.map((d) => [d.id, d.fr, '', ...blank]),
  },
};

for (const lang of langs) {
  if (!/^[a-z]{2,3}$/.test(lang)) { console.error(`code langue invalide : ${lang}`); continue; }
  const dir = `${root}${lang}/`;
  mkdirSync(dir, { recursive: true });
  for (const [name, s] of Object.entries(sheets)) {
    const f = `${dir}${name}.csv`;
    if (existsSync(f)) { console.log(`  ${lang}/${name}.csv existe déjà : conservé`); continue; }
    writeFileSync(f, writeCsv(s.header, s.rows));
    console.log(`  ${lang}/${name}.csv : ${s.rows.length} lignes`);
  }
}
