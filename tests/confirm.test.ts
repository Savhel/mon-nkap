// Oui ou non, avec la tolérance aux fautes de la reconnaissance vocale. Cas réel : en fulfulde (brouillon des
// natifs), « mi djabbi » = je confirme, « mi djabbay » = j'annule, et la reconnaissance vocale a rendu le mot
// « annuler » dit par un natif par « mijabai ». Un oui approximatif ne doit jamais l'emporter sur un non proche.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CT_ALLOW_DRAFT = '1';
const { interpret } = await import('../src/core/nlu.ts');
const yesNo = (t: string, lang: string) => { const i = interpret(t, lang); return [i.isConfirm, i.isDeny]; };

test('fulfulde : « annuler » mal transcrit n’est jamais pris pour un oui', () => {
  // « mijabai » : « mi djabbay » (j'annule) transcrit par la voix. Sous l'orthographe commune, c'est un refus.
  assert.deepEqual(yesNo('mijabai', 'fub'), [false, true]);
  assert.deepEqual(yesNo('mi djabbi', 'fub'), [true, false]);
  assert.deepEqual(yesNo('mi jabbi', 'fub'), [true, false]);      // une lettre perdue, toujours nettement un oui
  assert.deepEqual(yesNo('mi djabbay', 'fub'), [false, true]);
  assert.deepEqual(yesNo('kay', 'fub'), [false, true]);           // « non » en fulfulde, malgré l'anglais « okay »
  // Orthographe officielle (celle de la reconnaissance vocale) : mêmes réponses qu'à la française.
  assert.deepEqual(yesNo('mi jabi', 'fub'), [true, false]);
  assert.deepEqual(yesNo('mi jabay', 'fub'), [false, true]);
});

test('français et anglais : oui, non, et les deux à la fois', () => {
  assert.deepEqual(yesNo('oui', 'fr'), [true, false]);
  assert.deepEqual(yesNo('non', 'fr'), [false, true]);
  assert.deepEqual(yesNo('oui non', 'fr'), [false, true]);
  assert.deepEqual(yesNo('yes please', 'en'), [true, false]);
  assert.deepEqual(yesNo('no thanks', 'en'), [false, true]);
});
