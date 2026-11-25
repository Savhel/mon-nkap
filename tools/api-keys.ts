// Gestion en ligne de commande des clés d'API par entreprise bancaire.
//   npm run keys -- create banqueA --name "Banque A Cameroun"
//   npm run keys -- list
//   npm run keys -- revoke <id-ou-prefixe>
import { ApiKeys, DEFAULT_KEYS_FILE } from '../src/security/guards.ts';

const [, , cmd, ...rest] = process.argv;
const file = process.env.CT_KEYS_FILE ?? DEFAULT_KEYS_FILE;
const store = new ApiKeys('', file);

function argValue(flag: string): string | undefined {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
}

if (cmd === 'create') {
  const institution = rest.find((a) => !a.startsWith('--'));
  if (!institution) {
    console.error('Usage : npm run keys -- create <institution> [--name "Nom entreprise"]');
    process.exit(1);
  }
  const name = argValue('--name');
  const { key, record } = store.issue(institution, name);
  console.log(`Clé créée pour ${record.institution}${record.name ? ` (${record.name})` : ''} :`);
  console.log(`  ID      : ${record.id}`);
  console.log(`  Clé API : ${key}`);
  console.log(`  Fichier : ${store.storePath}`);
  console.log('\nConservez cette clé maintenant : seule son empreinte SHA-256 est enregistrée.');
  console.log(`Exemple HTTP : -H "x-api-key: ${key}"`);
} else if (cmd === 'list') {
  const items = store.list();
  if (!items.length) console.log(`Aucune clé enregistrée (${file}).`);
  else console.table(items);
} else if (cmd === 'revoke') {
  const target = rest[0];
  if (!target) {
    console.error('Usage : npm run keys -- revoke <id-ou-prefixe>');
    process.exit(1);
  }
  const r = store.revoke(target);
  if (!r) { console.error(`Aucune clé active trouvée pour « ${target} ».`); process.exit(1); }
  console.log(`Clé révoquée : ${r.id} (${r.institution}, préfixe ${r.prefix})`);
} else {
  console.log('Commandes :');
  console.log('  npm run keys -- create <institution> [--name "Nom entreprise"]');
  console.log('  npm run keys -- list');
  console.log('  npm run keys -- revoke <id-ou-prefixe>');
  process.exit(cmd ? 1 : 0);
}

