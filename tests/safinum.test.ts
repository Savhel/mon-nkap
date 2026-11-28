// Tests d'intégration du connecteur bac à sable SAFINUM (SafinumBackend + POST /safinum/middleware).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/core/engine.ts';
import { SafinumBackend } from '../src/backend/safinum.ts';
import { fitGsm7, gsm7Septets, toGsm7 } from '../src/channels/safinum.ts';
import { createApp } from '../src/api/server.ts';

function startFakeSafinumApi({ loseConfirmResponse = false } = {}) {
  let balance = 100_000;
  let seq = 1000;
  const calls: { method: string; path: string; traceId?: string; teamKey?: string; body?: Record<string, unknown> }[] = [];
  const pending = new Map<string, { id: string; amount: number; fee: number; to?: string; status: string }>();

  const feeFor = (type: string, amount: number) => {
    if (type === 'airtime') return 0;
    if (type === 'bill') return 100;
    if (amount <= 5000) return 50;
    if (amount <= 25000) return 150;
    if (amount <= 100000) return 400;
    return Math.round(amount * 0.01);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
    const traceId = req.headers['x-trace-id'] as string | undefined;
    const teamKey = req.headers['x-team-key'] as string | undefined;
    calls.push({ method: req.method ?? 'GET', path: url.pathname + url.search, traceId, teamKey, body });

    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (teamKey !== 'sbx_test_team_key') return send(401, { code: 'UNAUTHORIZED', message: 'Clé invalide' });

    if (req.method === 'GET' && url.pathname.startsWith('/accounts/') && !url.pathname.endsWith('/transactions')) {
      return send(200, { phone: url.pathname.split('/')[2], holder: 'Client Safinum', balance, currency: 'XAF' });
    }
    if (req.method === 'GET' && url.pathname.endsWith('/transactions')) {
      return send(200, { transactions: [{ id: 'TRX-0900', type: 'transfer_in', amount: 25000, fee: 0, counterparty: 'Aminatou Bello', date: '2026-11-25T10:00:00Z', status: 'success' }] });
    }
    if (req.method === 'GET' && url.pathname === '/beneficiaries') {
      return send(200, {
        beneficiaries: [
          { id: 'b1', name: 'Marie Ngo Bassa', phone: '237655778899' },
          { id: 'b2', name: 'Paul Mbarga', phone: '237677112233' },
          { id: 'b3', name: 'Paul Ekwalla', phone: '237699445566' },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/fees') {
      const type = url.searchParams.get('type') ?? 'transfer';
      const amount = Number(url.searchParams.get('amount') ?? 0);
      if (amount > 500000) return send(422, { code: 'LIMIT_EXCEEDED', message: 'Plafond dépassé', max_amount: 500000 });
      const fee = feeFor(type, amount);
      return send(200, { type, amount, fee, total: amount + fee, currency: 'XAF' });
    }
    if (req.method === 'POST' && url.pathname === '/transactions') {
      const amount = Number(body?.amount ?? 0);
      const type = String(body?.type ?? 'transfer');
      const fee = feeFor(type, amount);
      const id = `TRX-${++seq}`;
      pending.set(id, { id, amount, fee, to: String(body?.to ?? ''), status: 'pending' });
      return send(201, { transaction: { id, type, amount, fee, total: amount + fee, status: 'pending' } });
    }
    if (req.method === 'POST' && /^\/transactions\/[^/]+\/update$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      const tx = pending.get(id);
      if (!tx || tx.status !== 'pending') return send(409, { code: 'TX_NOT_PENDING', message: 'Non en attente' });
      tx.amount = Number(body?.amount ?? tx.amount);
      tx.fee = feeFor('transfer', tx.amount);
      return send(200, { transaction: { id, amount: tx.amount, fee: tx.fee, total: tx.amount + tx.fee, status: 'pending' } });
    }
    if (req.method === 'GET' && /^\/transactions\/[^/]+$/.test(url.pathname)) {
      const tx = pending.get(url.pathname.split('/')[2]);
      if (tx) return send(200, { transaction: { ...tx, type: 'transfer' } });
    }
    if (req.method === 'POST' && /^\/transactions\/[^/]+\/confirm$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      const tx = pending.get(id);
      if (!tx || tx.status !== 'pending') return send(409, { code: 'TX_NOT_PENDING', message: 'Non en attente' });
      balance -= tx.amount + tx.fee;
      tx.status = 'confirmed';
      if (loseConfirmResponse) return res.destroy();
      return send(200, { transaction: { id, type: 'transfer', amount: tx.amount, fee: tx.fee, to: tx.to, status: 'confirmed', created_at: '2026-11-26T00:00:00Z' } });
    }
    if (req.method === 'POST' && /^\/transactions\/[^/]+\/cancel$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      const tx = pending.get(id);
      if (tx) tx.status = 'cancelled';
      return send(200, { transaction: { id, status: 'cancelled' } });
    }
    return send(404, { code: 'NOT_FOUND', message: 'Inconnu' });
  });

  return { server, calls, getBalance: () => balance };
}

test('GSM-7 : translittération des caractères camerounais et comptage exact des septets', () => {
  const s = toGsm7('Mɔ́ni mwáó : ɛ ɔ ŋ ə — 5 000 €');
  assert.equal(s, "Moni mwao : e o ng e - 5 000 €");
  assert.equal(gsm7Septets('abc€'), 5); // € compte pour 2 septets
  const clipped = fitGsm7('a'.repeat(180) + '€€', 182);
  assert.ok(gsm7Septets(clipped) <= 182);
});

test('SAFINUM middleware : cycle en 2 tours, X-Trace-Id propagé, correction et continuité multicanale', async () => {
  const fake = startFakeSafinumApi();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', () => resolve()));
  const bankUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;

  const backend = new SafinumBackend({ baseUrl: bankUrl, teamKey: 'sbx_test_team_key' });
  const engine = new Engine(backend, 'fr');
  const { server } = createApp(engine, { auditFile: null, keysFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const mwUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`;

  try {
    // Tour 1 : initiation sur USSD avec trace_id tr-1
    const r1 = await fetch(mwUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trace_id: 'tr-1',
        team_id: 'gifa',
        channel: 'ussd',
        session_id: 's-ussd-1',
        phone: '237677000001',
        language: 'fr',
        input: { type: 'text', text: 'envoie 5000 à Marie' },
        constraints: { max_chars: 182, charset: 'gsm7', mode: 'menu', timeout_ms: 3000 },
        bank_api: { base_url: bankUrl },
      }),
    }).then((r) => r.json()) as {
      response: { text: string; end_session: boolean; options: string[] };
      interpretation: { intent: string; parameters: Record<string, unknown>; language: string };
      transaction: { id: string | null; status: string };
    };

    assert.equal(r1.interpretation.intent, 'TRANSFER');
    assert.equal(r1.interpretation.parameters.amount, 5000);
    assert.equal(r1.interpretation.parameters.fee, 50); // barème SAFINUM (1..5000 -> 50)
    assert.equal(r1.transaction.id, 'TRX-1001');
    assert.equal(r1.transaction.status, 'pending');
    assert.ok(gsm7Septets(r1.response.text) <= 182);
    assert.equal(fake.getBalance(), 100_000); // rien n'est débité au tour 1 !

    const t1Calls = fake.calls.filter((c) => c.traceId === 'tr-1');
    assert.ok(t1Calls.some((c) => c.method === 'POST' && c.path === '/transactions'));
    assert.ok(!t1Calls.some((c) => c.path.includes('/confirm')));

    // Tour 2 : correction sur le même compte avec trace_id tr-2
    const r2 = await fetch(mwUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trace_id: 'tr-2',
        channel: 'ussd',
        session_id: 's-ussd-1',
        phone: '237677000001',
        language: 'fr',
        input: { type: 'text', text: 'non plutôt 10000' },
        constraints: { max_chars: 182, charset: 'gsm7' },
        bank_api: { base_url: bankUrl },
      }),
    }).then((r) => r.json()) as typeof r1;

    assert.equal(r2.interpretation.intent, 'CORRECTION');
    assert.equal(r2.interpretation.parameters.amount, 10000);
    assert.equal(r2.interpretation.parameters.fee, 150); // barème SAFINUM (5001..25000 -> 150)
    assert.equal(r2.transaction.id, 'TRX-1001');
    assert.equal(r2.transaction.status, 'pending');
    assert.ok(fake.calls.some((c) => c.traceId === 'tr-2' && c.path === '/transactions/TRX-1001/update'));

    // Tour 3 : confirmation depuis le canal WEB (continuité multicanale) avec trace_id tr-3
    const r3 = await fetch(mwUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trace_id: 'tr-3',
        channel: 'web',
        session_id: 's-web-99',
        phone: '237677000001',
        language: 'fr',
        input: { type: 'text', text: 'oui' },
        bank_api: { base_url: bankUrl },
      }),
    }).then((r) => r.json()) as typeof r1;

    assert.equal(r3.interpretation.intent, 'CONFIRM');
    assert.equal(r3.transaction.id, 'TRX-1001');
    assert.equal(r3.transaction.status, 'confirmed');
    assert.equal(fake.getBalance(), 100_000 - 10_150);
    assert.ok(fake.calls.some((c) => c.traceId === 'tr-3' && c.path === '/transactions/TRX-1001/confirm'));

    // Tour 4 : requête ambiguë (« Paul ») → CLARIFICATION_NEEDED, aucune transaction créée
    const beforeCount = fake.calls.filter((c) => c.method === 'POST' && c.path === '/transactions').length;
    const r4 = await fetch(mwUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trace_id: 'tr-4',
        channel: 'mobile',
        session_id: 's-mob-1',
        phone: '237677000001',
        language: null,
        input: { type: 'text', text: 'envoie 2000 à Paul' },
        bank_api: { base_url: bankUrl },
      }),
    }).then((r) => r.json()) as typeof r1;

    assert.equal(r4.interpretation.intent, 'CLARIFICATION_NEEDED');
    assert.equal(r4.transaction.status, 'none');
    assert.equal(fake.calls.filter((c) => c.method === 'POST' && c.path === '/transactions').length, beforeCount);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  }
});


test('SAFINUM : confirmation sans réponse, statut récupéré par lecture et débit unique', async (t) => {
  const fake = startFakeSafinumApi({ loseConfirmResponse: true });
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.server.close());
  const baseUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  const backend = new SafinumBackend({ baseUrl, teamKey: 'sbx_test_team_key' });
  const quote = await backend.createPending('237677000001', { op: 'transfer', amount: 4000, to: { phone: '655778899' } });
  assert.ok(quote.ok);
  const outcome = await backend.confirmPending(quote.value.id);
  assert.ok(outcome.ok);
  assert.equal(outcome.value.amount, 4000);
  assert.equal(fake.getBalance(), 95950);
  assert.deepEqual(fake.calls.map((call) => [call.method, call.path]), [
    ['POST', '/transactions'], ['POST', '/transactions/TRX-1001/confirm'], ['GET', '/transactions/TRX-1001'],
  ]);
});

test('SAFINUM : un numéro absent du jeu de données donne « compte inconnu », pas « service indisponible »', async () => {
  const fetchImpl = (async () => Response.json({ error: 'UNKNOWN_ACCOUNT', message: 'Compte introuvable dans le jeu de données.' }, { status: 404 })) as typeof fetch;
  const { Engine } = await import('../src/core/engine.ts');
  const engine = new Engine(new SafinumBackend({ baseUrl: 'https://bac-a-sable.invalid/api/v1', teamKey: 'sbx_test_team_key', fetchImpl }));
  const r = await engine.handle({ sessionId: 'inconnu', channel: 'mobile', lang: 'fr', accountId: '237600000000', text: 'quel est mon solde' });
  assert.equal(r.status, 'failed');
  assert.match(r.reply.text, /pas de compte/);
});

test('SAFINUM : un code d’erreur donné en texte (« error »: « INSUFFICIENT_FUNDS ») est bien lu', async () => {
  const fetchImpl = (async () => Response.json({ error: 'INSUFFICIENT_FUNDS', message: 'Solde insuffisant.', balance: 1000, required: 5100, missing: 4100 }, { status: 422 })) as typeof fetch;
  const backend = new SafinumBackend({ baseUrl: 'https://bac-a-sable.invalid/api/v1', teamKey: 'sbx_test_team_key', fetchImpl });
  const r = await backend.getBalance('237600000000');
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'insufficient_funds');
});

test('SAFINUM : les bénéficiaires se cherchent par les noms de la phrase, et une personne n’apparaît qu’une fois', async () => {
  const asked: string[] = [];
  const people = [{ name: 'Paul Ngono', phone: '237677210927', institution: 'SAFINUM' }, { name: 'Paul Ngono', phone: '237677210927', institution: 'ORANGE' }, { name: 'Paul Sali', phone: '237694027050', institution: 'MTN' }];
  const fetchImpl = (async (url: string) => {
    const q = new URL(url).searchParams.get('q') ?? '';
    asked.push(q);
    return Response.json({ beneficiaries: q ? people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : [] });
  }) as typeof fetch;
  const backend = new SafinumBackend({ baseUrl: 'https://bac-a-sable.invalid/api/v1', teamKey: 'sbx_test_team_key', fetchImpl });
  const contacts = await backend.listContacts('237676931311', 'envoie 2000 à Paul Ngono');
  assert.deepEqual(asked.sort(), ['Ngono', 'Paul']);                 // « envoie » n'est pas cherché
  assert.deepEqual(contacts.map((c) => c.phone).sort(), ['677210927', '694027050']);
  const { interpret } = await import('../src/core/nlu.ts');
  assert.deepEqual(interpret('envoie 2000 à Paul Ngono', 'fr', contacts).beneficiaryCandidates.map((c) => c.name), ['Paul Ngono']);
});

test('USSD : un texte trop long est coupé après le dernier élément complet, jamais au milieu d’une opération', () => {
  const history = 'Vos dernières opérations : ' + Array.from({ length: 8 }, (_, i) => `2026-11-2${i} envoi ${i + 1} 000 FCFA (2376770000${i}${i})`).join(' ; ');
  const out = fitGsm7(history, 182);
  assert.ok(gsm7Septets(out) <= 182);
  assert.match(out, /\)$/);                                    // se termine sur une opération entière
});

test('SAFINUM : les options sont des libellés (le simulateur les numérote), l’écran USSD garde « 1. Confirmer »', async () => {
  const { MockBackend } = await import('../src/backend/mock.ts');
  const { SafinumChannel } = await import('../src/channels/safinum.ts');
  const ch = new SafinumChannel(new Engine(new MockBackend()));
  const r = await ch.handle({ trace_id: 'opt', channel: 'ussd', session_id: 'opt', phone: 'demo', language: 'fr', input: { type: 'text', text: 'envoie 5000 à Marie' } } as never) as { response: { text: string; options: string[] } };
  assert.deepEqual(r.response.options, ['Confirmer', 'Annuler']);
  assert.match(r.response.text, /1\. Confirmer/);
});

test('SAFINUM : dédoublonnage des bénéficiaires renvoyés par institution', async () => {
  const fetchImpl = (async () => Response.json({
    count: 4,
    beneficiaries: [
      { name: 'Achille Ebongué', phone: '237670357792', institution: 'SAFINUM' },
      { name: 'Achille Ebongué', phone: '237670357792', institution: 'ORANGE' },
      { name: 'Achille Ebongué', phone: '237670357792', institution: 'MTN' },
      { name: 'Achille Nji', phone: '237621938979', institution: 'SAFINUM' },
    ],
  })) as typeof fetch;
  const backend = new SafinumBackend({ baseUrl: 'https://bac-a-sable.invalid/api/v1', teamKey: 'sbx_test_team_key', fetchImpl });
  const contacts = await backend.listContacts('demo', 'envoie à Achille');
  assert.equal(contacts.length, 2);
  assert.deepEqual(contacts.map((c) => [c.name, c.phone]), [
    ['Achille Ebongué', '670357792'],
    ['Achille Nji', '621938979'],
  ]);
});

test('SAFINUM USSD : menu d’accueil numéroté puis choix « 1 » pour le solde', async (t) => {
  const fake = startFakeSafinumApi();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.server.close());
  const bankUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;

  const { Engine } = await import('../src/core/engine.ts');
  const engine = new Engine(new SafinumBackend({ baseUrl: bankUrl, teamKey: 'sbx_test_team_key' }), 'fr');
  const { server } = createApp(engine, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const mwUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`;

  const menu = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'ussd-menu-1',
      channel: 'ussd',
      session_id: 's-menu',
      phone: '237677000001',
      language: null,
      input: { type: 'text', text: '' },
      constraints: { max_chars: 182, charset: 'gsm7' },
    }),
  }).then((r) => r.json()) as { response: { text: string; options: string[] }; interpretation: { intent: string } };

  assert.equal(menu.interpretation.intent, 'UNKNOWN');
  assert.ok(menu.response.options.length >= 4);
  assert.match(menu.response.text, /1\.\s*Solde/);
  assert.ok(gsm7Septets(menu.response.text) <= 182);

  const solde = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'ussd-menu-2',
      channel: 'ussd',
      session_id: 's-menu',
      phone: '237677000001',
      language: null,
      input: { type: 'text', text: '1' },
      constraints: { max_chars: 182, charset: 'gsm7' },
    }),
  }).then((r) => r.json()) as { response: { text: string }; interpretation: { intent: string; parameters: { balance?: number } } };

  assert.equal(solde.interpretation.intent, 'BALANCE_INQUIRY');
  assert.equal(solde.interpretation.parameters.balance, 100000);
  assert.match(solde.response.text, /100 000 FCFA/);
});

