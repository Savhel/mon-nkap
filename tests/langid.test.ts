// Identification de langue et changement de langue spontané. La langue « zz » est FICTIVE (mots inventés).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, identify, setLangIdModel, type LangIdModel } from '../src/linguistics/langid.ts';
import { buildPack } from '../src/linguistics/importer.ts';
import { setPack, clearPackCache } from '../src/linguistics/pack.ts';
import { clearRuntimeCache } from '../src/linguistics/runtime.ts';
import { clearLexiconCache } from '../src/core/nlu.ts';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';

const ZZ = ['kubo laso venti dumi', 'mira kubo laso ra', 'vela kilo tano iko', 'gudo heno pelo dimo', 'tiyo nopa rivo zuba', 'kubo mira laso venti heno', 'dumi gudo kubo laso dimo'];
const FR = ['quel est mon solde', 'je veux envoyer de l’argent à Marie', 'combien coûtent les frais', 'montre mon historique', 'payer ma facture d’électricité', 'acheter du crédit téléphonique', 'oui je confirme'];
const model: LangIdModel = { version: 1, built: '', sources: {}, profiles: { zz: buildProfile(ZZ), fr: buildProfile(FR) } };
after(() => setLangIdModel(undefined));

test('identification : texte trop court → « inconnue », jamais forcée', () => {
  assert.equal(identify('ok', model).lang, null);
  assert.equal(identify('kubo laso venti dumi heno', model).lang, 'zz');
  assert.equal(identify('je voudrais connaître mon solde', model).lang, 'fr');
});

test('changement de langue spontané : détectée, comprise, réponse dans la nouvelle langue', async () => {
  setLangIdModel(model);
  clearPackCache(); clearRuntimeCache(); clearLexiconCache();
  const ok = { auteur: 'A', relecteur: 'B', statut: 'valide' };
  const pack = buildPack('zz', {
    demandes: ['mira kubo laso', 'kubo laso venti', 'dumi kubo laso', 'kubo laso dimo', 'gudo kubo laso', 'heno kubo laso', 'kubo laso ra', 'mira kubo laso ra'].map((phrase) => ({ ...ok, situation_id: 'bal1', phrase })),
    reponses: [{ ...ok, id: 'balance', votre_phrase: 'Kubo ra : {solde}.' }],
  });
  for (const u of pack.utterances) u.split = 'train';
  setPack('zz', pack);
  const engine = new Engine(new MockBackend());
  const a = await engine.handle({ sessionId: 's', channel: 'web', lang: 'fr', text: 'bonjour' });
  assert.equal(a.lang, 'fr');
  const b = await engine.handle({ sessionId: 's', channel: 'web', text: 'dumi kubo laso venti heno' });
  assert.equal(b.understanding.detectedLanguage?.code, 'zz');
  assert.equal(b.understanding.detectedLanguage?.switched, true);
  assert.equal(b.lang, 'zz');
  assert.equal(b.intent, 'balance');
  assert.equal(b.reply.text, 'Kubo ra : 150 000 FCFA.');
});
