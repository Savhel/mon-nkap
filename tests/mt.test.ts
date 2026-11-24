import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frenchTo, overlap, toFrench } from '../src/mt/flagship.ts';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

test('score aller-retour : identique = 1, sans rapport = 0', () => {
  assert.equal(overlap("Je veux envoyer de l'argent à Paul.", "Je veux envoyer l'argent à Paul."), 1);
  assert.equal(overlap('Votre solde est de cent francs.', 'Heureux les enfants !'), 0);
});

test('jamais de traduction automatique pour une phrase avec un chiffre', async () => {
  const r = await frenchTo('ewo', 'Votre solde est de 150 000 FCFA.');
  if (r) { assert.equal(r.accepted, false); assert.equal(r.reason, 'contient un chiffre'); }
});

const up = await fetch('http://127.0.0.1:8091/pairs', { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);

test('Flagship : requête en bulu comprise via le français, montant demandé', { skip: !up && 'service de traduction arrêté' }, async () => {
  const t = await toFrench('bum', 'Ma kômbô lôme moné be Marie');
  assert.ok(t && /envoyer/.test(t.fr));
  const e = new Engine(new MockBackend());
  const r = await e.handle({ sessionId: 'mt1', channel: 'api', lang: 'bum', text: 'Ma kômbô lôme moné be Marie' });
  assert.equal(r.understanding.via, 'mt');
  assert.equal(r.intent, 'transfer');
  assert.equal(r.params.beneficiary, 'Marie Ngo Bassa');
  assert.equal(r.status, 'needs_clarification'); // pas de montant inventé
});

test('Flagship : une traduction hors domaine est refusée et le texte reste en français', { skip: !up && 'service de traduction arrêté' }, async () => {
  const e = new Engine(new MockBackend());
  const r = await e.handle({ sessionId: 'mt2', channel: 'api', lang: 'ewo', text: 'aide' });
  assert.ok(r.reply.mt);
  if (!r.reply.mt.accepted) assert.equal(r.reply.text, r.reply.fr);
  else assert.equal(r.reply.quality, 'machine');
});
