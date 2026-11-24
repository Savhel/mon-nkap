// Protections de l'API : clés par institution, limitation de débit, idempotence.
//
// CT_API_KEYS="banqueA:cle-longue-1,operateurB:cle-longue-2"  → chaque institution a sa clé (en-tête x-api-key).
//   Sans cette variable, l'API est ouverte (développement et démonstration locale uniquement, signalé au démarrage).
// CT_RATE_LIMIT=120 → requêtes par minute et par client (clé d'API, sinon adresse IP).
// En-tête Idempotency-Key : la même clé renvoie la même réponse pendant 24 h, sans retraiter la demande
//   (un double envoi réseau ne crée jamais deux opérations).

import { timingSafeEqual } from 'node:crypto';

export class ApiKeys {
  private keys = new Map<string, string>(); // clé → institution
  constructor(spec = process.env.CT_API_KEYS ?? '') {
    for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
      const i = part.indexOf(':');
      if (i > 0 && part.length - i - 1 >= 16) this.keys.set(part.slice(i + 1), part.slice(0, i));
    }
  }
  get enabled(): boolean { return this.keys.size > 0; }
  /** Institution correspondant à la clé, ou null. Comparaison à temps constant. */
  institution(key: string | undefined): string | null {
    if (!this.enabled) return 'local';
    if (!key) return null;
    for (const [k, inst] of this.keys) {
      const a = Buffer.from(k), b = Buffer.from(key);
      if (a.length === b.length && timingSafeEqual(a, b)) return inst;
    }
    return null;
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
