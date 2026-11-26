// Squelette de consonnes : orthographes libres des natifs et transcriptions de la reconnaissance vocale.
// Exemples réels (fulfulde, brouillon des natifs) : « yerbinego » écrit, « yarbongo » entendu.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CT_ALLOW_DRAFT = '1';
const { skeleton } = await import('../src/core/text.ts');
const { interpret } = await import('../src/core/nlu.ts');

test('même squelette pour les graphies d’un même mot', () => {
  assert.equal(skeleton('yerbinego'), skeleton('yarbungo'));
  assert.equal(skeleton('tchede'), skeleton('chede'));
  assert.equal(skeleton('yerɓungo'), skeleton('yerbungo'));
  assert.equal(skeleton('dallah'), skeleton('dala'));
});

test('fulfulde entendu par la voix : le transfert est reconnu, « aidi » (je veux) n’est plus « aide »', () => {
  assert.equal(interpret('aidi yarbongoboro juwe hamarina', 'fub').intent, 'transfer');
});

test('français : un mot exact garde tout son poids', () => {
  assert.equal(interpret('aide moi', 'fr').intent, 'help');
  assert.equal(interpret('aide moi', 'fub').intent, 'help');
});
