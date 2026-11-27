// Collecte des natifs en ligne : fermée sans invitation, une langue par code, file d'attente relue par
// l'administrateur, et une contribution acceptée n'entre dans le tableur qu'en brouillon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/api/server.ts';
import { parseCsv } from '../src/linguistics/csv.ts';
import { isValidated } from '../src/linguistics/collection.ts';

process.env.CT_ADMIN_KEY = 'admin-de-test-collecte';
const ADMIN = { 'x-admin-key': 'admin-de-test-collecte', 'content-type': 'application/json' };

async function withApp(run: (base: string, dirs: { root: string; sheets: string; audio: string }) => Promise<void>) {
  const tmp = mkdtempSync(join(tmpdir(), 'collecte-'));
  const dirs = { root: join(tmp, 'inbox'), sheets: join(tmp, 'sheets'), audio: join(tmp, 'audio') };
  const { server } = createApp(undefined, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null, collecte: { root: dirs.root, sheetsDir: dirs.sheets, audioDir: dirs.audio } });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(base, dirs); } finally { server.close(); rmSync(tmp, { recursive: true, force: true }); }
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string>) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('sans invitation valable, la collecte est fermée', async () => {
  await withApp(async (base) => {
    assert.equal((await fetch(`${base}/v1/collecte/tasks`)).status, 401);
    assert.equal((await fetch(`${base}/v1/collecte/tasks`, { headers: { 'x-collecte-code': 'ABCD-EFGH-JKMN' } })).status, 401);
    const r = await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', texte: 'faux', consent: true }, {});
    assert.equal(r.status, 401);
    // La page elle-même s'affiche (elle demande le code), et créer une invitation exige la clé admin.
    assert.equal((await fetch(`${base}/collecte`)).status, 200);
    assert.equal((await post(base, '/v1/admin/collecte/invitations', { lang: 'ewo' }, {})).status, 401);
  });
});

