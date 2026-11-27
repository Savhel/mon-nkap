// Crée des invitations à la collecte des natifs (/collecte) : un code personnel par personne et par langue.
//   node tools/invitations.ts <nombre de personnes> <langue> [langue…]     ex. node tools/invitations.ts 3 ewo dua fub
//   node tools/invitations.ts liste                                         invitations existantes
//   node tools/invitations.ts revoquer <pseudonyme>                         ex. node tools/invitations.ts revoquer c-66b704
// Les codes ne sont affichés qu'ici, une seule fois (seule leur empreinte est gardée). Aucun nom n'est enregistré.
import { readFileSync } from 'node:fs';
import { Contributions } from '../src/linguistics/contributions.ts';

const languages = JSON.parse(readFileSync(new URL('../data/languages.json', import.meta.url), 'utf8')) as { languages: { code: string; name: string }[] };
const known = new Map(languages.languages.map((l) => [l.code, l.name]));
const store = new Contributions();
const [first, ...rest] = process.argv.slice(2);

if (first === 'liste') {
  for (const i of store.listInvitations()) console.log(`${i.id}  ${i.lang.padEnd(4)} ${(known.get(i.lang) ?? '').padEnd(26)} ${i.createdAt.slice(0, 10)}  ${i.active ? 'active' : 'révoquée'}`);
  process.exit(0);
}
if (first === 'revoquer') {
  console.log(rest[0] && store.revoke(rest[0]) ? `Invitation ${rest[0]} révoquée.` : 'Pseudonyme inconnu ou déjà révoqué.');
  process.exit(0);
}

const count = Number(first);
const langs = rest.map((l) => l.toLowerCase());
const unknown = langs.filter((l) => !known.has(l));
if (!Number.isInteger(count) || count < 1 || count > 50 || !langs.length || unknown.length) {
  if (unknown.length) console.error(`Langue inconnue : ${unknown.join(', ')}. Codes possibles : ${[...known.keys()].filter((c) => c !== 'fr' && c !== 'en').join(' ')}`);
  console.error('Usage : node tools/invitations.ts <nombre de personnes (1 à 50)> <langue> [langue…]   ex. node tools/invitations.ts 3 ewo dua fub');
  process.exit(1);
}

const link = process.env.CT_COLLECTE_URL ?? 'https://audrina-nonintroverted-timorously.ngrok-free.dev/collecte';
console.log(`Lien à envoyer : ${link}\n`);
console.log('Langue                       Pseudonyme  Code à transmettre');
for (const lang of langs) {
  for (let n = 0; n < count; n++) {
    const { code, invitation } = store.invite(lang);
    console.log(`${`${known.get(lang)} (${lang})`.padEnd(28)} ${invitation.id}    ${code}`);
  }
}
console.log('\nCes codes ne seront plus affichés. Révoquer : node tools/invitations.ts revoquer <pseudonyme>');
