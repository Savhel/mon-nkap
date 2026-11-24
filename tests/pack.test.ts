// Chaîne complète « tableurs des natifs → pack → moteur », avec une langue FICTIVE (code « zz ») dont tous
// les mots sont inventés pour ce test. Elle ne décrit aucune langue réelle : elle vérifie la mécanique
// (import, rejets, nombres en mots, intentions apprises, réponses natives, confirmation, correction).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, packReport } from '../src/linguistics/importer.ts';
import { setPack, clearPackCache } from '../src/linguistics/pack.ts';
import { clearRuntimeCache, runtimeFor } from '../src/linguistics/runtime.ts';
import { clearLexiconCache } from '../src/core/nlu.ts';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

const ok = { auteur: 'Natif A', relecteur: 'Natif B', statut: 'valide' };
const row = (o: Record<string, string>, v = ok) => ({ ...v, ...o });

const sheets = {
  nombres: [
    row({ valeur: '1', comment_on_le_dit: 'pa' }), row({ valeur: '2', comment_on_le_dit: 'ba' }), row({ valeur: '3', comment_on_le_dit: 'sa' }),
    row({ valeur: '5', comment_on_le_dit: 'tano' }), row({ valeur: '20', comment_on_le_dit: 'mowa' }),
    row({ valeur: '100', comment_on_le_dit: 'ko' }), row({ valeur: '1000', comment_on_le_dit: 'kilo' }),
    row({ valeur: '5000', comment_on_le_dit: 'kilo tano' }), row({ valeur: '25000', comment_on_le_dit: 'kilo mowa na tano' }),
    row({ valeur: '2000', comment_on_le_dit: 'kilo ba' }), row({ valeur: '1500', comment_on_le_dit: 'kilo na ko tano' }),
  ],
  lexique: [
    row({ id: 'yes', mot_ou_expression: 'tiyo', variantes: 'tiyo ka' }), row({ id: 'no', mot_ou_expression: 'nopa' }),
    row({ id: 'cancel', mot_ou_expression: 'zuba' }), row({ id: 'correction', mot_ou_expression: 'rivo' }),
    row({ id: 'send', mot_ou_expression: 'vela' }), row({ id: 'balance', mot_ou_expression: 'kubo mira' }),
    row({ id: 'fees', mot_ou_expression: 'tasi' }), row({ id: 'history', mot_ou_expression: 'pelo' }),
  ],
  demandes: [
    ...['mira kubo laso', 'kubo laso venti', 'kubo laso', 'dumi kubo laso', 'kubo laso ra', 'gudo kubo laso', 'kubo laso dimo', 'heno kubo laso']
      .map((phrase) => row({ situation_id: 'bal1', phrase })),
    row({ situation_id: 'tr1', phrase: 'vela kilo tano iko Marie' }),
  ],
  reponses: [
    row({ id: 'balance', votre_phrase: 'Kubo ra : {solde}.' }),
    row({ id: 'confirm_transfer', votre_phrase: 'Vela {montant} iko {nom} ({numero}). Tasi : {frais}. Doka : {total}. Tiyo ?' }),
    row({ id: 'corrected', votre_phrase: 'Rivoda.' }),
    row({ id: 'transfer_done', votre_phrase: 'Velado : {montant} iko {nom}. {reference}. Kubo ra : {solde}.' }),
    row({ id: 'fee_quote', votre_phrase: 'Vela {montant}, tasi : {frais}.' }),                         // {total} perdu → rejeté
    row({ id: 'insufficient', votre_phrase: 'Kubo nopa. Ra 5 000 FCFA. {solde} {requis} {manque}' }),  // chiffre → rejeté
    row({ id: 'menu_confirm', votre_phrase: 'Tiyo' }), row({ id: 'menu_cancel', votre_phrase: 'Nopa' }),
  ],
  definitions: [row({ id: 'fees', votre_explication: 'Tasi da kubo vela rano.' })],
};

let engine: Engine; let n = 0;
beforeEach(() => {
  clearPackCache(); clearRuntimeCache(); clearLexiconCache();
  setPack('zz', buildPack('zz', sheets));
  engine = new Engine(new MockBackend()); n++;
});
const say = (text: string) => engine.handle({ sessionId: `zz${n}`, channel: 'ussd', lang: 'zz', text });

test('import : une réponse qui perd un repère ou contient un chiffre est rejetée, avec la raison', () => {
  const p = buildPack('zz', sheets);
  const reasons = p.rejected.map((r) => `${r.sheet}:${r.reason}`);
  assert.ok(reasons.some((r) => r.startsWith('reponses:repères')), reasons.join(' | '));
  assert.ok(reasons.some((r) => r.startsWith('reponses:chiffre')), reasons.join(' | '));
  assert.ok(!('fee_quote' in p.responses));
  assert.equal(packReport(p).rejected, 2);
});

test('compréhension : l’intention est apprise des phrases d’entraînement des natifs', async () => {
  const rt = runtimeFor('zz')!;
  assert.ok(rt.lexicon.learned.some((l) => l.intent === 'CONSULT_BALANCE' && l.phrase === 'kubo laso'), JSON.stringify(rt.lexicon.learned));
  const r = await say('kubo laso');
  assert.equal(r.intent, 'balance');
  assert.equal(r.reply.text, 'Kubo ra : 150 000 FCFA.');
  assert.equal(r.reply.quality, 'validated');
});

test('transfert dit entièrement dans la langue : montant en mots, confirmation, exécution', async () => {
  const a = await say('vela kilo mowa na ba iko Marie');          // 1000 × (20 + 2) = 22 000, jamais vu tel quel
  assert.equal(a.status, 'awaiting_confirmation');
  assert.equal(a.params.amount, 22000);
  assert.equal(a.params.beneficiary, 'Marie Ngo Bassa');
  assert.match(a.reply.text, /^Vela 22 000 FCFA iko Marie Ngo Bassa/);
  assert.deepEqual(a.reply.menu?.map((m) => m.label), ['Tiyo', 'Nopa']);
  const b = await say('tiyo');
  assert.equal(b.status, 'executed');
  assert.equal(b.transaction?.amount, 22000);
});

test('correction dans la langue avant exécution', async () => {
  await say('vela kilo tano iko Marie');
  const c = await say('nopa, rivo kilo sa');
  assert.equal(c.params.amount, 3000);
  assert.equal(c.status, 'awaiting_confirmation');
  assert.match(c.reply.text, /^Rivoda\. Vela 3 000 FCFA/);
});

test('une réponse sans phrase native validée n’est jamais inventée : repli signalé', async () => {
  const r = await say('tasi kilo tano');                                // fee_quote a été rejeté à l'import
  assert.equal(r.intent, 'fees');
  assert.notEqual(r.reply.quality, 'validated');
});

test('une ligne non relue par un second natif n’est pas utilisée', async () => {
  clearPackCache(); clearRuntimeCache(); clearLexiconCache();
  const draft = { auteur: 'Natif A', relecteur: '', statut: '' };
  setPack('zz', buildPack('zz', { ...sheets, reponses: [row({ id: 'balance', votre_phrase: 'Kubo : {solde}.' }, draft)] }));
  const r = await engine.handle({ sessionId: 'draft', channel: 'web', lang: 'zz', text: 'kubo laso' });
  assert.notEqual(r.reply.text, 'Kubo : 150 000 FCFA.');
});
