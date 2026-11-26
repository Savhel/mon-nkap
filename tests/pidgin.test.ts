// Pidgin arrivant par le bac à sable SAFINUM, qui ne le propose pas : il est étiqueté français, anglais, « pcm » ou
// rien du tout. Phrases tirées du brouillon des natifs (« a wan send … tasen for Marie »).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CT_ALLOW_DRAFT = '1';
const { extractAmounts } = await import('../src/core/amounts.ts');
const { interpret } = await import('../src/core/nlu.ts');
const { Engine } = await import('../src/core/engine.ts');
const { MockBackend } = await import('../src/backend/mock.ts');
const { SafinumChannel } = await import('../src/channels/safinum.ts');

test('« five tasen » n’est jamais lu 5 : sans grammaire du pidgin, aucun montant (le moteur redemande)', () => {
  assert.deepEqual(extractAmounts('a wan send five tasen for Marie').map((a) => a.value), []);
  assert.deepEqual(extractAmounts('send ten ke').map((a) => a.value), []);
  assert.deepEqual(extractAmounts('send five thousand').map((a) => a.value), [5000]);
});

test('étiqueté français ou anglais, un montant pidgin est lu avec la grammaire du pidgin', () => {
  assert.deepEqual(interpret('a wan send five tasen for Marie', 'fr').amounts, [5000]);
  assert.deepEqual(interpret('a wan send twenty five tasen', 'en').amounts, [25000]);
});

test('SAFINUM : « pcm » et « pidgin » sont compris comme le pidgin camerounais (wes)', async () => {
  const ch = new SafinumChannel(new Engine(new MockBackend()));
  for (const [i, language] of ['pcm', 'pidgin'].entries()) {
    const r = await ch.handle({ trace_id: `t${i}`, session_id: `pcm${i}`, channel: 'mobile', language, input: { type: 'text', text: 'a wan know ma balance' } } as never) as { interpretation: { language: string; intent: string } };
    assert.equal(r.interpretation.language, 'wes');
    assert.equal(r.interpretation.intent, 'BALANCE_INQUIRY');
  }
});
