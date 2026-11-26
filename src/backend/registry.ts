// Registre multi-institutions des connecteurs financiers + protection SSRF (§5.5 & §5.7).
// Permet à chaque entreprise bancaire (identifiée par sa clé API) de pointer vers son propre backend
// (`mock`, `safinum`, ou `http` générique) sans exposer le réseau interne (liste blanche / blocage SSRF).

import { AsyncLocalStorage } from 'node:async_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SafinumBackend } from './safinum.ts';
import type {
  Contact,
  FeeKind,
  FeeQuote,
  FinancialBackend,
  OpResult,
  Transaction,
} from './types.ts';

export const DEFAULT_CONNECTORS_FILE = fileURLToPath(new URL('../../data/connectors.json', import.meta.url));

const institutionStorage = new AsyncLocalStorage<string>();
export function runWithInstitution<T>(institution: string, fn: () => Promise<T>): Promise<T> {
  return institutionStorage.run(institution, fn);
}

export type ConnectorType = 'mock' | 'safinum' | 'http';

export interface ConnectorConfig {
  institution: string;
  type: ConnectorType;
  baseUrl?: string;
  authHeader?: string;
  /** Nom d'une variable d'environnement contenant le secret (recommandé en production). */
  authEnvVar?: string;
  /** Secret direct (jamais renvoyé par l'API de lecture). */
  authSecret?: string;
  updatedAt: string;
}

export interface ConnectorPublic {
  institution: string;
  type: ConnectorType;
  baseUrl?: string;
  authHeader?: string;
  authEnvVar?: string;
  hasSecret: boolean;
  updatedAt: string;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const ipVer = isIP(h);
  if (ipVer === 4) {
    const [a, b] = h.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  } else if (ipVer === 6) {
    if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  }
  return false;
}

/** Vérifie qu'une URL de connecteur est publique et sûre (anti-SSRF, sauf CT_ALLOW_PRIVATE_URLS=1). */
export function assertSafePublicUrl(raw: string, allowPrivate = process.env.CT_ALLOW_PRIVATE_URLS === '1'): URL {
  let u: URL;
  try { u = new URL(raw); } catch {
    throw Object.assign(new Error('URL invalide'), { code: 'INVALID_REQUEST', status: 422 });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('Identifiants interdits dans l’URL'), { code: 'UNSAFE_ENDPOINT', status: 422 });
  }
  if (!allowPrivate) {
    if (u.protocol !== 'https:') {
      throw Object.assign(new Error('URL refusée : seul HTTPS est accepté pour un connecteur externe'), { code: 'UNSAFE_ENDPOINT', status: 422 });
    }
    if (isPrivateHost(u.hostname)) {
      throw Object.assign(new Error('URL refusée : seules les adresses publiques sont acceptées'), { code: 'UNSAFE_ENDPOINT', status: 422 });
    }
  } else if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw Object.assign(new Error('Protocole HTTP/HTTPS requis'), { code: 'UNSAFE_ENDPOINT', status: 422 });
  }
  return u;
}

/** Connecteur HTTP REST générique pour une institution bancaire tierce. */
export class HttpConnectorBackend implements FinancialBackend {
  readonly name: string;
  private baseUrl: string;
  private authHeader?: string;
  private authSecret?: string;
  private timeoutMs: number;

