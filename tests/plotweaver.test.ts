// Voix PlotWeaver : jamais pour une phrase qui contient un chiffre (montant, numéro, référence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plotweaverSpeech, speakable } from '../src/voice/plotweaver.ts';

test('PlotWeaver ne reçoit jamais un chiffre : la phrase est dite sans ses montants, numéros et références', async (t) => {
  process.env.CT_PLOTWEAVER_KEY = 'pw_test';
  process.env.CT_PLOTWEAVER_LANG_EWO = 'ewo';
  const sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body)).text); return new Response(new Uint8Array(10), { headers: { 'content-type': 'audio/wav' } }); });
  const balance = await plotweaverSpeech('ewo', 'Mɔ́nə ó nə́ a kɔ́ntə : 125 000 FCFA');
  assert.equal(balance?.omitted, true);
  assert.equal(sent[0], 'Mɔ́nə ó nə́ a kɔ́ntə');
  assert.equal((await plotweaverSpeech('ewo', 'Mbəmbə ámos'))?.omitted, false);
  assert.equal(sent[1], 'Mbəmbə ámos');
  assert.equal(await plotweaverSpeech('ewo', '150 000 FCFA'), null);   // rien à dire sans le montant : pas d'appel
  assert.equal(sent.length, 2);
  for (const text of sent) assert.doesNotMatch(text, /\d/);
  delete process.env.CT_PLOTWEAVER_KEY; delete process.env.CT_PLOTWEAVER_LANG_EWO;
});

test('speakable : retire montants, numéros et références sans laisser de ponctuation orpheline', () => {
  assert.equal(speakable('ya balance na 125 000 FCFA')?.text, 'ya balance na');
  assert.equal(speakable('500 000 FCFA dis amount don pass ya daily limit.')?.text, 'dis amount don pass ya daily limit.');
  assert.equal(speakable('Vous allez envoyer 5 000 FCFA à Marie (655778899). Frais : 100 FCFA. Total : 5 100 FCFA. Confirmez-vous ?')?.text,
    'Vous allez envoyer à Marie. Frais. Total. Confirmez-vous ?');
  assert.equal(speakable('Référence TX9A2B.')?.text, 'Référence.');
  assert.equal(speakable('12 500'), null);
});
