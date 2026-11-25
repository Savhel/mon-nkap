// Service de traduction directe (/v1/translate) et authentification par clé d'API d'entreprise.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server.ts';
import { translateText } from '../src/core/translate.ts';
import { setPack, clearPackCache, type LangPack } from '../src/linguistics/pack.ts';

after(() => clearPackCache());

test('translateText : correspondance validée dans un pack natif, brouillon Mboa et garde sur les chiffres', async () => {
  const pack: LangPack = {
    schema: 'ct-langpack.v1',
    lang: 'dua',
    generatedAt: '2026-11-25T00:00:00.000Z',
    source: 'test',
    numbers: [],
    concepts: {},
    utterances: [],
    responses: {
      ask_amount: { text: 'Nde mɔ́ni o ma lóma ?', author: 'natif1', reviewer: 'natif2', validated: true },
    },
    definitions: {},
    rejected: [],
  };
  setPack('dua', pack);
  try {
    const ok = await translateText({ text: 'Quel montant voulez-vous envoyer ?', from: 'fr', to: 'dua' });
    assert.equal(ok.accepted, true);
    assert.equal(ok.quality, 'validated');
    assert.equal(ok.text, 'Nde mɔ́ni o ma lóma ?');

    // Sens inverse validé (dua -> fr)
    const rev = await translateText({ text: 'Nde mɔ́ni o ma lóma ?', from: 'dua', to: 'fr' });
    assert.equal(rev.accepted, true);
    assert.equal(rev.quality, 'validated');
    assert.equal(rev.text, 'Quel montant voulez-vous envoyer ?');

    // Brouillon Mboa si allowDraft=true
    const draft = await translateText({ text: 'Banque en ligne', from: 'fr', to: 'ewo', allowDraft: true });
    assert.equal(draft.accepted, true);
    assert.equal(draft.quality, 'draft');
    assert.equal(draft.text, 'Bank a internet');

    // Chiffre bloqué par la garde MT
    const num = await translateText({ text: 'Votre solde est de 150000 FCFA.', from: 'fr', to: 'ewo' });
    assert.equal(num.accepted, false);
    assert.equal(num.quality, 'fallback');
    assert.equal(num.reason, 'contient un chiffre');
  } finally {
    clearPackCache();
  }
});

test('API entreprise : génération de clé admin, accès /v1/translate par x-api-key, lot et révocation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mon-nkap-api-'));
  const keysFile = join(dir, 'api-keys.json');
  const prevAdmin = process.env.CT_ADMIN_KEY;
  const prevApiKeys = process.env.CT_API_KEYS;
  process.env.CT_API_KEYS = '';

  const { server, keys } = createApp(undefined, { auditFile: null, keysFile });
  // Pré-enregistre une entreprise pour activer le verrouillage d'API dès le départ
  const initial = keys.issue('banqueInit', 'Banque Initiale');
  assert.ok(initial.key.startsWith('nk_live_'));

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Sans CT_ADMIN_KEY, l'administration des clés renvoie 503
    delete process.env.CT_ADMIN_KEY;
    const noAdminCfg = await fetch(`${base}/v1/admin/keys`);
    assert.equal(noAdminCfg.status, 503);

    // 2. Avec CT_ADMIN_KEY, mauvaise clé admin -> 401 ; bonne clé -> 201
    process.env.CT_ADMIN_KEY = 'super-admin-secret-2026';
    const badAdmin = await fetch(`${base}/v1/admin/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'mauvaise-cle' },
      body: JSON.stringify({ institution: 'ecobank' }),
    });
    assert.equal(badAdmin.status, 401);

    const createdRes = await fetch(`${base}/v1/admin/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'super-admin-secret-2026' },
      body: JSON.stringify({ institution: 'ecobank', name: 'Ecobank Cameroun' }),
    });
    assert.equal(createdRes.status, 201);
    const created = await createdRes.json() as { key: string; record: { id: string; institution: string } };
    assert.equal(created.record.institution, 'ecobank');

    // 3. Appel /v1/translate sans clé -> 401
    const unauth = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Banque en ligne', to: 'ewo', allowDraft: true }),
    });
    assert.equal(unauth.status, 401);

    // 4. Appel /v1/translate avec la clé de l'entreprise + idempotence -> 200
    const trRes = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': created.key,
        'idempotency-key': 'idem-tr-1',
      },
      body: JSON.stringify({ texts: ['Banque en ligne', 'Solde'], from: 'fr', to: 'dua', allowDraft: true }),
    });
    assert.equal(trRes.status, 200);
    assert.equal(trRes.headers.get('idempotent-replayed'), 'false');
    const trBody = await trRes.json() as { institution: string; items: { text: string; accepted: boolean; quality: string }[] };
    assert.equal(trBody.institution, 'ecobank');
    assert.equal(trBody.items.length, 2);
    assert.equal(trBody.items[0].text, 'Bank o internet');
    assert.equal(trBody.items[1].text, 'Mɔ́ni mwáó');

    const replayRes = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': created.key,
        'idempotency-key': 'idem-tr-1',
      },
      body: JSON.stringify({ texts: ['Banque en ligne', 'Solde'], from: 'fr', to: 'dua', allowDraft: true }),
    });
    assert.equal(replayRes.headers.get('idempotent-replayed'), 'true');

    // 5. Révocation de la clé -> les appels suivants sont immédiatement refusés (401)
    const revRes = await fetch(`${base}/v1/admin/keys/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-key': 'super-admin-secret-2026' },
      body: JSON.stringify({ id: created.record.id }),
    });
    assert.equal(revRes.status, 200);

    const afterRevoke = await fetch(`${base}/v1/translate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': created.key },
      body: JSON.stringify({ text: 'Solde', to: 'dua', allowDraft: true }),
    });
    assert.equal(afterRevoke.status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevAdmin === undefined) delete process.env.CT_ADMIN_KEY;
    else process.env.CT_ADMIN_KEY = prevAdmin;
    if (prevApiKeys === undefined) delete process.env.CT_API_KEYS;
    else process.env.CT_API_KEYS = prevApiKeys;
    rmSync(dir, { recursive: true, force: true });
  }
});

