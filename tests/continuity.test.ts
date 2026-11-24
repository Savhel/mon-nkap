// Continuité entre canaux : un transfert préparé par USSD est confirmé par SMS, avec le même numéro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { UssdChannel } from '../src/channels/ussd.ts';
import { SmsChannel } from '../src/channels/sms.ts';

test('commencé par USSD, confirmé par SMS (même numéro), exécuté une seule fois', async () => {
  const backend = new MockBackend(); const engine = new Engine(backend);
  const ussd = new UssdChannel(engine, { continuity: true }); const sms = new SmsChannel(engine, { continuity: true });
  const phone = '+237677112233';
  await ussd.handle({ sessionId: 'u1', phoneNumber: phone, text: '' });
  await ussd.handle({ sessionId: 'u1', phoneNumber: phone, text: '1' });                  // français
  const a = await ussd.handle({ sessionId: 'u1', phoneNumber: phone, text: '1*envoie 5000 a Marie' });
  assert.equal(a.result?.status, 'awaiting_confirmation');
  const b = await sms.handle({ from: phone, text: 'oui' });
  assert.equal(b.result.status, 'executed');
  assert.equal(b.result.transaction?.amount, 5000);
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000 - 5100);
});

test('sans continuité, les canaux restent séparés', async () => {
  const engine = new Engine(new MockBackend());
  const ussd = new UssdChannel(engine); const sms = new SmsChannel(engine);
  await ussd.handle({ sessionId: 'u2', phoneNumber: '677112233', text: '' });
  await ussd.handle({ sessionId: 'u2', phoneNumber: '677112233', text: '1' });
  await ussd.handle({ sessionId: 'u2', phoneNumber: '677112233', text: '1*envoie 5000 a Marie' });
  const b = await sms.handle({ from: '677112233', text: 'oui' });
  assert.notEqual(b.result.status, 'executed');
});

test('API : la confirmation par jeton retrouve la session rattachée au numéro (userPhone)', async () => {
  const { createApp } = await import('../src/api/server.ts');
  const { server: app } = createApp(undefined, { auditFile: null });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  try {
    const post = (p: string, b: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const m = await (await post('/v1/message', { sessionId: 'w1', channel: 'web', lang: 'fr', text: 'envoie 5000 francs à Marie Ngo Bassa', userPhone: '677000111' })).json();
    const token = m.canonical?.confirmationToken;
    assert.ok(token, 'jeton présent');
    const c = await post('/v1/confirm', { sessionId: 'w1', token, channel: 'web', userPhone: '677000111' });
    assert.equal(c.status, 200);
    assert.equal((await post('/v1/confirm', { sessionId: 'w1', token, channel: 'web', userPhone: '677000111' })).status, 409, 'jeton à usage unique');
  } finally { app.close(); }
});
