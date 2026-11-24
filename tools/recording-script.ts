// Génère la liste des phrases à enregistrer à partir du catalogue du moteur (src/voice/native.ts),
// pour qu'elle ne puisse jamais diverger du code.
//   node tools/recording-script.ts [dossier de sortie]
import { writeFileSync } from 'node:fs';
import { PHRASES } from '../src/voice/native.ts';

const out = process.argv[2] ?? 'docs';
const csvEsc = (s: string) => `"${s.replace(/"/g, '""')}"`;
const rows = [['priorite', 'groupe', 'nom_du_fichier', 'phrase_en_francais', 'consigne', 'traduction_dite (a remplir)'].join(',')];
for (const p of PHRASES) rows.push([p.priority, p.group, `${p.key}.wav`, p.fr, p.note ?? '', ''].map((x) => csvEsc(String(x))).join(','));
writeFileSync(`${out}/enregistrements.csv`, '﻿' + rows.join('\n') + '\n');
const p1 = PHRASES.filter((p) => p.priority === 1).length;
console.log(`${PHRASES.length} phrases (${p1} prioritaires) → ${out}/enregistrements.csv`);
