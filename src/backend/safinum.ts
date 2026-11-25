// Adaptateur vers l'API bancaire du bac à sable SAFINUM (https://safinum.cm/api/v1).
// Propage automatiquement l'en-tête `X-Trace-Id` du tour courant via AsyncLocalStorage afin que
// chaque appel bancaire soit relié à l'intention déclarée dans le journal du jury.

import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Contact,
  FeeKind,
  FeeQuote,
  FinancialBackend,
  OpResult,
  PendingTransactionHandle,
  PendingTransactionInput,
  Transaction,
} from './types.ts';

export interface SafinumTraceContext {
  traceId: string;
  baseUrl?: string;
}

const traceStorage = new AsyncLocalStorage<SafinumTraceContext>();

export function runWithSafinumTrace<T>(ctx: SafinumTraceContext, fn: () => Promise<T>): Promise<T> {
  return traceStorage.run(ctx, fn);
}

export interface SafinumConfig {
  baseUrl?: string;
  teamKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function toSafinumType(kind: FeeKind | PendingTransactionInput['op']): string {
  return kind === 'withdraw' ? 'withdrawal' : kind;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9 && /^[62]/.test(digits)) return `237${digits}`;
  return digits || phone.trim();
}

function shortPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : phone;
}

function mapSafinumError(code: string | undefined, status: number, message: string, data: Record<string, unknown>): OpResult<never> {
  if (code === 'INSUFFICIENT_FUNDS') {
    return {
      ok: false,
      code: 'insufficient_funds',
      message,
      details: {
        balance: Number(data.balance ?? 0),
        required: Number(data.required ?? 0),
        missing: Number(data.missing ?? 0),
      },
    };
  }
  if (code === 'LIMIT_EXCEEDED') {
    return {
      ok: false,
      code: 'limit_exceeded',
      message,
      details: { limit: Number(data.limit ?? data.max_amount ?? 500_000) },
    };
  }
  if (code === 'UNKNOWN_BENEFICIARY' || code === 'UNKNOWN_BILLER') {
    return { ok: false, code: 'unknown_beneficiary', message };
  }
  if (code === 'INVALID_AMOUNT') {
    return { ok: false, code: 'invalid_amount', message };
  }
  return { ok: false, code: 'backend_error', message: `${code ?? `HTTP_${status}`}: ${message}` };
}

function mapTxType(raw: unknown): Transaction['type'] {
  const t = String(raw ?? '').toLowerCase();
  if (t === 'transfer_in' || t === 'credit' || t === 'deposit') return t === 'deposit' ? 'deposit' : 'transfer_in';
  if (t === 'airtime') return 'airtime';
  if (t === 'bill') return 'bill';
  if (t === 'withdrawal' || t === 'withdraw') return 'withdrawal';
  return 'transfer_out';
}

export class SafinumBackend implements FinancialBackend {
  readonly name = 'safinum';
  private defaultBaseUrl: string;
  private teamKey: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(cfg: SafinumConfig = {}) {
    this.defaultBaseUrl = (cfg.baseUrl ?? process.env.CT_SAFINUM_URL ?? 'https://safinum.cm/api/v1').replace(/\/$/, '');
    this.teamKey = cfg.teamKey ?? process.env.CT_SAFINUM_KEY ?? '';
    this.timeoutMs = cfg.timeoutMs ?? 2500;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; code?: string; message: string; raw: Record<string, unknown> }> {
    const ctx = traceStorage.getStore();
    const base = (ctx?.baseUrl || this.defaultBaseUrl).replace(/\/$/, '');
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-team-key': this.teamKey,
    };
    if (ctx?.traceId) headers['x-trace-id'] = ctx.traceId;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${base}/${path.replace(/^\//, '')}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch {}

    if (!res.ok) {
      const errObj = (parsed.error && typeof parsed.error === 'object' ? parsed.error : parsed) as Record<string, unknown>;
      const code = typeof errObj.code === 'string' ? errObj.code : typeof parsed.code === 'string' ? parsed.code : undefined;
      const message = typeof errObj.message === 'string' ? errObj.message : typeof parsed.message === 'string' ? parsed.message : `HTTP ${res.status}`;
      return { ok: false, status: res.status, code, message, raw: { ...parsed, ...errObj } };
    }
    const payload = (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data) ? parsed.data : parsed) as T;
    return { ok: true, data: payload };
  }