test('invitation → envoi → relecture : accepté en brouillon, jamais validé d’office ; révocation immédiate', async () => {
  await withApp(async (base, dirs) => {
    const inv = await (await post(base, '/v1/admin/collecte/invitations', { lang: 'ewo' }, ADMIN)).json() as { code: string; invitation: { id: string } };
    assert.match(inv.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Le code n'est jamais stocké en clair.
    assert.ok(!readFileSync(join(dirs.root, 'invitations.json'), 'utf8').includes(inv.code));

    const H = { 'x-collecte-code': inv.code.toLowerCase().replace(/-/g, ' ') }; // saisie tolérante (casse, séparateurs)
    const tasks = await (await fetch(`${base}/v1/collecte/tasks`, { headers: H })).json() as { lang: string; tasks: { section: string }[] };
    assert.equal(tasks.lang, 'ewo');
    assert.ok(tasks.tasks.some((t) => t.section === 'nombres'));

    // Garde-fous à l'envoi : consentement, repères des réponses, élément connu.
    assert.equal((await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', texte: 'x', consent: false }, H)).status, 400);
    assert.equal((await post(base, '/v1/collecte/contribution', { section: 'reponses', item: 'balance', texte: 'sans repère', consent: true }, H)).status, 400);
    assert.equal((await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'inexistant', texte: 'x', consent: true }, H)).status, 400);

    const phrase = 'Mə̀ yə́ŋ ayɔ́ŋ mɔ́nə wɔ́ɔ́ ?'; // texte gardé tel quel, tons compris
    const sent = await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', texte: phrase, consent: true }, H);
    assert.equal(sent.status, 201);
    const { id } = await sent.json() as { id: string };

    // Rien n'est encore dans les tableurs : tout attend la relecture.
    assert.equal(existsSync(join(dirs.sheets, 'ewo', 'demandes.csv')), false);
    const queue = await (await fetch(`${base}/v1/admin/collecte/contributions?lang=ewo`, { headers: ADMIN })).json() as { items: { id: string; statut: string; contributeur: string }[] };
    assert.equal(queue.items[0].statut, 'en_attente');
    assert.equal(queue.items[0].contributeur, inv.invitation.id);

    assert.equal((await post(base, '/v1/admin/collecte/review', { lang: 'ewo', id, decision: 'accepte' }, ADMIN)).status, 200);
    assert.equal((await post(base, '/v1/admin/collecte/review', { lang: 'ewo', id, decision: 'rejete' }, ADMIN)).status, 409);
    const rows = parseCsv(readFileSync(join(dirs.sheets, 'ewo', 'demandes.csv'), 'utf8'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phrase, phrase.normalize('NFC'));
    assert.equal(rows[0].auteur, inv.invitation.id);
    assert.equal(isValidated(rows[0]), false); // brouillon tant qu'un second natif n'a pas relu

    assert.equal((await post(base, '/v1/admin/collecte/invitations/revoke', { id: inv.invitation.id }, ADMIN)).status, 200);
    assert.equal((await fetch(`${base}/v1/collecte/tasks`, { headers: H })).status, 401);
  });
});

test('une contribution acceptée s’ajoute en fin de tableur sans réécrire les lignes des natifs', async () => {
  await withApp(async (base, dirs) => {
    mkdirSync(join(dirs.sheets, 'dua'), { recursive: true });
    const original = '﻿"situation_id";"intention";"situation";"phrase";"auteur";"relecteur";"statut";"commentaire"\n"bal1";"CONSULT_BALANCE";"…";"na mbɔ́ŋ";"a";"b";"validé";""\n';
    writeFileSync(join(dirs.sheets, 'dua', 'demandes.csv'), original);
    const { code } = await (await post(base, '/v1/admin/collecte/invitations', { lang: 'dua' }, ADMIN)).json() as { code: string };
    const { id } = await (await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal2', texte: 'mɔ́ni nam', consent: true }, { 'x-collecte-code': code })).json() as { id: string };
    await post(base, '/v1/admin/collecte/review', { lang: 'dua', id, decision: 'accepte' }, ADMIN);
    const after = readFileSync(join(dirs.sheets, 'dua', 'demandes.csv'), 'utf8');
    assert.ok(after.startsWith(original));
    const rows = parseCsv(after);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].phrase, 'mɔ́ni nam');
    assert.equal(rows[1].situation_id, 'bal2');
  });
});

test('audio : un fichier qui n’est pas de l’audio est refusé, un vrai enregistrement d’une demande rejoint le jeu de test vocal', async () => {
  await withApp(async (base, dirs) => {
    const { code } = await (await post(base, '/v1/admin/collecte/invitations', { lang: 'fub' }, ADMIN)).json() as { code: string };
    const H = { 'x-collecte-code': code };
    const junk = Buffer.alloc(4000, 7).toString('base64');
    assert.equal((await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', consent: true, audio: { mime: 'audio/wav', data: junk } }, H)).status, 422);
    assert.equal((await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', consent: true, audio: { mime: 'video/mp4', data: junk } }, H)).status, 415);

    const wav = readFileSync(new URL('./fixtures/fr-solde.wav', import.meta.url)).toString('base64');
    const sent = await post(base, '/v1/collecte/contribution', { section: 'demandes', item: 'bal1', texte: 'mi yidi anndude', consent: true, audio: { mime: 'audio/wav', data: wav } }, H);
    assert.equal(sent.status, 201);
    const { id } = await sent.json() as { id: string };
    const audio = await fetch(`${base}/v1/admin/collecte/audio?lang=fub&id=${id}`, { headers: ADMIN });
    assert.equal(audio.headers.get('content-type'), 'audio/wav');
    await post(base, '/v1/admin/collecte/review', { lang: 'fub', id, decision: 'accepte' }, ADMIN);
    const labels = parseCsv(readFileSync(join(dirs.audio, 'fub', 'demandes', 'labels.csv'), 'utf8'));
    assert.equal(labels.length, 1);
    assert.equal(labels[0].situation_id, 'bal1');
    assert.equal(labels[0].texte_natif, 'mi yidi anndude');
    assert.ok(existsSync(join(dirs.audio, 'fub', 'demandes', labels[0].fichier)));
  });
});
