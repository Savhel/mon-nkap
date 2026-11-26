// Tests d'architecture Gateway : anti-SSRF, routage multi-institutions, catalogue UI, /v1/gateway/interact, sync hybride et extension Manifest V3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { assertSafePublicUrl } from '../src/backend/registry.ts';
import { createApp } from '../src/api/server.ts';

test('protection SSRF : rejette adresses privées, localhost, HTTP non chiffré et identifiants', () => {
  assert.doesNotThrow(() => assertSafePublicUrl('https://api.banque.cm/v1', false));
  for (const bad of [
    'http://api.banque.cm/v1',
    'https://localhost/api',
    'https://127.0.0.1/api',
    'https://10.0.0.5/api',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.10/api',
    'https://user:pass@api.banque.cm/v1',
  ]) {
    assert.throws(() => assertSafePublicUrl(bad, false), { code: 'UNSAFE_ENDPOINT' });
  }
});

test('routage multi-institutions, CanonicalInteraction (/v1/gateway/interact), catalogue UI et sync hybride', async () => {
  // Simule le backend bancaire dédié d'une deuxième entreprise (banqueB) avec un solde distinct (425 000 FCFA)
  const bankBServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.headers['x-bank-secret'] !== 'secret-b') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'unauthorized' }));
    }
    if (url.pathname === '/balance') return res.end(JSON.stringify({ balance: 425_000, currency: 'XAF' }));
    if (url.pathname === '/contacts') return res.end(JSON.stringify({ contacts: [] }));
    return res.end(JSON.stringify([]));
  });
  await new Promise<void>((resolve) => bankBServer.listen(0, '127.0.0.1', () => resolve()));
  const bankBUrl = `http://127.0.0.1:${(bankBServer.address() as AddressInfo).port}`;

  const dir = mkdtempSync(join(tmpdir(), 'mon-nkap-gw-'));
  const prevAdmin = process.env.CT_ADMIN_KEY;
  process.env.CT_ADMIN_KEY = 'gw-admin-secret';

  const { server, keys } = createApp(undefined, {
    auditFile: null,
    keysFile: join(dir, 'keys.json'),
    connectorsFile: join(dir, 'connectors.json'),
    uiResourcesFile: join(dir, 'ui.json'),
    allowPrivateUrls: true, // autorise 127.0.0.1 uniquement pour le serveur de test local
  });
  const keyA = keys.issue('banqueA', 'Banque A').key;
  const keyB = keys.issue('banqueB', 'Banque B').key;

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Enregistre le connecteur HTTP de banqueB et un libellé UI personnalisé via /admin
    const putConn = await fetch(`${base}/v1/admin/connectors`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'gw-admin-secret' },
      body: JSON.stringify({
        institution: 'banqueB',
        type: 'http',
        baseUrl: bankBUrl,
        authHeader: 'x-bank-secret',
        authSecret: 'secret-b',
      }),
    });
    assert.equal(putConn.status, 200);
    const connData = await putConn.json() as { connector: { hasSecret: boolean; authSecret?: string } };
    assert.equal(connData.connector.hasSecret, true);
    assert.equal(connData.connector.authSecret, undefined); // jamais exposé

    const testConn = await fetch(`${base}/v1/admin/connectors/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'gw-admin-secret' },
      body: JSON.stringify({ institution: 'banqueB' }),
    }).then((r) => r.json()) as { ok: boolean; detail: { balance: number } };
    assert.equal(testConn.ok, true);
    assert.equal(testConn.detail.balance, 425_000);

    // 2. Même requête sur /v1/gateway/interact : banqueA voit 150 000 (Mock), banqueB voit 425 000 (son backend)
    const gwA = await fetch(`${base}/v1/gateway/interact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyA },
      body: JSON.stringify({ sessionId: 's-a', channel: 'web', input: { type: 'text', content: 'quel est mon solde', language: 'fr' } }),
    }).then((r) => r.json()) as { params: { balance: number } };
    assert.equal(gwA.params.balance, 150_000);

    const gwB = await fetch(`${base}/v1/gateway/interact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyB },
      body: JSON.stringify({ sessionId: 's-b', channel: 'mobile', input: { type: 'text', content: 'quel est mon solde', language: 'fr' } }),
    }).then((r) => r.json()) as { params: { balance: number } };
    assert.equal(gwB.params.balance, 425_000);

    // 2 bis. Une banque ne peut pas choisir une autre institution dans le corps de la requête.
    const spoof = await fetch(`${base}/v1/gateway/interact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': keyA },
      body: JSON.stringify({ institutionId: 'banqueB', userId: '237677000001', sessionId: 's-x', channel: 'web', input: { type: 'text', content: 'quel est mon solde', language: 'fr' } }),
    });
    assert.equal(spoof.status, 403);
    assert.equal((await spoof.json() as { error: string }).error, 'institution_non_autorisee');

    // 3. Catalogue UI personnalisable par institution
    const putUi = await fetch(`${base}/v1/admin/ui-resources`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'gw-admin-secret' },
      body: JSON.stringify({
        institution: 'banqueB',
        entries: [{ resource: 'transfer.confirmation', language: 'dua', channel: 'web', value: 'O ma kɛkɛ ni loma ?' }],
      }),
    });
    assert.equal(putUi.status, 200);

    const uiB = await fetch(`${base}/v1/ui-resources?lang=dua&channel=web`, {
      headers: { 'x-api-key': keyB },
    }).then((r) => r.json()) as { institution: string; resources: Record<string, { value: string; source: string }> };
    assert.equal(uiB.institution, 'banqueB');
    assert.equal(uiB.resources['transfer.confirmation'].value, 'O ma kɛkɛ ni loma ?');
    assert.equal(uiB.resources['transfer.confirmation'].source, 'catalog:banqueB');

    // banqueA ne voit pas les libellés privés de banqueB
    const uiA = await fetch(`${base}/v1/ui-resources?lang=dua&channel=web`, {
      headers: { 'x-api-key': keyA },
    }).then((r) => r.json()) as typeof uiB;
    assert.equal(uiA.resources['transfer.confirmation'], undefined);

    // 4. Sync hybride (/v1/sync/bundle)
    const bundle = await fetch(`${base}/v1/sync/bundle`, {
      headers: { 'x-api-key': keyB },
    }).then((r) => r.json()) as { schema: string; institution: string; uiResources: unknown[] };
    assert.equal(bundle.schema, 'nkap-sync.v1');
    assert.equal(bundle.institution, 'banqueB');
    assert.equal(bundle.uiResources.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => bankBServer.close(() => resolve()));
    if (prevAdmin === undefined) delete process.env.CT_ADMIN_KEY;
    else process.env.CT_ADMIN_KEY = prevAdmin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extension navigateur Manifest V3 : manifest valide et scripts présents', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')) as {
    manifest_version: number;
    side_panel?: { default_path?: string };
    background?: { service_worker?: string };
  };
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');
  assert.equal(manifest.background?.service_worker, 'background.js');
  for (const f of ['content.js', 'background.js', 'sidepanel.html', 'sidepanel.js', 'options.html', 'options.js']) {
    assert.ok(existsSync(new URL(`../extension/${f}`, import.meta.url)), f);
  }
});

