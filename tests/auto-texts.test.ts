import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Les traductions automatiques non relues servent en dernier recours, comptées à part, jamais avant un texte de natif.
test('écrans SAFINUM : texte automatique non relu en dernier recours, compté à part', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'auto-'));
  writeFileSync(join(dir, 'safinum-source.json'), '{}');
  writeFileSync(join(dir, 'safinum-bbj.json'), JSON.stringify({ 'nav.home': { text: 'Natif', fr: 'Accueil', valide: true } }));
  writeFileSync(join(dir, 'safinum-auto-bbj.json'), JSON.stringify({ ecrans: {
    'nav.home': { text: 'Auto accueil', fr: 'Accueil' },
    'nav.send': { text: 'Auto envoyer', fr: 'Envoyer' },
    'tx.out': { text: 'Tɔ́m {jôé}', fr: 'Envoi à {name}' }, // repère traduit : refusé
  } }));
  const prev = { dir: process.env.CT_UI_DIR, auto: process.env.CT_AUTO_TEXTS };
  process.env.CT_UI_DIR = dir + '/'; delete process.env.CT_AUTO_TEXTS;
  try {
    const { translateUiScreen } = await import('../src/channels/safinum-ui.ts');
    const r = await translateUiScreen({ language: 'bbj', strings: { 'nav.home': { text: 'Accueil' }, 'nav.send': { text: 'Envoyer' }, 'tx.out': { text: 'Envoi à {name}' } } });
    assert.equal(r.strings['nav.home'], 'Natif');          // le natif passe toujours avant
    assert.equal(r.strings['nav.send'], 'Auto envoyer');   // l'automatique comble le manque
    assert.equal(r.strings['tx.out'], 'Envoi à {name}');   // repère modifié : le français reste
    assert.equal(r.stats.auto, 1);
    assert.ok(JSON.parse(readFileSync(join(dir, 'safinum-source.json'), 'utf8'))['nav.send']);
  } finally {
    if (prev.dir === undefined) delete process.env.CT_UI_DIR; else process.env.CT_UI_DIR = prev.dir;
    if (prev.auto === undefined) delete process.env.CT_AUTO_TEXTS; else process.env.CT_AUTO_TEXTS = prev.auto;
  }
});
