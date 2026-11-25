// Séparation compréhension / exécution : jeton de confirmation, idempotence, audit chaîné, clés, débit.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, CONFIRM_TTL_MS } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { AuditLog, verifyChain } from '../src/security/audit.ts';
import { ApiKeys, IdempotencyCache, RateLimiter, verifySecret } from '../src/security/guards.ts';

let engine: Engine; let backend: MockBackend; let audit: AuditLog; let n = 0;
beforeEach(() => { backend = new MockBackend(); audit = new AuditLog(); engine = new Engine(backend, 'fr', audit); n++; });
const balance = async () => { const b = await backend.getBalance('demo'); return b.ok ? b.value.balance : NaN; };

test('confirmation par jeton : exécute une seule fois, le jeton ne resert pas', async () => {
  const sid = `t${n}`;
  const a = await engine.handle({ sessionId: sid, channel: 'mobile', lang: 'fr', text: 'envoie 5000 à Marie' });
  const token = a.canonical.confirmationToken!;
  assert.ok(token);
  assert.deepEqual(await engine.confirmWithToken(sid, 'faux-jeton', 'mobile'), { error: 'jeton_invalide' });
  const ok = await engine.confirmWithToken(sid, token, 'mobile');
  assert.ok('status' in ok && ok.status === 'executed');
  assert.deepEqual(await engine.confirmWithToken(sid, token, 'mobile'), { error: 'jeton_invalide' });
  assert.equal(await balance(), 150000 - 5100);
});

test('une correction invalide l’ancien jeton : on ne peut pas confirmer l’opération d’avant', async () => {
  const sid = `c${n}`;
  const a = await engine.handle({ sessionId: sid, channel: 'web', lang: 'fr', text: 'envoie 5000 à Marie' });
  const b = await engine.handle({ sessionId: sid, channel: 'web', lang: 'fr', text: 'non plutôt 3000' });
  assert.notEqual(a.canonical.confirmationToken, b.canonical.confirmationToken);
  assert.deepEqual(await engine.confirmWithToken(sid, a.canonical.confirmationToken!, 'web'), { error: 'jeton_invalide' });
  const r = await engine.confirmWithToken(sid, b.canonical.confirmationToken!, 'web');
  assert.ok('transaction' in r && r.transaction?.amount === 3000);
});

test('confirmation expirée : rien n’est exécuté, l’opération est représentée', async () => {
  const sid = `e${n}`;
  await engine.handle({ sessionId: sid, channel: 'ussd', lang: 'fr', text: 'envoie 5000 à Marie' });
  mock.timers.enable({ apis: ['Date'], now: Date.now() + CONFIRM_TTL_MS + 1000 });
  try {
    const r = await engine.handle({ sessionId: sid, channel: 'ussd', lang: 'fr', text: '1' });
    assert.equal(r.status, 'awaiting_confirmation');
    assert.equal(await balance(), 150000);
  } finally { mock.timers.reset(); }
});

test('idempotence : la même clé envoyée deux fois en parallèle n’exécute qu’une fois', async () => {
  const sid = `i${n}`;
  await engine.handle({ sessionId: sid, channel: 'api', lang: 'fr', text: 'envoie 5000 à Marie' });
  const cache = new IdempotencyCache<unknown>();
  const go = () => cache.run('cle-1', () => engine.handle({ sessionId: sid, channel: 'api', lang: 'fr', text: 'oui' }));
  const [x, y] = [go(), go()];
  assert.equal(x.replayed, false); assert.equal(y.replayed, true);
  assert.deepEqual(await x.value, await y.value);
  assert.equal(await balance(), 150000 - 5100);
});

test('journal d’audit : opérations tracées, numéros masqués, altération détectée', async () => {
  const sid = `a${n}`;
  await engine.handle({ sessionId: sid, channel: 'sms', lang: 'fr', text: 'envoie 5000 au 655778899', institution: 'banqueA' });
  await engine.handle({ sessionId: sid, channel: 'sms', lang: 'fr', text: 'oui', institution: 'banqueA' });
  await engine.handle({ sessionId: sid, channel: 'sms', lang: 'fr', text: 'envoie 1000 à Marie' });
  await engine.handle({ sessionId: sid, channel: 'sms', lang: 'fr', text: 'non' });
  assert.deepEqual(audit.events.map((e) => e.status), ['executed', 'cancelled']);
  assert.equal(audit.events[0].institution, 'banqueA');
  assert.equal(audit.events[0].beneficiary, '6XXXXXX99');
  assert.equal(verifyChain(audit.events), -1);
  const tampered = audit.events.map((e) => ({ ...e }));
  tampered[0].amount = 50;
  assert.equal(verifyChain(tampered), 0);
});

test('clés d’API par institution et limitation de débit', () => {
  const keys = new ApiKeys('banqueA:0123456789abcdef0123,court:abc', null);
  assert.equal(keys.institution('0123456789abcdef0123'), 'banqueA');
  assert.equal(keys.institution('abc'), null);          // clé trop courte : refusée à la configuration
  assert.equal(keys.institution(undefined), null);
  assert.equal(new ApiKeys('', null).institution(undefined), 'local');
  const rl = new RateLimiter(2);
  const t = 1_000_000;
  assert.ok(rl.allow('x', t)); assert.ok(rl.allow('x', t)); assert.ok(!rl.allow('x', t));
  assert.ok(rl.allow('x', t + 30_000));                   // rechargé au bout d'une demi-minute
});

test('registre persistant de clés par entreprise : émission, empreinte SHA-256 et révocation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mon-nkap-keys-'));
  const file = join(dir, 'api-keys.json');
  try {
    const store = new ApiKeys('', file);
    assert.equal(store.enabled, false);
    const { key, record } = store.issue('afriland', 'Afriland First Bank');
    assert.ok(key.startsWith('nk_live_'));
    assert.equal(record.institution, 'afriland');
    assert.equal(store.enabled, true);
    assert.equal(store.institution(key), 'afriland');
    assert.equal(store.institution(undefined), null);

    // Le secret en clair n'est jamais écrit sur disque, seulement son empreinte.
    const rawDisk = readFileSync(file, 'utf8');
    assert.ok(!rawDisk.includes(key));

    // Rechargement depuis le disque dans une nouvelle instance.
    const reloaded = new ApiKeys('', file);
    assert.equal(reloaded.institution(key), 'afriland');
    assert.equal(reloaded.list().length, 1);

    // Révocation immédiate.
    const rev = reloaded.revoke(record.id);
    assert.ok(rev && !rev.active);
    assert.equal(reloaded.institution(key), null);
    assert.equal(reloaded.enabled, true); // reste verrouillé même si toutes les clés sont révoquées
    assert.ok(verifySecret('secret-admin-123', 'secret-admin-123'));
    assert.ok(!verifySecret('secret-admin-123', 'autre'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
