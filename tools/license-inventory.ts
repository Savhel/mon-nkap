// Inventaire automatique des licences des dépendances npm installées → docs/THIRD_PARTY_LICENSES.md.
// Échoue (code 1) si une dépendance de production a une licence inconnue ou de la liste rouge.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const RED = /AGPL|^GPL|SSPL|CC-BY-NC|UNKNOWN/i;
const rows: { name: string; version: string; license: string; prod: boolean }[] = [];
const prodRoots = new Set(Object.keys(pkg.dependencies ?? {}));

function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.')) continue;
    const p = join(dir, e);
    if (e.startsWith('@')) { walk(p); continue; }
    const pj = join(p, 'package.json');
    if (!existsSync(pj)) continue;
    const m = JSON.parse(readFileSync(pj, 'utf8'));
    const license = typeof m.license === 'string' ? m.license : m.license?.type ?? 'UNKNOWN';
    const prod = prodRoots.has(m.name) || [...prodRoots].some((r) => m.name.startsWith(r.split('-node')[0]));
    rows.push({ name: m.name, version: m.version, license, prod });
    if (existsSync(join(p, 'node_modules'))) walk(join(p, 'node_modules'));
  }
}
walk(join(root, 'node_modules'));
rows.sort((a, b) => Number(b.prod) - Number(a.prod) || a.name.localeCompare(b.name));
const bad = rows.filter((r) => r.prod && RED.test(r.license));
const md = ['# Licences des dépendances (généré)', '', `Généré le ${new Date().toISOString().slice(0, 10)} par \`node tools/license-inventory.ts\`. Les modèles d'IA sont inventoriés à part dans [LICENSES.md](LICENSES.md).`, '',
  '| Paquet | Version | Licence | Usage |', '|---|---|---|---|', ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${r.prod ? 'production' : 'développement'} |`), ''].join('\n');
writeFileSync(join(root, 'docs/THIRD_PARTY_LICENSES.md'), md);
console.log(`${rows.length} paquets, ${bad.length} problème(s)`);
for (const b of bad) console.error(`LICENCE REFUSÉE : ${b.name}@${b.version} (${b.license})`);
process.exit(bad.length ? 1 : 0);
