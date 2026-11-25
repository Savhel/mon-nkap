// Tests d'intégration du connecteur bac à sable SAFINUM (SafinumBackend + POST /safinum/middleware).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/core/engine.ts';
import { SafinumBackend } from '../src/backend/safinum.ts';
import { fitGsm7, gsm7Septets, toGsm7 } from '../src/channels/safinum.ts';
import { createApp } from '../src/api/server.ts';

function startFakeSafinumApi() {
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
    if (req.method === 'POST' && /^\/transactions\/[^/]+\/confirm$/.test(url.pathname)) {
      const id = url.pathname.split('/')[2];
      const tx = pending.get(id);
      if (!tx || tx.status !== 'pending') return send(409, { code: 'TX_NOT_PENDING', message: 'Non en attente' });
      balance -= tx.amount + tx.fee;
      tx.status = 'confirmed';
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