test('SAFINUM SMS : session_id null, continuité par téléphone et conformité GSM-7 ≤ 3 segments', async (t) => {
  const fake = startFakeSafinumApi();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.server.close());
  const bankUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;

  const engine = new Engine(new SafinumBackend({ baseUrl: bankUrl, teamKey: 'sbx_test_team_key' }), 'fr');
  const { server } = createApp(engine, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const mwUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`;

  const sms1 = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'sms-1',
      channel: 'sms',
      session_id: null,
      phone: '237677000002',
      language: null,
      input: { type: 'text', text: 'envoie 5000 à Marie' },
      constraints: { max_chars: 160, charset: 'gsm7_ucs2', max_segments: 3, mode: 'async', timeout_ms: 10000 },
    }),
  }).then((r) => r.json()) as {
    response: { text: string };
    interpretation: { intent: string };
    transaction: { id: string | null; status: string };
  };

  assert.equal(sms1.interpretation.intent, 'TRANSFER');
  assert.equal(sms1.transaction.status, 'pending');
  assert.equal(sms1.response.text, toGsm7(sms1.response.text));
  assert.ok(gsm7Septets(sms1.response.text) <= 459);

  const sms2 = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'sms-2',
      channel: 'sms',
      session_id: null,
      phone: '237677000002',
      language: null,
      input: { type: 'text', text: 'oui' },
      constraints: { max_chars: 160, charset: 'gsm7_ucs2', max_segments: 3, mode: 'async', timeout_ms: 10000 },
    }),
  }).then((r) => r.json()) as {
    response: { text: string };
    interpretation: { intent: string };
    transaction: { id: string | null; status: string };
  };

  assert.equal(sms2.interpretation.intent, 'CONFIRM');
  assert.equal(sms2.transaction.status, 'confirmed');
  assert.equal(sms2.response.text, toGsm7(sms2.response.text));
  assert.ok(gsm7Septets(sms2.response.text) <= 459);
});

test('SAFINUM GAB (atm) : traduction ui_translation avec contrainte 18 caractères', async (t) => {
  const { server } = createApp(undefined, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const mwUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`;

  const res = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'atm-1',
      channel: 'atm',
      type: 'ui_translation',
      session_id: 'atm-sess',
      phone: '237677000003',
      language: 'en',
      source_language: 'fr',
      screen: 'atm_menu',
      strings: {
        'atm.balance': { text: 'Consulter le solde', context: 'Touche GAB', max_chars: 18 },
        'atm.withdraw': { text: 'Retrait espèces', context: 'Touche GAB', max_chars: 18 },
      },
      constraints: { max_chars: null, charset: 'utf8', columns: 40, key_label_chars: 18 },
    }),
  });
  const body = await res.json() as { language: string; strings: Record<string, string> };
  assert.equal(res.status, 200);
  assert.equal(body.language, 'en');
  assert.ok(body.strings['atm.balance'].length <= 18);
  assert.ok(body.strings['atm.withdraw'].length <= 18);
});

