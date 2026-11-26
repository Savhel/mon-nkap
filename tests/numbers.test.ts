// Grammaire des nombres apprise à partir d'exemples.
// - Le français sert d'exemple réel d'ordre additif (« cinq mille »).
// - La « langue zz » est FICTIVE, inventée pour ce test uniquement : elle vérifie la logique « multiplicateur
//   d'abord » (« mille cinq » = 5 000) sans prétendre décrire une langue camerounaise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, learnGrammar, numeralize, type NumberEntry } from '../src/linguistics/numbers.ts';

const e = (value: number, text: string, validated = true): NumberEntry => ({ value, text, validated });

const FR: NumberEntry[] = [
  e(1, 'un'), e(2, 'deux'), e(3, 'trois'), e(5, 'cinq'), e(10, 'dix'), e(20, 'vingt'), e(50, 'cinquante'),
  e(100, 'cent'), e(1000, 'mille'), e(1_000_000, 'un million'),
  e(5000, 'cinq mille'), e(25000, 'vingt-cinq mille'), e(150000, 'cent cinquante mille'), e(1100, 'mille cent'),
];

// Langue fictive : ko = 100, kilo = 1000, na = liaison (« et »).
const ZZ: NumberEntry[] = [
  e(1, 'pa'), e(2, 'ba'), e(5, 'tano'), e(20, 'mowa'), e(50, 'motano'), e(100, 'ko'), e(1000, 'kilo'),
  e(5000, 'kilo tano'), e(25000, 'kilo mowa na tano'), e(150000, 'kilo ko na motano'), e(1500, 'kilo na ko tano'),
  e(2000, 'kilo ba'),
];

test('français : ordre additif choisi, tous les montants composés reconstruits', () => {
  const g = learnGrammar(FR);
  assert.equal(g.order, 'additive');
  assert.deepEqual(g.failures, []);
});

test('langue fictive : ordre « multiplicateur d’abord » choisi, liaison comprise comme une addition', () => {
  const g = learnGrammar(ZZ);
  assert.equal(g.order, 'multiplier_first');
  assert.deepEqual(g.connectors, ['na']);
  assert.deepEqual(g.failures, []);
  assert.equal(compose([1000, 5], 'multiplier_first'), 5000);
  assert.equal(compose([1000, '+', 100, 5], 'multiplier_first'), 1500);
});

test('un montant jamais vu est composé par la grammaire, au milieu d’une phrase', () => {
  const g = learnGrammar(ZZ);
  assert.equal(numeralize('lom kilo mowa na ba a Marie', g), 'lom 22000 a marie'); // 1000 × (20 + 2)
  assert.equal(numeralize('kilo ba', g), '2000');
});

test('les montants écrits en chiffres restent exacts dans une langue qui a sa grammaire des nombres', () => {
  const g = learnGrammar(ZZ);
  assert.equal(numeralize('lom 5 000 FCFA a Marie', g), 'lom 5000 fcfa a marie');
  assert.equal(numeralize('lom 12 500 FCFA', g), 'lom 12500 fcfa');           // avant : 12 + 500 = 512
  assert.equal(numeralize('lom 150.000 FCFA', g), 'lom 150000 fcfa');
  assert.equal(numeralize('lom a 655 77 88 99', g), 'lom a 655 77 88 99');    // un numéro n'est pas additionné
  assert.equal(numeralize('lom 25 kilo', g), 'lom 25000');                    // chiffres suivis d'un multiplicateur dit
});

test('« un » seul n’est pas un montant (en pidgin, « one » transcrit pour « wan », vouloir)', () => {
  const g = learnGrammar(ZZ);
  assert.equal(numeralize('a pa lom kilo tano', g), 'a pa lom 5000');        // « pa » = 1, seul : laissé en mot
  assert.equal(numeralize('kilo pa', g), '1000');                              // avec un autre nombre : composé (1000 × 1)
});

test('des chiffres dictés un par un forment un numéro, pas un montant', () => {
  const g = learnGrammar([...ZZ, e(6, 'sita'), e(9, 'nain')]);
  assert.equal(numeralize('a sita tano tano', g), 'a 655');
  assert.equal(numeralize('kilo tano', g), '5000');                           // multiplicateur + unité : un montant
});

test('un montant que la grammaire ne sait pas reconstruire est signalé, jamais deviné', () => {
  // « sept » et le pluriel « cents » n'ont jamais été donnés comme montants simples.
  const g = learnGrammar([...FR, e(7500, 'sept mille cinq cents')]);
  assert.equal(g.failures.length, 1);
  assert.equal(g.failures[0].value, 7500);
  assert.equal(g.failures[0].got, null);
});

test('une même expression donnée pour deux valeurs est écartée', () => {
  const g = learnGrammar([e(1, 'pa'), e(2, 'pa'), e(1000, 'kilo')]);
  assert.deepEqual(g.ambiguous, ['pa']);
  assert.ok(!('pa' in g.words));
});

test('mode « validé seulement » : une ligne non relue n’est pas apprise', () => {
  const g = learnGrammar([e(5, 'tano', false), e(1000, 'kilo')], { validatedOnly: true });
  assert.ok(!('tano' in g.words));
  assert.equal(g.words.kilo, 1000);
});
