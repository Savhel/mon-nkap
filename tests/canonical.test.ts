// Représentation canonique cmfi.v1 : identique quel que soit le canal ; retrait (canal GAB).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, type Channel } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

let engine: Engine; let backend: MockBackend; let n = 0;
beforeEach(() => { backend = new MockBackend(); engine = new Engine(backend); n++; });

test('la même demande produit la même représentation canonique sur les 6 canaux', async () => {
  const channels: Channel[] = ['mobile', 'web', 'ussd', 'sms', 'ivr', 'atm'];
  const rs = await Promise.all(channels.map((c, i) => engine.handle({ sessionId: `c${n}-${i}`, channel: c, lang: 'fr', text: 'envoie 2000 à Aminatou' })));
  const strip = (x: typeof rs[0]['canonical']) => ({ ...x, channel: undefined, confirmationToken: undefined });
  for (const r of rs) {
    assert.equal(r.canonical.schema, 'cmfi.v1');
    assert.equal(r.canonical.operation, 'TRANSFER_MONEY');
    assert.equal(r.canonical.act, 'REQUEST');
    assert.deepEqual(r.canonical.entities, { amount: 2000, currency: 'XAF', fee: 100, total: 2100, beneficiary: { name: 'Aminatou Bello', phone: '690001122' } });
    assert.equal(r.canonical.requiresConfirmation, true);
    assert.deepEqual(strip(r.canonical), strip(rs[0].canonical));
  }
});

test('confirmation et correction gardent l’opération dans la représentation canonique', async () => {
  const sid = `k${n}`;
  await engine.handle({ sessionId: sid, channel: 'web', lang: 'fr', text: 'envoie 5000 à Marie' });
  const c = await engine.handle({ sessionId: sid, channel: 'web', lang: 'fr', text: 'non plutôt 3000' });
  assert.equal(c.canonical.act, 'CORRECT');
  assert.equal(c.canonical.operation, 'TRANSFER_MONEY');
  assert.equal(c.canonical.entities.amount, 3000);
  const d = await engine.handle({ sessionId: sid, channel: 'web', lang: 'fr', text: 'oui' });
  assert.equal(d.canonical.act, 'CONFIRM');
  assert.equal(d.canonical.operation, 'TRANSFER_MONEY');
  assert.equal(d.canonical.status, 'executed');
  assert.ok(d.canonical.entities.reference);
});

test('retrait au GAB : frais, confirmation, exécution, multiples de 500 seulement', async () => {
  const a = await engine.handle({ sessionId: `w${n}`, channel: 'atm', lang: 'fr', text: 'je veux retirer 10000' });
  assert.equal(a.canonical.operation, 'WITHDRAW_MONEY');
  assert.equal(a.status, 'awaiting_confirmation');
  assert.deepEqual([a.params.amount, a.params.fee, a.params.total], [10000, 100, 10100]);
  const b = await engine.handle({ sessionId: `w${n}`, channel: 'atm', lang: 'fr', text: '1' });
  assert.equal(b.status, 'executed');
  assert.match(b.reply.text, /Prenez vos billets/);
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000 - 10100);
  await engine.handle({ sessionId: `x${n}`, channel: 'atm', lang: 'fr', text: 'retrait de 1250' });
  const c = await engine.handle({ sessionId: `x${n}`, channel: 'atm', lang: 'fr', text: '1' });
  assert.equal(c.status, 'failed');
});

test('requête ambiguë : clarification demandée, rien n’est exécuté', async () => {
  const r = await engine.handle({ sessionId: `a${n}`, channel: 'mobile', lang: 'fr', text: 'envoie 5000 à Paul' });
  assert.equal(r.canonical.requiresClarification, true);
  assert.equal(r.canonical.requiresConfirmation, false);
});
