// Bac à sable SAFINUM, mobile et web : traduction des écrans de l'application (type « ui_translation »).
// Toutes les clés reviennent, les emplacements restent intacts, max_chars est respecté, jamais de chiffre inventé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const dir = mkdtempSync(join(tmpdir(), 'ui-')) + '/';
process.env.CT_UI_DIR = dir;
process.env.CT_UI_BUDGET_MS = '300';
process.env.CT_ALLOW_DRAFT = '1';
process.env.CT_MT_URL = 'http://127.0.0.1:9'; // pas de traduction automatique : on teste les autres sources
const { translateUiScreen, fits } = await import('../src/channels/safinum-ui.ts');
const { createApp } = await import('../src/api/server.ts');

const STRINGS = {
  'nav.home': { text: 'Accueil', context: 'Onglet', max_chars: 12 },
  'review.total': { text: 'Total débité', context: 'Libellé', max_chars: null },
  'error.INSUFFICIENT_FUNDS': { text: 'Solde insuffisant : il vous manque {missing}.', context: 'Message d’erreur', max_chars: null },
  'listen': { text: 'Écouter', context: 'Bouton', max_chars: 20 },
};

test('fits : mêmes emplacements, aucun chiffre ajouté, longueur respectée', () => {
  assert.equal(fits('Il vous manque {missing}.', 'You are short {missing}.'), true);
  assert.equal(fits('Il vous manque {missing}.', 'You are short of money.'), false);      // emplacement perdu
  assert.equal(fits('Il vous manque {missing}.', 'You are short {amount}.'), false);      // emplacement renommé
  assert.equal(fits('Accueil', 'Home 2'), false);                                          // chiffre inventé
  assert.equal(fits('Accueil', 'Page d’accueil principale', 12), false);                   // trop long
});

test('français ou langue absente : chaque clé revient telle quelle', async () => {
  for (const language of ['fr', null]) {
    const r = await translateUiScreen({ language, screen: 'home', strings: STRINGS });
    assert.deepEqual(Object.keys(r.strings).sort(), Object.keys(STRINGS).sort());
    assert.equal(r.strings['nav.home'], 'Accueil');
    assert.equal(r.language, language ?? 'fr');
  }
});

test('catalogue relu : utilisé seulement s’il garde les emplacements et tient dans la place', async () => {
  writeFileSync(dir + 'safinum-en.json', JSON.stringify({
    'nav.home': 'Home', 'review.total': 'Total debited',
    'error.INSUFFICIENT_FUNDS': 'Insufficient balance: you are short of money.', // emplacement perdu → français
  }));
  const r = await translateUiScreen({ language: 'en', screen: 'review', strings: STRINGS });
  assert.equal(r.strings['nav.home'], 'Home');
  assert.equal(r.strings['review.total'], 'Total debited');
  assert.equal(r.strings['error.INSUFFICIENT_FUNDS'], STRINGS['error.INSUFFICIENT_FUNDS'].text);
  assert.equal(r.language, 'en');
});

test('pidgin (« pcm ») : libellés écrits par la native, et le reste en français sans casser l’écran', async () => {
  const r = await translateUiScreen({ language: 'pcm', screen: 'home', strings: STRINGS });
  assert.equal(r.language, 'pcm');
  assert.equal(r.strings.listen, 'Hear am');           // libellé Mboa (pidgin)
  assert.equal(r.strings['nav.home'], 'Accueil');      // rien de relu : français, jamais inventé
});

test('les textes reçus sont enregistrés pour être donnés à traduire aux natifs', async () => {
  await translateUiScreen({ language: 'dua', screen: 'receipt', strings: STRINGS });
  const source = JSON.parse(readFileSync(dir + 'safinum-source.json', 'utf8'));
  assert.equal(source['error.INSUFFICIENT_FUNDS'].text, 'Solde insuffisant : il vous manque {missing}.');
  assert.ok(source['nav.home'].screens.includes('receipt'));
});

test('/safinum/middleware : une demande « ui_translation » reçoit { language, strings } avec toutes les clés', async () => {
  const { server } = createApp(undefined, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trace_id: 't1', team_id: 'gifa', channel: 'mobile', type: 'ui_translation', session_id: 's', phone: '237670000000', language: 'ewo', source_language: 'fr', screen: 'home', strings: STRINGS }),
    });
    const body = await res.json() as { language: string; strings: Record<string, string> };
    assert.equal(res.status, 200);
    assert.equal(body.language, 'ewo');
    assert.deepEqual(Object.keys(body.strings).sort(), Object.keys(STRINGS).sort());
    assert.ok(body.strings['error.INSUFFICIENT_FUNDS'].includes('{missing}'));
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
