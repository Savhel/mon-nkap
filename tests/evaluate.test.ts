// Évaluation sur le jeu de test des natifs, avec la langue FICTIVE « zz » (mots inventés pour le test).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/linguistics/importer.ts';
import { setPack, clearPackCache } from '../src/linguistics/pack.ts';
import { clearRuntimeCache } from '../src/linguistics/runtime.ts';
import { clearLexiconCache } from '../src/core/nlu.ts';
import { evaluateLanguage } from '../src/eval/evaluate.ts';

const ok = { auteur: 'Natif A', relecteur: 'Natif B', statut: 'valide' };
const row = (o: Record<string, string>) => ({ ...ok, ...o });

beforeEach(() => {
  clearPackCache(); clearRuntimeCache(); clearLexiconCache();
  const pack = buildPack('zz', {
    nombres: [['1', 'pa'], ['3', 'sa'], ['5', 'tano'], ['1000', 'kilo'], ['5000', 'kilo tano'], ['3000', 'kilo sa']].map(([valeur, comment_on_le_dit]) => row({ valeur, comment_on_le_dit })),
    lexique: [row({ id: 'send', mot_ou_expression: 'vela' }), row({ id: 'balance', mot_ou_expression: 'kubo mira' }), row({ id: 'yes', mot_ou_expression: 'tiyo' }), row({ id: 'correction', mot_ou_expression: 'rivo' })],
    demandes: [
      row({ situation_id: 'bal1', phrase: 'kubo mira' }), row({ situation_id: 'tr1', phrase: 'vela kilo tano iko Marie' }),
      row({ situation_id: 'cor1', phrase: 'rivo kilo sa' }), row({ situation_id: 'yes1', phrase: 'tiyo' }),
      row({ situation_id: 'his1', phrase: 'dumi pelo' }),                         // aucun mot connu : doit échouer honnêtement
    ],
  });
  for (const u of pack.utterances) u.split = 'test';                          // tout en test pour ce contrôle
  setPack('zz', pack);
});

test('métriques calculées sur le jeu de test, échec compté tel quel', async () => {
  const ev = await evaluateLanguage('zz');
  assert.equal(ev.n, 5);
  assert.equal(ev.intentAccuracy, 0.8);                 // 4 / 5 : « dumi pelo » n'est pas compris
  assert.equal(ev.amountAccuracy, 1);                   // 5 000 et 3 000 (correction)
  assert.equal(ev.beneficiaryAccuracy, 1);
  assert.equal(ev.crossChannelConsistency, 1);
  assert.equal(ev.perIntent.VIEW_HISTORY.recall, 0);
  assert.ok(ev.items.find((x) => x.situation === 'yes1')?.intentOk);
});

test('langue sans phrase de test validée : aucune métrique inventée', async () => {
  clearPackCache(); setPack('zz', buildPack('zz', {}));
  const ev = await evaluateLanguage('zz');
  assert.equal(ev.n, 0);
  assert.equal(ev.intentAccuracy, null);
  assert.match(ev.note ?? '', /Aucune phrase de test/);
});