  constructor(cfg: { institution: string; baseUrl: string; authHeader?: string; authSecret?: string; timeoutMs?: number }) {
    this.name = `http:${cfg.institution}`;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '');
    this.authHeader = cfg.authHeader;
    this.authSecret = cfg.authSecret;
    this.timeoutMs = cfg.timeoutMs ?? 4000;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<OpResult<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.authHeader && this.authSecret) headers[this.authHeader] = this.authSecret;
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        const code = (data.code as OpResult<never> extends { ok: false; code: infer C } ? C : never) ?? 'backend_error';
        return { ok: false, code: ['insufficient_funds', 'unknown_beneficiary', 'limit_exceeded', 'invalid_amount'].includes(String(code)) ? code : 'backend_error', message: String(data.message ?? `HTTP ${res.status}`) };
      }
      return { ok: true, value: data as T };
    } catch (e) {
      return { ok: false, code: 'backend_error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  getBalance(accountId: string) { return this.call<{ balance: number; currency: 'XAF' }>('GET', `/balance?accountId=${encodeURIComponent(accountId)}`); }
  async listContacts(accountId: string): Promise<Contact[]> {
    const r = await this.call<{ contacts?: Contact[] } | Contact[]>('GET', `/contacts?accountId=${encodeURIComponent(accountId)}`);
    if (!r.ok) return [];
    return Array.isArray(r.value) ? r.value : r.value.contacts ?? [];
  }
  quoteFee(accountId: string, kind: FeeKind, amount: number) {
    return this.call<FeeQuote>('GET', `/fees?accountId=${encodeURIComponent(accountId)}&kind=${encodeURIComponent(kind)}&amount=${amount}`);
  }
  transfer(accountId: string, to: { name?: string; phone?: string }, amount: number) {
    return this.call<Transaction>('POST', '/transfer', { accountId, to, amount });
  }
  buyAirtime(accountId: string, phone: string, amount: number) {
    return this.call<Transaction>('POST', '/airtime', { accountId, phone, amount });
  }
  payBill(accountId: string, biller: string, amount: number) {
    return this.call<Transaction>('POST', '/bill', { accountId, biller, amount });
  }
  withdraw(accountId: string, amount: number) {
    return this.call<Transaction>('POST', '/withdraw', { accountId, amount });
  }
  history(accountId: string, limit: number) {
    return this.call<Transaction[]>('GET', `/history?accountId=${encodeURIComponent(accountId)}&limit=${limit}`);
  }
}

export class ConnectorRegistry {
  private configs = new Map<string, ConnectorConfig>();
  private instances = new Map<string, FinancialBackend>();
  private file: string | null;
  private allowPrivateUrls: boolean;

  constructor(opts: { file?: string | null; allowPrivateUrls?: boolean } = {}) {
    this.allowPrivateUrls = opts.allowPrivateUrls ?? (process.env.CT_ALLOW_PRIVATE_URLS === '1');
    if (opts.file === null) this.file = null;
    else if (typeof opts.file === 'string' && opts.file.trim()) this.file = opts.file.trim();
    else {
      const envFile = process.env.CT_CONNECTORS_FILE;
      this.file = envFile ? envFile.trim() : existsSync(DEFAULT_CONNECTORS_FILE) ? DEFAULT_CONNECTORS_FILE : null;
    }
    this.reload();
  }

  reload(): void {
    this.configs.clear();
    this.instances.clear();
    if (!this.file || !existsSync(this.file)) return;
    const data = JSON.parse(readFileSync(this.file, 'utf8')) as { connectors?: ConnectorConfig[] };
    for (const c of data.connectors ?? []) this.configs.set(c.institution, c);
  }

  private save(): void {
    const target = this.file ?? DEFAULT_CONNECTORS_FILE;
    this.file = target;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ version: 1, connectors: [...this.configs.values()] }, null, 2) + '\n');
  }

  upsert(input: {
    institution: string;
    type: ConnectorType;
    baseUrl?: string;
    authHeader?: string;
    authEnvVar?: string;
    authSecret?: string;
  }): ConnectorPublic {
    const inst = input.institution.trim();
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(inst)) {
      throw Object.assign(new Error('Identifiant institution invalide'), { status: 400 });
    }
    if (input.type !== 'mock') {
      if (!input.baseUrl?.trim()) throw Object.assign(new Error('baseUrl requise pour un connecteur externe'), { status: 400 });
      assertSafePublicUrl(input.baseUrl.trim(), this.allowPrivateUrls);
    }
    const prev = this.configs.get(inst);
    const cfg: ConnectorConfig = {
      institution: inst,
      type: input.type,
      ...(input.baseUrl?.trim() ? { baseUrl: input.baseUrl.trim().replace(/\/$/, '') } : {}),
      ...(input.authHeader?.trim() ? { authHeader: input.authHeader.trim() } : {}),
      ...(input.authEnvVar?.trim() ? { authEnvVar: input.authEnvVar.trim() } : {}),
      ...(input.authSecret ? { authSecret: input.authSecret } : prev?.authSecret && input.authSecret !== '' ? { authSecret: prev.authSecret } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.configs.set(inst, cfg);
    this.instances.delete(inst);
    this.save();
    return this.toPublic(cfg);
  }

  remove(institution: string): boolean {
    const ok = this.configs.delete(institution);
    this.instances.delete(institution);
    if (ok) this.save();
    return ok;
  }

  private toPublic(c: ConnectorConfig): ConnectorPublic {
    return {
      institution: c.institution,
      type: c.type,
      baseUrl: c.baseUrl,
      authHeader: c.authHeader,
      authEnvVar: c.authEnvVar,
      hasSecret: !!(c.authSecret || (c.authEnvVar && process.env[c.authEnvVar])),
      updatedAt: c.updatedAt,
    };
  }

  list(): ConnectorPublic[] {
    return [...this.configs.values()].map((c) => this.toPublic(c));
  }

  resolve(institution: string | undefined, fallback: FinancialBackend): FinancialBackend {
    if (!institution) return fallback;
    const cfg = this.configs.get(institution);
    if (!cfg) return fallback;
    if (!this.instances.has(institution)) {
      const secret = cfg.authSecret ?? (cfg.authEnvVar ? process.env[cfg.authEnvVar] : undefined);
      const instance: FinancialBackend = cfg.type === 'mock'
        ? fallback
        : cfg.type === 'safinum'
          ? new SafinumBackend({ baseUrl: cfg.baseUrl, teamKey: secret })
          : new HttpConnectorBackend({ institution, baseUrl: cfg.baseUrl!, authHeader: cfg.authHeader, authSecret: secret });
      this.instances.set(institution, instance);
    }
    return this.instances.get(institution)!;
  }

  async testConnection(institution: string, accountId = 'demo', fallback: FinancialBackend): Promise<{ ok: boolean; backend: string; detail: unknown }> {
    const b = this.resolve(institution, fallback);
    const res = await b.getBalance(accountId);
    return { ok: res.ok, backend: b.name, detail: res.ok ? res.value : res };
  }
}

