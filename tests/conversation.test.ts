// Mode conversation : une phrase dictée part comme « voix ». Le moteur ne la laisse jamais confirmer un envoi,
// même si elle dit « oui » ou « 1 » : seul le bouton (jeton) ou une saisie au clavier confirme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server.ts';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

test('/v1/message : un « oui » dicté n’exécute rien, le bouton Confirmer si', async () => {
  const { server } = createApp(new Engine(new MockBackend()), { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const say = async (text: string, input?: string) => (await fetch(`${base}/v1/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'conv', channel: 'mobile', lang: 'fr', text, ...(input ? { input } : {}) }),
  })).json() as Promise<{ status: string; canonical: { confirmationToken?: string } }>;
  try {
    const recap = await say('envoie 5000 à Marie', 'voice');
    assert.equal(recap.status, 'awaiting_confirmation');
    for (const yes of ['oui', '1', 'je confirme']) assert.notEqual((await say(yes, 'voice')).status, 'executed', yes);
    const again = await say('oui', 'voice');
    const done = await (await fetch(`${base}/v1/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: 'conv', token: again.canonical.confirmationToken, channel: 'mobile' }) })).json() as { status: string };
    assert.equal(done.status, 'executed');
  } finally { server.close(); }
});
