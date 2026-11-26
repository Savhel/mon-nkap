// Portail client (/portail) et console d'administration / entraînement (/admin).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server.ts';
import { clearPackCache } from '../src/linguistics/pack.ts';
import { clearRuntimeCache } from '../src/linguistics/runtime.ts';
import { setLangIdModel } from '../src/linguistics/langid.ts';

after(() => {
  clearPackCache();
  clearRuntimeCache();
  setLangIdModel(undefined);
});

test('portail client (/portail) : auto-génération de clé API et fermée par défaut, ouverte avec CT_PORTAL_SIGNUP=1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mon-nkap-portal-'));
  const keysFile = join(dir, 'api-keys.json');
  const prevSignup = process.env.CT_PORTAL_SIGNUP;
  const prevApiKeys = process.env.CT_API_KEYS;
  process.env.CT_API_KEYS = '';
  delete process.env.CT_PORTAL_SIGNUP;

  const { server } = createApp(undefined, { auditFile: null, keysFile });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const portalHtml = await fetch(`${base}/portail`);
    assert.equal(portalHtml.status, 200);
    assert.match(await portalHtml.text(), /Portail Entreprises/);

    // Par défaut, la création libre est fermée
    const closedCfg = await fetch(`${base}/v1/portal/config`).then((r) => r.json()) as { signupEnabled: boolean };
    assert.equal(closedCfg.signupEnabled, false);
    const closed = await fetch(`${base}/v1/portal/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institution: 'intrus', name: 'Intrus' }),
    });
    assert.equal(closed.status, 403);

    process.env.CT_PORTAL_SIGNUP = '1';
    const cfg = await fetch(`${base}/v1/portal/config`).then((r) => r.json()) as { signupEnabled: boolean };
    assert.equal(cfg.signupEnabled, true);

    const createdRes = await fetch(`${base}/v1/portal/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institution: 'uba-cm', name: 'UBA Cameroun' }),
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json() as { key: string; record: { institution: string } };
    assert.ok(created.key.startsWith('nk_live_'));
    assert.equal(created.record.institution, 'uba-cm');

    // La clé générée permet aussitôt d'appeler /v1/translate
    const tr = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': created.key },
      body: JSON.stringify({ text: 'Banque en ligne', from: 'fr', to: 'dua', allowDraft: true }),
    });
    assert.equal(tr.status, 200);
    const trBody = await tr.json() as { institution: string; text: string };
    assert.equal(trBody.institution, 'uba-cm');
    assert.equal(trBody.text, 'Bank o internet');

    // Toute autre valeur que 1 referme l'auto-inscription
    process.env.CT_PORTAL_SIGNUP = '0';
    const disabled = await fetch(`${base}/v1/portal/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ institution: 'autre', name: 'Autre Banque' }),
    });
    assert.equal(disabled.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevSignup === undefined) delete process.env.CT_PORTAL_SIGNUP;
    else process.env.CT_PORTAL_SIGNUP = prevSignup;
    if (prevApiKeys === undefined) delete process.env.CT_API_KEYS;
    else process.env.CT_API_KEYS = prevApiKeys;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('console admin (/admin) : édition CSV, entraînement à chaud, évaluation et LangId', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mon-nkap-train-'));
  const collecteDir = join(dir, 'collecte');
  const packsDir = join(dir, 'packs');
  const evalDir = join(dir, 'eval');
  const langidFile = join(dir, 'langid', 'profiles.json');
  mkdirSync(join(collecteDir, 'dua'), { recursive: true });
  writeFileSync(
    join(collecteDir, 'dua', 'lexique.csv'),
    '"id","mot_ou_expression","variantes","auteur","relecteur","statut"\n"balance","mɔ́ni mwáó","","natif1","natif2","valide"\n',
  );
  writeFileSync(
    join(collecteDir, 'dua', 'nombres.csv'),
    '"valeur","comment_on_le_dit","autre_facon","auteur","relecteur","statut"\n"1000","ikol","","natif1","natif2","valide"\n',
  );

  const prevAdmin = process.env.CT_ADMIN_KEY;
  process.env.CT_ADMIN_KEY = 'admin-train-secret';
  const { server } = createApp(undefined, {
    auditFile: null,
    keysFile: join(dir, 'keys.json'),
    trainerPaths: { collecteDir, packsDir, evalDir, langidFile },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const adminHeaders = { 'content-type': 'application/json', 'x-admin-key': 'admin-train-secret' };

  try {
    const adminHtml = await fetch(`${base}/admin`);
    assert.equal(adminHtml.status, 200);
    assert.match(await adminHtml.text(), /Administration/);

    // Sans clé admin, /v1/admin/training/status renvoie 401
    const unauth = await fetch(`${base}/v1/admin/training/status`);
    assert.equal(unauth.status, 401);

    const status = await fetch(`${base}/v1/admin/training/status`, { headers: { 'x-admin-key': 'admin-train-secret' } }).then((r) => r.json()) as {
      languages: { lang: string }[];
    };
    assert.deepEqual(status.languages.map((x) => x.lang), ['dua']);

    // Mise à jour d'un tableur CSV via l'API admin
    const demandesCsv = [
      '"situation_id","phrase","auteur","relecteur","statut"',
      '"bal1","mɔ́ni mwáó nde","natif1","natif2","valide"',
      '"bal2","solde mɔ́ni mwáó","natif1","natif2","valide"',
      '"bal1","mɔ́ni mwáó wɛ","natif1","natif2","valide"',
      '"bal2","mɔ́ni mwáó na","natif1","natif2","valide"',
    ].join('\n');
    const saveRes = await fetch(`${base}/v1/admin/training/sheet`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ lang: 'dua', sheet: 'demandes', csv: demandesCsv }),
    });
    assert.equal(saveRes.status, 200);

    // Lancement de l'entraînement
    const trainRes = await fetch(`${base}/v1/admin/training/train`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ lang: 'dua', retrainLangId: true }),
    });
    assert.equal(trainRes.status, 200);
    const trainData = await trainRes.json() as {
      ok: boolean;
      results: { lang: string; report: { numbers: string; utterances: string }; runtime: { grammarWords: number } }[];
      langid: { updated: string[] };
    };
    assert.equal(trainData.ok, true);
    assert.equal(trainData.results[0].lang, 'dua');
    assert.equal(trainData.results[0].report.numbers, '1/1');
    assert.equal(trainData.results[0].report.utterances, '4/4');
    assert.ok(trainData.results[0].runtime.grammarWords >= 1);
    assert.ok(existsSync(join(packsDir, 'dua.json')));
    assert.ok(existsSync(join(evalDir, 'dua.json')));
    assert.ok(existsSync(langidFile));
    const langidJson = JSON.parse(readFileSync(langidFile, 'utf8')) as { profiles: Record<string, unknown> };
    assert.ok(langidJson.profiles.dua);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevAdmin === undefined) delete process.env.CT_ADMIN_KEY;
    else process.env.CT_ADMIN_KEY = prevAdmin;
    clearPackCache();
    clearRuntimeCache();
    setLangIdModel(undefined);
    rmSync(dir, { recursive: true, force: true });
  }
});