  async getBalance(accountId: string): Promise<OpResult<{ balance: number; currency: 'XAF' }>> {
    const phone = normalizePhone(accountId);
    const r = await this.request<Record<string, unknown>>('GET', `accounts/${encodeURIComponent(phone)}`);
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const acc = (r.data.account && typeof r.data.account === 'object' ? r.data.account : r.data) as Record<string, unknown>;
    return { ok: true, value: { balance: Number(acc.balance ?? 0), currency: 'XAF' } };
  }

  async listContacts(_accountId: string): Promise<Contact[]> {
    const r = await this.request<Record<string, unknown> | unknown[]>('GET', 'beneficiaries');
    if (!r.ok) return [];
    const list = Array.isArray(r.data)
      ? r.data
      : Array.isArray((r.data as Record<string, unknown>).beneficiaries)
        ? (r.data as Record<string, unknown>).beneficiaries as unknown[]
        : Array.isArray((r.data as Record<string, unknown>).items)
          ? (r.data as Record<string, unknown>).items as unknown[]
          : [];
    return list.map((raw, i) => {
      const c = raw as Record<string, unknown>;
      return {
        id: String(c.id ?? `b${i + 1}`),
        name: String(c.name ?? c.holder ?? c.full_name ?? ''),
        phone: shortPhone(String(c.phone ?? c.account ?? '')),
      };
    }).filter((c) => c.name && c.phone);
  }

  async quoteFee(_accountId: string, kind: FeeKind, amount: number): Promise<OpResult<FeeQuote>> {
    const type = toSafinumType(kind);
    const r = await this.request<Record<string, unknown>>('GET', `fees?type=${encodeURIComponent(type)}&amount=${encodeURIComponent(String(amount))}`);
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const fee = Number(r.data.fee ?? 0);
    const total = Number(r.data.total ?? amount + fee);
    return { ok: true, value: { amount: Number(r.data.amount ?? amount), fee, total, rule: String(r.data.rule ?? 'grille SAFINUM') } };
  }

  private pendingPayload(accountId: string | undefined, input: PendingTransactionInput): Record<string, unknown> {
    const type = toSafinumType(input.op);
    const base: Record<string, unknown> = { type, amount: input.amount };
    if (accountId) base.from = normalizePhone(accountId);
    if (input.op === 'transfer' && input.to?.phone) base.to = normalizePhone(input.to.phone);
    if (input.op === 'airtime' && input.to?.phone) base.phone = normalizePhone(input.to.phone);
    if (input.op === 'bill' && input.biller) base.biller = input.biller;
    return base;
  }

  async createPending(accountId: string, input: PendingTransactionInput): Promise<OpResult<PendingTransactionHandle>> {
    const r = await this.request<Record<string, unknown>>('POST', 'transactions', this.pendingPayload(accountId, input));
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const tx = (r.data.transaction && typeof r.data.transaction === 'object' ? r.data.transaction : r.data) as Record<string, unknown>;
    const fee = Number(tx.fee ?? 0);
    const amount = Number(tx.amount ?? input.amount);
    return {
      ok: true,
      value: {
        id: String(tx.id ?? tx.transaction_id ?? ''),
        amount,
        fee,
        total: Number(tx.total ?? amount + fee),
      },
    };
  }

  async updatePending(txId: string, input: PendingTransactionInput): Promise<OpResult<PendingTransactionHandle>> {
    const payload = this.pendingPayload(undefined, input);
    delete payload.type;
    const r = await this.request<Record<string, unknown>>('POST', `transactions/${encodeURIComponent(txId)}/update`, payload);
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const tx = (r.data.transaction && typeof r.data.transaction === 'object' ? r.data.transaction : r.data) as Record<string, unknown>;
    const fee = Number(tx.fee ?? 0);
    const amount = Number(tx.amount ?? input.amount);
    return {
      ok: true,
      value: {
        id: String(tx.id ?? txId),
        amount,
        fee,
        total: Number(tx.total ?? amount + fee),
      },
    };
  }

  async confirmPending(txId: string): Promise<OpResult<Transaction>> {
    const r = await this.request<Record<string, unknown>>('POST', `transactions/${encodeURIComponent(txId)}/confirm`);
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const tx = (r.data.transaction && typeof r.data.transaction === 'object' ? r.data.transaction : r.data) as Record<string, unknown>;
    return {
      ok: true,
      value: {
        id: String(tx.id ?? txId),
        date: String(tx.date ?? tx.created_at ?? new Date().toISOString()),
        type: mapTxType(tx.type),
        amount: Number(tx.amount ?? 0),
        fee: Number(tx.fee ?? 0),
        counterparty: typeof tx.counterparty === 'string' ? tx.counterparty : typeof tx.to === 'string' ? tx.to : typeof tx.biller === 'string' ? tx.biller : undefined,
        status: tx.status === 'failed' ? 'failed' : 'success',
      },
    };
  }

