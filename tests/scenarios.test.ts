// Les 10 scénarios standardisés du brief de la finale SAFINUM (§7), plus la cohérence multicanale.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, type Channel } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

let backend: MockBackend;
let engine: Engine;
let n = 0;
beforeEach(() => { backend = new MockBackend(); engine = new Engine(backend); n++; });
const say = (text: string, lang?: string, channel: Channel = 'api', sid = `s${n}`) => engine.handle({ sessionId: sid, channel, text, lang });

test('1. Consultation du solde : solde exact', async () => {
  const r = await say('quel est mon solde', 'fr');
  assert.equal(r.intent, 'balance');
  assert.equal(r.params.balance, 150000);
  assert.match(r.reply.text, /150 000 FCFA/);
});

test('2. Transfert : montant et bénéficiaire corrects, confirmation avant exécution', async () => {
  const a = await say('envoie 5000 à Marie', 'fr');
  assert.equal(a.status, 'awaiting_confirmation');
  assert.equal(a.params.amount, 5000);
  assert.equal(a.params.beneficiary, 'Marie Ngo Bassa');
  assert.equal((await backend.getBalance('demo')).ok && (await backend.getBalance('demo') as { value: { balance: number } }).value.balance, 150000);
  const b = await say('oui');
  assert.equal(b.status, 'executed');
  assert.equal(b.transaction?.amount, 5000);
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000 - 5000 - 100);
});

test('3. Consultation des frais : frais et total expliqués', async () => {
  const r = await say('combien coûtent les frais pour un transfert de 20 000 francs', 'fr');
  assert.equal(r.intent, 'fees');
  assert.deepEqual([r.params.amount, r.params.fee, r.params.total], [20000, 200, 20200]);
});

test('4. Historique des transactions', async () => {
  const r = await say('montre mon historique', 'fr');
  assert.equal(r.intent, 'history');
  assert.match(r.reply.text, /ENEO/);
});

test('5. Correction de la requête avant exécution', async () => {
  await say('envoie 5000 à Marie', 'fr');
  const c = await say('non plutôt trois mille');
  assert.equal(c.intent, 'correction');
  assert.equal(c.params.amount, 3000);
  assert.equal(c.status, 'awaiting_confirmation');
  const d = await say('je confirme');
  assert.equal(d.transaction?.amount, 3000);
});

test('5b. Correction dans la même phrase', async () => {
  const r = await say('envoie 5000 non plutôt 4000 à Marie', 'fr');
  assert.equal(r.params.amount, 4000);
});

test('6. Requête ambiguë : clarification avant exécution', async () => {
  const a = await say('envoie 5000 à Paul', 'fr');
  assert.equal(a.status, 'needs_clarification');
  assert.equal(a.reply.menu?.length, 2);
  const b = await say('2');
  assert.equal(b.params.beneficiary, 'Paul Ekwalla');
  assert.equal(b.status, 'awaiting_confirmation');
  const c = await say('je veux 5000', 'fr', 'api', 'other');
  assert.equal(c.status, 'needs_clarification');
  assert.equal(c.intent, null);
});

test('7. Solde insuffisant : explication, rien n’est exécuté', async () => {
  const r = await say('envoie 200000 à Marie', 'fr');
  assert.equal(r.status, 'failed');
  assert.match(r.reply.text, /Solde insuffisant/);
  assert.match(r.reply.text, /52 000 FCFA/); // 200 000 + 2 000 de frais − 150 000
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000);
});

test('8. Changement de langue : l’opération en cours continue', async () => {
  await say('envoie 5000 à Marie', 'fr');
  const s = await say('parle-moi en duala');
  assert.equal(s.lang, 'dua');
  assert.equal(s.status, 'awaiting_confirmation');
  assert.equal(s.params.amount, 5000);
  const ok = await say('1');
  assert.equal(ok.status, 'executed');
  assert.equal(ok.lang, 'dua');
});

test('9. Interaction multicanale : même requête, même interprétation', async () => {
  const channels: Channel[] = ['mobile', 'web', 'ussd', 'sms', 'ivr'];
  const results = await Promise.all(channels.map((c, i) => engine.handle({ sessionId: `mc${i}`, channel: c, text: 'envoie 2000 à Aminatou', lang: 'fr' })));
  for (const r of results) {
    assert.equal(r.intent, 'transfer');
    assert.deepEqual([r.params.amount, r.params.beneficiary, r.params.fee], [2000, 'Aminatou Bello', 100]);
    assert.equal(r.reply.text, results[0].reply.text);
  }
});

test('10. Terminologie financière expliquée', async () => {
  const r = await say("c'est quoi les frais", 'fr');
  assert.equal(r.intent, 'explain_term');
  assert.match(r.reply.text, /en plus du montant/);
  const p = await say('wetin be pin', 'wes');
  assert.equal(p.params.term, 'pin');
});

test('Langues nationales : réponses marquées brouillon, montants intacts', async () => {
  for (const lang of ['ewo', 'dua', 'fub', 'wes']) {
    const r = await engine.handle({ sessionId: `nat-${lang}`, channel: 'api', text: 'solde', lang });
    assert.equal(r.reply.quality, 'draft', lang);
    assert.match(r.reply.text, /150 000 FCFA/, lang);
  }
});

test('Langue sans pack : repli explicite en français, jamais une fausse traduction', async () => {
  const r = await say('solde', 'bbj');
  assert.equal(r.reply.quality, 'fallback');
  assert.equal(r.reply.text, r.reply.fr);
});

test('Sortie ASR bruitée', async () => {
  const r = await say('quel est le sod de mon comte', 'fr');
  assert.equal(r.intent, 'balance');
});

test('Touche 2 = annuler, rien n’est débité', async () => {
  await say('envoie 5000 à Marie', 'fr');
  const r = await say('2');
  assert.equal(r.status, 'cancelled');
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000);
});

test('Le journal expose les champs du tableau de bord du jury', async () => {
  await say('solde', 'fr', 'ussd');
  const e = engine.log.at(-1)!;
  for (const k of ['channel', 'lang', 'request', 'intent', 'params', 'reply', 'status', 'latencyMs', 'errors']) assert.ok(k in e, k);
});

test('Fournisseur : « coûtent » n’est pas pris pour « courant » (ENEO)', async () => {
  const { interpret } = await import('../src/core/nlu.ts');
  assert.equal(interpret('combien coûtent les frais pour 20000', 'fr').biller, undefined);
  assert.equal(interpret('payer ma facture de courant', 'fr').biller, 'ENEO');
});
