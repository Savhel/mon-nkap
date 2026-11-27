import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAmounts, extractPhones, formatFcfa, normalizeSpokenPhones } from '../src/core/amounts.ts';

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

test('une dictée complète donne le numéro sans altérer le montant en lettres', () => {
  const text = normalizeSpokenPhones('a wan send twenty five thousand for six five five, seven seven, eight eight, nine nine');
  assert.deepEqual(extractPhones(text), ['655778899']);
  assert.deepEqual(v(text), [25000]);
  const withCountry = normalizeSpokenPhones('deux trois sept six cinq cinq sept sept huit huit neuf neuf');
  assert.deepEqual(extractPhones(withCountry), ['655778899']);
});

test('un numéro dicté incomplet ou une longue suite ne donnent jamais un numéro tronqué', () => {
  const text = normalizeSpokenPhones('envoie 5000 à six cinq cinq sept sept huit huit neuf');
  assert.deepEqual(extractPhones(text), []);
  assert.deepEqual(v(text), [5000]);
  assert.deepEqual(extractPhones('1655778899'), []);
});

test('virgule des milliers (« 5,000 », écrit par une reconnaissance vocale anglophone) : le FCFA n’a pas de décimales', () => {
  assert.deepEqual(extractAmounts('I wan send 5,000 for Marie').map((a) => a.value), [5000]);
  assert.deepEqual(extractAmounts('send 150,000 FCFA').map((a) => a.value), [150000]);
  assert.deepEqual(extractAmounts('1,500,000 francs').map((a) => a.value), [1500000]);
});