test('SAFINUM Vocal (ivr) : accueil DTMF vide, touche 1, audio WAV > 256 Ko et fallback sans ASR', async (t) => {
  const fake = startFakeSafinumApi();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.server.close());
  const bankUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;

  const engine = new Engine(new SafinumBackend({ baseUrl: bankUrl, teamKey: 'sbx_test_team_key' }), 'fr');
  const { server } = createApp(engine, { auditFile: null, keysFile: null, connectorsFile: null, uiResourcesFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const mwUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/safinum/middleware`;

  // 1. Accueil vocal sur dtmf vide
  const welcome = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'ivr-1',
      channel: 'ivr',
      session_id: 'ivr-s1',
      phone: '237677000004',
      language: null,
      input: { type: 'dtmf', text: '' },
      constraints: { max_chars: 400, charset: 'utf8', mode: 'voice', timeout_ms: 8000 },
    }),
  }).then((r) => r.json()) as { response: { text: string; options: string[] }; interpretation: { intent: string } };
  assert.equal(welcome.interpretation.intent, 'UNKNOWN');
  assert.ok(welcome.response.text.length <= 400);
  assert.ok(welcome.response.options.length >= 4);

  // 2. Touche DTMF "1" -> Solde
  const dtmf1 = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'ivr-2',
      channel: 'ivr',
      session_id: 'ivr-s1',
      phone: '237677000004',
      language: null,
      input: { type: 'dtmf', text: '1' },
      constraints: { max_chars: 400, charset: 'utf8', mode: 'voice', timeout_ms: 8000 },
    }),
  }).then((r) => r.json()) as { response: { text: string }; interpretation: { intent: string; parameters: { balance?: number } } };
  assert.equal(dtmf1.interpretation.intent, 'BALANCE_INQUIRY');
  assert.equal(dtmf1.interpretation.parameters.balance, 100000);
  assert.ok(dtmf1.response.text.length <= 400);

  // 3. Corps WAV base64 > 256 Ko : pas d'erreur 413, et repli propre CLARIFICATION_NEEDED si ASR absent
  const bigWavB64 = Buffer.alloc(300_000, 1).toString('base64');
  const bigRes = await fetch(mwUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trace_id: 'ivr-3',
      channel: 'ivr',
      session_id: 'ivr-s1',
      phone: '237677000004',
      language: 'fr',
      input: {
        type: 'audio',
        text: null,
        audio: { format: 'wav', encoding: 'base64', sample_rate: 16000, channels: 1, bits_per_sample: 16, duration_ms: 10000, data: bigWavB64 },
      },
      constraints: { max_chars: 400, charset: 'utf8', mode: 'voice', timeout_ms: 8000 },
    }),
  });
  assert.equal(bigRes.status, 200);
  const bigBody = await bigRes.json() as { response: { text: string }; interpretation: { intent: string } };
  assert.equal(bigBody.interpretation.intent, 'CLARIFICATION_NEEDED');
  assert.ok(bigBody.response.text.length <= 400);
});

test('SAFINUM Vocal (ivr) : transcription audio WAV base64 vers intention moteur', async (t) => {
  const fake = startFakeSafinumApi();
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  t.after(() => fake.server.close());
  const bankUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;

  const { SafinumChannel } = await import('../src/channels/safinum.ts');
  const seenBytes: number[] = [];
  const ch = new SafinumChannel(new Engine(new SafinumBackend({ baseUrl: bankUrl, teamKey: 'sbx_test_team_key' }), 'fr'), {
    transcribeFn: async (audio) => {
      seenBytes.push(audio.length);
      return { text: 'quel est mon solde' };
    },
  });

  const wavPayload = Buffer.from('RIFF....WAVEfmt ', 'utf8').toString('base64');
  const out = await ch.handle({
    trace_id: 'ivr-voice-1',
    channel: 'ivr',
    session_id: 'ivr-v1',
    phone: '237677000005',
    language: null,
    input: {
      type: 'audio',
      text: null,
      audio: { format: 'wav', encoding: 'base64', sample_rate: 16000, channels: 1, bits_per_sample: 16, duration_ms: 1500, data: wavPayload },
    },
    constraints: { max_chars: 400, charset: 'utf8', mode: 'voice', timeout_ms: 8000 },
  });

  assert.deepEqual(seenBytes, [16]);
  assert.equal(out.interpretation.intent, 'BALANCE_INQUIRY');
  assert.equal(out.interpretation.parameters.balance, 100000);
  assert.ok(out.response.text.length <= 400);
});

test('SAFINUM IVR : accueil vocal avec la salutation écrite par la native, jamais de français en pidgin', async () => {
  const { MockBackend } = await import('../src/backend/mock.ts');
  const { SafinumChannel } = await import('../src/channels/safinum.ts');
  const prev = process.env.CT_ALLOW_DRAFT;
  process.env.CT_ALLOW_DRAFT = '1';
  try {
    const ch = new SafinumChannel(new Engine(new MockBackend()));
    const r = await ch.handle({ trace_id: 'w', channel: 'ivr', session_id: 'ivr-wes', phone: 'demo-ivr', language: 'wes', input: { type: 'text', text: '' } } as never) as { response: { text: string } };
    assert.match(r.response.text, /You wan do weti/);
    assert.doesNotMatch(r.response.text, /Bienvenue|Parlez/);
    const fr = await ch.handle({ trace_id: 'w2', channel: 'ivr', session_id: 'ivr-fr', phone: 'demo-ivr-fr', language: 'fr', input: { type: 'text', text: '' } } as never) as { response: { text: string } };
    assert.match(fr.response.text, /^Bienvenue sur Mon Nkap\. Parlez ou tapez : 1, Solde/);
  } finally {
    if (prev === undefined) delete process.env.CT_ALLOW_DRAFT; else process.env.CT_ALLOW_DRAFT = prev;
  }
});

test('SAFINUM : lettres des langues nationales — USSD translittéré sans perte, SMS gardé intact en UCS-2', async () => {
  assert.equal(toGsm7('Kʉ̀’ kàrt yɔ́'), "Ku' kàrt yo");
  assert.equal(toGsm7('Ɗauki ŋkáp'), 'Dauki ngkap');
  const { MockBackend } = await import('../src/backend/mock.ts');
  const { SafinumChannel } = await import('../src/channels/safinum.ts');
  const prev = process.env.CT_ALLOW_DRAFT; process.env.CT_ALLOW_DRAFT = '1';
  try {
    const ch = new SafinumChannel(new Engine(new MockBackend()));
    const r = await ch.handle({ trace_id: 's', channel: 'sms', session_id: null, phone: 'demo-sms-fub', language: 'fub', input: { type: 'text', text: 'solde' }, constraints: { charset: 'gsm7_ucs2', max_segments: 3 } } as never) as { response: { text: string } };
    const u = await ch.handle({ trace_id: 'u', channel: 'ussd', session_id: 'u1', phone: 'demo-ussd-fub', language: 'fub', input: { type: 'text', text: 'solde' }, constraints: { charset: 'gsm7', max_chars: 182 } } as never) as { response: { text: string } };
    assert.equal(u.response.text, toGsm7(u.response.text));                 // USSD : 100 % GSM-7
    if (/[ɓɗŋƴ]/u.test(r.response.text)) assert.ok(r.response.text.length <= 201); // SMS : lettres gardées, 3 × 67 au plus
  } finally { if (prev === undefined) delete process.env.CT_ALLOW_DRAFT; else process.env.CT_ALLOW_DRAFT = prev; }
});