  async cancelPending(txId: string): Promise<void> {
    await this.request('POST', `transactions/${encodeURIComponent(txId)}/cancel`);
  }

  async transfer(accountId: string, to: { name?: string; phone?: string }, amount: number): Promise<OpResult<Transaction>> {
    const p = await this.createPending(accountId, { op: 'transfer', amount, to });
    return p.ok ? this.confirmPending(p.value.id) : p;
  }

  async buyAirtime(accountId: string, phone: string, amount: number): Promise<OpResult<Transaction>> {
    const p = await this.createPending(accountId, { op: 'airtime', amount, to: { phone } });
    return p.ok ? this.confirmPending(p.value.id) : p;
  }

  async payBill(accountId: string, biller: string, amount: number): Promise<OpResult<Transaction>> {
    const p = await this.createPending(accountId, { op: 'bill', amount, biller });
    return p.ok ? this.confirmPending(p.value.id) : p;
  }

  async withdraw(accountId: string, amount: number): Promise<OpResult<Transaction>> {
    const p = await this.createPending(accountId, { op: 'withdraw', amount });
    return p.ok ? this.confirmPending(p.value.id) : p;
  }

  async history(accountId: string, limit: number): Promise<OpResult<Transaction[]>> {
    const phone = normalizePhone(accountId);
    const n = Math.min(50, Math.max(1, limit));
    const r = await this.request<Record<string, unknown> | unknown[]>('GET', `accounts/${encodeURIComponent(phone)}/transactions?limit=${n}`);
    if (!r.ok) return mapSafinumError(r.code, r.status, r.message, r.raw);
    const rows = Array.isArray(r.data)
      ? r.data
      : Array.isArray((r.data as Record<string, unknown>).transactions)
        ? (r.data as Record<string, unknown>).transactions as unknown[]
        : Array.isArray((r.data as Record<string, unknown>).items)
          ? (r.data as Record<string, unknown>).items as unknown[]
          : [];
    const txs: Transaction[] = rows.map((raw) => {
      const tx = raw as Record<string, unknown>;
      const st = String(tx.status ?? 'success').toLowerCase();
      return {
        id: String(tx.id ?? ''),
        date: String(tx.date ?? tx.created_at ?? new Date().toISOString()),
        type: mapTxType(tx.type),
        amount: Number(tx.amount ?? 0),
        fee: Number(tx.fee ?? 0),
        counterparty: typeof tx.counterparty === 'string' ? tx.counterparty : typeof tx.to === 'string' ? tx.to : typeof tx.biller === 'string' ? tx.biller : undefined,
        status: st === 'failed' ? 'failed' : 'success',
      };
    });
    return { ok: true, value: txs };
  }
}

export async function registerSafinumEndpoint(
  channel: string,
  url: string,
  opts: { baseUrl?: string; teamKey?: string } = {},
) {
  const baseUrl = (opts.baseUrl ?? process.env.CT_SAFINUM_URL ?? 'https://safinum.cm/api/v1').replace(/\/$/, '');
  const teamKey = opts.teamKey ?? process.env.CT_SAFINUM_KEY ?? '';
  const res = await fetch(`${baseUrl}/sandbox/endpoint`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-team-key': teamKey },
    body: JSON.stringify({ channel, url }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function getSafinumEndpoints(opts: { baseUrl?: string; teamKey?: string } = {}) {
  const baseUrl = (opts.baseUrl ?? process.env.CT_SAFINUM_URL ?? 'https://safinum.cm/api/v1').replace(/\/$/, '');
  const teamKey = opts.teamKey ?? process.env.CT_SAFINUM_KEY ?? '';
  const res = await fetch(`${baseUrl}/sandbox/endpoint`, {
    headers: { accept: 'application/json', 'x-team-key': teamKey },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function resetSafinumSandbox(opts: { baseUrl?: string; teamKey?: string } = {}) {
  const baseUrl = (opts.baseUrl ?? process.env.CT_SAFINUM_URL ?? 'https://safinum.cm/api/v1').replace(/\/$/, '');
  const teamKey = opts.teamKey ?? process.env.CT_SAFINUM_KEY ?? '';
  const res = await fetch(`${baseUrl}/sandbox/reset`, {
    method: 'POST',
    headers: { accept: 'application/json', 'x-team-key': teamKey },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

