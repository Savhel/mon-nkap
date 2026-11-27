// Voix PlotWeaver : jamais pour une phrase qui contient un chiffre (montant, numéro, référence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plotweaverSpeech } from '../src/voice/plotweaver.ts';

test('PlotWeaver ne dit jamais une phrase avec un chiffre, et n’appelle même pas le service', async (t) => {
  process.env.CT_PLOTWEAVER_KEY = 'pw_test';
  process.env.CT_PLOTWEAVER_LANG_EWO = 'ewo';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => { calls.push(String(url)); return new Response(new Uint8Array(10), { headers: { 'content-type': 'audio/wav' } }); });
  assert.equal(await plotweaverSpeech('ewo', 'Mɔ́nə ó nə́ a kɔ́ntə : 125 000 FCFA'), null);
  assert.equal(calls.length, 0);
  assert.notEqual(await plotweaverSpeech('ewo', 'Mbəmbə ámos'), null);
  assert.equal(calls.length, 1);
  delete process.env.CT_PLOTWEAVER_KEY; delete process.env.CT_PLOTWEAVER_LANG_EWO;
});
