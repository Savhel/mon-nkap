// Protections de l'API : clés par institution (env + registre persistant haché), limitation de débit, idempotence.
//
// CT_API_KEYS="banqueA:cle-longue-1,operateurB:cle-longue-2"  → clés statiques par variable d'environnement.
// CT_KEYS_FILE="data/api-keys.json" (ou défaut data/api-keys.json si présent) → registre persistant géré par `npm run keys`
//   ou `/v1/admin/keys` : seules les empreintes SHA-256 des clés sont stockées sur disque.
// Sans aucune clé configurée, l'API est ouverte (développement et démonstration locale uniquement).
// CT_RATE_LIMIT=120 → requêtes par minute et par client (clé d'API, sinon adresse IP).
// En-tête Idempotency-Key : la même clé renvoie la même réponse pendant 24 h, sans retraiter la demande.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_KEYS_FILE = fileURLToPath(new URL('../../data/api-keys.json', import.meta.url));

export interface ApiKeyRecord {
  id: string;
  institution: string;
  name?: string;
  prefix: string;
  hash: string; // empreinte SHA-256 hexadécimale de la clé secrète
  createdAt: string;
  revokedAt?: string;
  active: boolean;
}

export interface ApiKeyPublic {
  id: string;
  institution: string;
  name?: string;
  prefix: string;
  createdAt: string;
  revokedAt?: string;
  active: boolean;
  source: 'env' | 'store';
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Comparaison à temps constant entre deux secrets (via leur empreinte SHA-256). */
export function verifySecret(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

export class ApiKeys {
  private keys = new Map<string, string>(); // clé env → institution
  private records: ApiKeyRecord[] = [];
  private file: string | null;

  constructor(spec = process.env.CT_API_KEYS ?? '', file: string | null | undefined = process.env.CT_KEYS_FILE) {
    for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf(':');
      if (i > 0 && part.length - i - 1 >= 16) this.keys.set(part.slice(i + 1), part.slice(0, i));
    }
    if (file === null) this.file = null;
    else if (typeof file === 'string' && file.trim()) this.file = file.trim();
    else this.file = existsSync(DEFAULT_KEYS_FILE) ? DEFAULT_KEYS_FILE : null;
    this.reload();
  }

  get storePath(): string | null { return this.file; }
  get enabled(): boolean { return this.keys.size > 0 || this.records.length > 0; }

  reload(): void {
    if (!this.file || !existsSync(this.file)) { this.records = []; return; }
    const data = JSON.parse(readFileSync(this.file, 'utf8')) as { keys?: ApiKeyRecord[] };
    this.records = Array.isArray(data.keys) ? data.keys : [];
  }

  private save(): void {
    const target = this.file ?? DEFAULT_KEYS_FILE;
    this.file = target;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ version: 1, keys: this.records }, null, 2) + '\n');
  }

  /** Institution correspondant à la clé, ou null. Comparaison à temps constant. */
  institution(key: string | undefined): string | null {
    if (!this.enabled) return 'local';
    if (!key) return null;
    for (const [k, inst] of this.keys) {
      const a = Buffer.from(k), b = Buffer.from(key);
      if (a.length === b.length && timingSafeEqual(a, b)) return inst;
    }
    const candidate = Buffer.from(sha256Hex(key), 'hex');
    for (const r of this.records) {
      if (!r.active) continue;
      const stored = Buffer.from(r.hash, 'hex');
      if (stored.length === candidate.length && timingSafeEqual(stored, candidate)) return r.institution;
    }
    return null;
  }

  /** Génère une nouvelle clé API pour une entreprise bancaire. La clé en clair n'est retournée qu'une seule fois. */
  issue(institution: string, name?: string): { key: string; record: ApiKeyPublic } {
    const inst = institution.trim();
    if (!/^[a-zA-Z0-9._-]{2,64}$/.test(inst)) {
      throw new Error('Identifiant institution invalide (2-64 caractères alphanumériques, ., _, -)');
    }
    const key = `nk_live_${randomBytes(24).toString('base64url')}`;
    const record: ApiKeyRecord = {
      id: randomBytes(8).toString('hex'),
      institution: inst,
      ...(name?.trim() ? { name: name.trim().slice(0, 120) } : {}),
      prefix: key.slice(0, 16),
      hash: sha256Hex(key),
      createdAt: new Date().toISOString(),
      active: true,
    };
    this.records.push(record);
    this.save();
    const { hash: _, ...pub } = record;
    return { key, record: { ...pub, source: 'store' } };
  }

  /** Révoque une clé par son identifiant (`id`) ou son préfixe (`prefix`). */
  revoke(idOrPrefix: string): ApiKeyPublic | null {
    const target = this.records.find((r) => r.active && (r.id === idOrPrefix || r.prefix === idOrPrefix));
    if (!target) return null;
    target.active = false;
    target.revokedAt = new Date().toISOString();
    this.save();
    const { hash: _, ...pub } = target;
    return { ...pub, source: 'store' };
  }

  /** Liste les clés enregistrées sans exposer aucun secret ni empreinte. */
  list(): ApiKeyPublic[] {
    const envKeys: ApiKeyPublic[] = [...this.keys.entries()].map(([k, inst], i) => ({
      id: `env-${i + 1}`,
      institution: inst,
      prefix: `${k.slice(0, 6)}…`,
      createdAt: '',
      active: true,
      source: 'env',
    }));
    const storeKeys: ApiKeyPublic[] = this.records.map(({ hash: _, ...r }) => ({ ...r, source: 'store' }));
    return [...envKeys, ...storeKeys];
  }
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private perMinute: number;
  constructor(perMinute = Number(process.env.CT_RATE_LIMIT ?? 120)) { this.perMinute = perMinute; }
  /** true si la requête est autorisée. Seau à jetons, rechargé en continu. */
  allow(client: string, now = Date.now()): boolean {
    const b = this.buckets.get(client) ?? { tokens: this.perMinute, at: now };
    b.tokens = Math.min(this.perMinute, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    if (b.tokens < 1) { this.buckets.set(client, b); return false; }
    b.tokens -= 1;
    this.buckets.set(client, b);
    if (this.buckets.size > 10_000) this.buckets.delete(this.buckets.keys().next().value!);
    return true;
  }
}

export class IdempotencyCache<T> {
  private entries = new Map<string, { value: Promise<T>; at: number }>();
  private ttl: number;
  constructor(ttlMs = 24 * 3600_000) { this.ttl = ttlMs; }
  /** Exécute `fn` une seule fois par clé ; les appels suivants reçoivent le même résultat (même en parallèle). */
  run(key: string, fn: () => Promise<T>, now = Date.now()): { value: Promise<T>; replayed: boolean } {
    const hit = this.entries.get(key);
    if (hit && now - hit.at < this.ttl) return { value: hit.value, replayed: true };
    const value = fn();
    this.entries.set(key, { value, at: now });
    if (this.entries.size > 50_000) this.entries.delete(this.entries.keys().next().value!);
    return { value, replayed: false };
  }
}
