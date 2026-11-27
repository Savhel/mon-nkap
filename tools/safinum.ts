// Outil CLI pour configurer le bac à sable SAFINUM (https://safinum.cm/api/v1) :
//   CT_SAFINUM_KEY="sbx_..." npm run safinum -- endpoint https://mon-tunnel.ngrok-free.app/safinum/middleware
//   CT_SAFINUM_KEY="sbx_..." npm run safinum -- status
//   CT_SAFINUM_KEY="sbx_..." npm run safinum -- reset
import { getSafinumEndpoints, registerSafinumEndpoint, resetSafinumSandbox } from '../src/backend/safinum.ts';

const [, , cmd, ...rest] = process.argv;
if (!process.env.CT_SAFINUM_KEY) {
  console.error('Définissez CT_SAFINUM_KEY="sbx_..." avant d’exécuter cette commande.');
  process.exit(1);
}

if (cmd === 'endpoint') {
  const url = rest[0];
  if (!url) {
    console.error('Usage : CT_SAFINUM_KEY="sbx_..." npm run safinum -- endpoint <https://.../safinum/middleware> [ussd mobile web]');
    process.exit(1);
  }
  const channels = rest.slice(1).length ? rest.slice(1) : ['ussd', 'mobile', 'web', 'sms', 'atm', 'ivr'];
  for (const ch of channels) {
    const res = await registerSafinumEndpoint(ch, url);
    console.log(`${ch} → HTTP ${res.status}`, JSON.stringify(res.body));
  }
} else if (cmd === 'status') {
  const res = await getSafinumEndpoints();
  console.log(`HTTP ${res.status}`, JSON.stringify(res.body, null, 2));
} else if (cmd === 'reset') {
  const res = await resetSafinumSandbox();
  console.log(`HTTP ${res.status}`, JSON.stringify(res.body, null, 2));
} else {
  console.log('Commandes :');
  console.log('  npm run safinum -- endpoint <url_publique> [ussd mobile web]');
  console.log('  npm run safinum -- status');
  console.log('  npm run safinum -- reset');
  process.exit(cmd ? 1 : 0);
}