/** Route automatiquement chaque appel `FinancialBackend` vers le connecteur de l'institution courante. */
export class RouterBackend implements FinancialBackend {
  private fallback: FinancialBackend;
  private registry: ConnectorRegistry;

  constructor(fallback: FinancialBackend, registry: ConnectorRegistry) {
    this.fallback = fallback;
    this.registry = registry;
  }

  get name(): string { return this.current().name; }
  private current(): FinancialBackend { return this.registry.resolve(institutionStorage.getStore(), this.fallback); }

  getBalance(accountId: string) { return this.current().getBalance(accountId); }
  listContacts(accountId: string) { return this.current().listContacts(accountId); }
  quoteFee(accountId: string, kind: FeeKind, amount: number) { return this.current().quoteFee(accountId, kind, amount); }
  transfer(accountId: string, to: { name?: string; phone?: string }, amount: number) { return this.current().transfer(accountId, to, amount); }
  buyAirtime(accountId: string, phone: string, amount: number) { return this.current().buyAirtime(accountId, phone, amount); }
  payBill(accountId: string, biller: string, amount: number) { return this.current().payBill(accountId, biller, amount); }
  withdraw(accountId: string, amount: number) { return this.current().withdraw(accountId, amount); }
  history(accountId: string, limit: number) { return this.current().history(accountId, limit); }

  // Exposer uniquement les capacités du connecteur actif. Pour les autres,
  // le moteur conserve le devis et appelle le débit direct après confirmation.
  get createPending(): FinancialBackend['createPending'] {
    const backend = this.current();
    return backend.createPending?.bind(backend);
  }
  get updatePending(): FinancialBackend['updatePending'] {
    const backend = this.current();
    return backend.updatePending?.bind(backend);
  }
  get confirmPending(): FinancialBackend['confirmPending'] {
    const backend = this.current();
    return backend.confirmPending?.bind(backend);
  }
  get reconcilePending(): FinancialBackend['reconcilePending'] {
    const backend = this.current();
    return backend.reconcilePending?.bind(backend);
  }
  get cancelPending(): FinancialBackend['cancelPending'] {
    const backend = this.current();
    return backend.cancelPending?.bind(backend);
  }
}
