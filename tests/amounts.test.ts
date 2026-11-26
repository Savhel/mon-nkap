import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAmounts, extractPhones, formatFcfa } from '../src/core/amounts.ts';

const v = (t: string) => extractAmounts(t).map((a) => a.value);

test('montants en chiffres, avec séparateurs et devise', () => {
  assert.deepEqual(v('envoie 5 000 FCFA'), [5000]);
  assert.deepEqual(v('10.000f'), [10000]);
  assert.deepEqual(v('150 000 FCFA'), [150000]);
  assert.deepEqual(v('5 000 000 FCFA'), [5000000]);
  assert.deepEqual(v('10k'), [10000]);
});

test('montants en lettres, français et anglais', () => {
  assert.deepEqual(v('cinq mille francs'), [5000]);
  assert.deepEqual(v('vingt-cinq mille cinq cents'), [25500]);
  assert.deepEqual(v('quatre-vingt mille'), [80000]);
  assert.deepEqual(v('soixante-dix mille'), [70000]);
  assert.deepEqual(v('deux millions'), [2000000]);
  assert.deepEqual(v('send two thousand five hundred'), [2500]);
});

test('articles et numéros de téléphone ne sont pas des montants', () => {
  assert.deepEqual(v('un transfert de trois mille'), [3000]);
  assert.deepEqual(v('appelle le 677 11 22 33'), []);
  assert.deepEqual(v('envoie 5 000 à 6 99 44 55 66'), [5000]);
  assert.deepEqual(extractPhones('envoie 5 000 à 6 99 44 55 66'), ['699445566']);
  assert.deepEqual(extractPhones('+237 677112233'), ['677112233']);
});

test("réparation des fautes d'ASR uniquement à côté d'un mot-nombre", () => {
  assert.deepEqual(v('combien coute les frais pour un trancert deving mille francs'), [20000]);
  assert.deepEqual(v('trante mille'), [30000]);
  assert.deepEqual(v('pour deux mille'), [2000]); // « pour » n'est pas réparé en « four »
});

test("après des chiffres, seul un multiplicateur prolonge le montant", () => {
  assert.deepEqual(v('boro 3000 one'), [3000]);        // « one » : particule en fulfulde, pas « 1 »
  assert.deepEqual(v('3000 5'), [3000, 5]);
  assert.deepEqual(v('5 mille'), [5000]);
  assert.deepEqual(v('5 mille 500'), [5500]);
  assert.deepEqual(v('2 thousand five hundred'), [2500]);
});

test('formatage FCFA', () => {
  assert.equal(formatFcfa(150000, 'fr'), '150 000 FCFA');
  assert.equal(formatFcfa(150000, 'en'), '150,000 FCFA');
});
