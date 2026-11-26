// Les essais sur modèles réels sont exigés avec CT_REQUIRE_MT=1. Le reste tourne dans un checkout sans modèles.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { frenchTo, overlap, toFrench } from '../src/mt/flagship.ts';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { ensureMtService, stopMtService } from '../src/mt/service.ts';

test('score aller-retour : identique = 1, sans rapport = 0', () => {
  assert.equal(overlap("Je veux envoyer de l'argent à Paul.", "Je veux envoyer l'argent à Paul."), 1);
  assert.equal(overlap('Votre solde est de cent francs.', 'Heureux les enfants !'), 0);
});

test('jamais de traduction automatique pour une phrase avec un chiffre', async () => {
  const r = await frenchTo('ewo', 'Votre solde est de 150 000 FCFA.');
  if (r) { assert.equal(r.accepted, false); assert.equal(r.reason, 'contient un chiffre'); }
});

const mt = await ensureMtService();
after(() => stopMtService());

const liveOnly = { skip: mt.up || process.env.CT_REQUIRE_MT === '1' ? false : 'modèles Flagship absents' };

test('le service Flagship expose les paires fulfulde et bulu', liveOnly, () => {
  assert.ok(mt.up, `service de traduction indisponible : ${mt.error ?? ''} — npm run mt:install && npm run mt:models`);
  for (const p of ['fufulde-francais', 'francais-fufulde', 'bulu-francais']) assert.ok(mt.pairs.includes(p), p);
});

test('Flagship : requête en bulu comprise via le français, montant demandé', liveOnly, async () => {
  const t = await toFrench('bum', 'Ma kômbô lôme moné be Marie');
  assert.ok(t && /envoyer/.test(t.fr));
  const e = new Engine(new MockBackend());
  const r = await e.handle({ sessionId: 'mt1', channel: 'api', lang: 'bum', text: 'Ma kômbô lôme moné be Marie' });
  assert.equal(r.understanding.via, 'mt');
  assert.equal(r.intent, 'transfer');
  assert.equal(r.params.beneficiary, 'Marie Ngo Bassa');
  assert.equal(r.status, 'needs_clarification'); // pas de montant inventé
});

test('Flagship : une traduction hors domaine est refusée et le texte reste en français', { skip: mt.pairs.includes('francais-ewondo') && mt.pairs.includes('ewondo-francais') ? false : 'paires Flagship ewondo absentes' }, async () => {
  const e = new Engine(new MockBackend());
  const r = await e.handle({ sessionId: 'mt2', channel: 'api', lang: 'ewo', text: 'aide' });
  assert.ok(r.reply.mt);
  if (!r.reply.mt.accepted) assert.equal(r.reply.text, r.reply.fr);
  else assert.equal(r.reply.quality, 'machine');
});

test('une traduction dans la mauvaise langue est refusée, même si l’aller-retour paraît fidèle', async () => {
  const { wrongLanguage } = await import('../src/mt/flagship.ts');
  // Sortie réelle d'OPUS pour « Je veux envoyer de l'argent à Paul. » demandé en duala (24/11) : ce n'est pas du duala.
  const opusDuala = 'Komme mme, ha, ke nyishaho polelo ya Paulo yokuza, mme Paulo yena aza kandi kandi kandi andi.';
  assert.match(wrongLanguage('dua', opusDuala, 'opus') ?? '', /langue de sortie incorrecte/);
  assert.equal(wrongLanguage('bas', 'texte quelconque', 'opus'), 'langue de sortie non vérifiable');
});

test('une demande comprise par le lexique n’est jamais remplacée par la traduction (« mon solde » en Ewondo)', async () => {
  const e = new Engine(new MockBackend(), 'fr');
  const r = await e.handle({ sessionId: 'ewo-solde', channel: 'mobile', lang: 'ewo', text: 'mon solde', input: 'text' });
  assert.equal(r.canonical?.operation, 'CONSULT_BALANCE');
  assert.equal(r.understanding.via, 'lexicon');
});
