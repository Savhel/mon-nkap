// API REST unique, partagée par tous les canaux. Sans framework (node:http) pour limiter les dépendances.
//
//   GET  /v1/health
//   GET  /v1/languages                 registre des langues et de leurs capacités réelles
//   POST /v1/message                   { sessionId, channel, lang?, text } → résultat du moteur
//   POST /v1/voice?sessionId&channel&lang   corps = audio (webm, wav, m4a…) → transcription + résultat
//   GET  /v1/tts?lang=fr&text=…        WAV (fr/en uniquement ; 404 explicite sinon)
//   GET  /v1/events                    journal au format du tableau de bord du jury
//   POST /ussd                         passerelle USSD (Africa's Talking : sessionId, phoneNumber, text) → « CON … » / « END … »
//   POST /sms                          SMS entrant (from, text) → { reply, segments, result }
//   GET  /                             page de test (micro + texte)
//   POST /v1/ivr?sessionId&digits&text   serveur vocal (corps = audio facultatif) → invites + ce qui est attendu
//   POST /ivr/at                       passerelle vocale Africa's Talking (formulaire) → XML
//   GET  /v1/native?lang&clips=a,b     réponse dite par des enregistrements natifs assemblés (404 + liste des manquants sinon)
//   GET  /v1/native/coverage?lang      ce qui est enregistré pour une langue
//   GET  /sdk.js                       SDK navigateur (Mboa, pages web)
//   GET  /canaux                       simulateur jury : USSD, SMS et web côte à côte
//   POST /v1/confirm                   { sessionId, token, channel } → exécute l'opération présentée, si le jeton est valide
//   POST /v1/analyze                   { text, lang } → représentation canonique, sans dialogue ni exécution
//   POST /v1/translate                 { text | texts, from?, to, allowDraft? } → traduction vers/depuis les langues locales (protégé par x-api-key)
//   POST /v1/identify                  { text } → langue du texte, ou « inconnue » si ce n'est pas sûr
//   GET  /v1/audit                     journal d'audit chaîné + vérification de la chaîne
//   GET|POST /v1/admin/keys            gestion des clés d'API par entreprise (en-tête x-admin-key si CT_ADMIN_KEY défini)
//
// Sécurité : clé d'API par institution (en-tête x-api-key, CT_API_KEYS ou data/api-keys.json) sur /v1/* (sauf health,
// languages, labels) ; limitation de débit ; en-tête Idempotency-Key sur /v1/message, /v1/confirm et /v1/translate ;
// CORS limité à CT_CORS_ORIGINS si défini.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { MockBackend } from '../backend/mock.ts';
import { SafinumBackend } from '../backend/safinum.ts';
import { Engine, userSession, type Channel } from '../core/engine.ts';
import { UssdChannel } from '../channels/ussd.ts';
import { SmsChannel } from '../channels/sms.ts';
import { IvrChannel, toAfricasTalkingXml, type IvrTurn } from '../channels/ivr.ts';
import { SafinumChannel } from '../channels/safinum.ts';
import { encodeWav, synthesize, toSamples16k, transcribe, ttsAvailable } from '../voice/speech.ts';
import { assemble, coverage, missingClips } from '../voice/native.ts';
import { AuditLog, verifyChain } from '../security/audit.ts';
import { ApiKeys, IdempotencyCache, RateLimiter, verifySecret } from '../security/guards.ts';
import { interpret } from '../core/nlu.ts';
import { toCanonical } from '../core/canonical.ts';
import { evaluateLanguage } from '../eval/evaluate.ts';
import { uiLabels } from '../core/respond.ts';
import { translateText } from '../core/translate.ts';
import { identify, loadLangId } from '../linguistics/langid.ts';
import { getLangIdSummary, listCollecteLanguages, readCollecteSheet, refreshLangIdFromPacks, trainLanguagePack, writeCollecteSheet, type TrainerPaths } from '../linguistics/trainer.ts';
import { ensureMtService, mtStatus, stopMtService } from '../mt/service.ts';
import { fileURLToPath } from 'node:url';

const CHANNELS = new Set<Channel>(['mobile', 'web', 'ussd', 'sms', 'ivr', 'atm', 'api']);
const MAX_AUDIO = 10 * 1024 * 1024;

// Pages et fichiers publics, sur liste blanche (aucun chemin arbitraire n'est servi).
const HTML = 'text/html; charset=utf-8', JS = 'text/javascript; charset=utf-8';
const STATIC: Record<string, [string, string]> = {
  '/mobile': ['mobile.html', HTML], '/banque': ['banque.html', HTML], '/gab': ['gab.html', HTML], '/tableau': ['dashboard.html', HTML],
  '/portail': ['portail.html', HTML], '/admin': ['admin.html', HTML],
  '/assistant.js': ['assistant.js', JS], '/assistant.css': ['assistant.css', 'text/css; charset=utf-8'], '/tokens.css': ['tokens.css', 'text/css; charset=utf-8'], '/widget.js': ['widget.js', JS],
  '/sw.js': ['sw.js', JS], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

const AUDIT_FILE = process.env.CT_AUDIT_FILE ?? fileURLToPath(new URL('../../data/audit/audit.jsonl', import.meta.url));

/** Création libre de clés sur /portail : fermée par défaut, sinon n'importe qui obtiendrait une clé et la protection
 *  par clé d'API ne servirait plus à rien. Ouverte seulement avec CT_PORTAL_SIGNUP=1 (démonstration). */
const portalSignupEnabled = () => process.env.CT_PORTAL_SIGNUP === '1';

export function createApp(engine?: Engine, opts: { auditFile?: string | null; keysFile?: string | null; trainerPaths?: TrainerPaths } = {}) {
  const audit = new AuditLog(opts.auditFile === null ? undefined : opts.auditFile ?? AUDIT_FILE);
  const useSafinum = process.env.CT_BACKEND === 'safinum' || !!process.env.CT_SAFINUM_KEY;
  engine ??= new Engine(useSafinum ? new SafinumBackend() : new MockBackend(), 'fr', audit);
  const keys = new ApiKeys(process.env.CT_API_KEYS ?? '', opts.keysFile);
  const limiter = new RateLimiter();
  const idem = new IdempotencyCache<unknown>();
  const corsOrigins = (process.env.CT_CORS_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const languages = JSON.parse(readFileSync(new URL('../../data/languages.json', import.meta.url), 'utf8'));
  const page = (name = 'index.html') => readFileSync(new URL(`../../public/${name}`, import.meta.url));
  // Continuité entre canaux (même numéro = même conversation), désactivable avec CT_CONTINUITY=0.
  const continuity = process.env.CT_CONTINUITY !== '0';
  const ussd = new UssdChannel(engine, { continuity });
  const sms = new SmsChannel(engine, { continuity });
  const ivr = new IvrChannel(engine);
  const safinum = new SafinumChannel(engine, { continuity });
  // Enregistrements d'appel : on ne télécharge que depuis les hôtes de l'opérateur (pas de SSRF).
  const recordingHosts = (process.env.CT_IVR_RECORDING_HOSTS ?? 'africastalking.com').split(',').map((h) => h.trim()).filter(Boolean);
  const allowedRecording = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && recordingHosts.some((h) => x.hostname === h || x.hostname.endsWith('.' + h)); } catch { return false; } };
  const audioUrl = (p: { voice: string; text: string; clips?: string[] }) => (p.clips ? `/v1/native?lang=${p.voice}&clips=${p.clips.join(',')}` : `/v1/tts?lang=${p.voice}&text=${encodeURIComponent(p.text)}`);
  const withAudio = (turn: IvrTurn) => ({ ...turn, prompts: turn.prompts.map((p) => ({ ...p, audio: audioUrl(p) })) });
  // Les passerelles télécom envoient du formulaire ; le simulateur envoie du JSON. On accepte les deux.
  const fields = async (req: IncomingMessage): Promise<Record<string, string>> => {
    const raw = (await body(req, 16 * 1024)).toString('utf8');
    if ((req.headers['content-type'] ?? '').includes('json')) {
      const o = JSON.parse(raw || '{}');
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? '')]));
    }
    return Object.fromEntries(new URLSearchParams(raw));
  };

  async function body(req: IncomingMessage, limit: number): Promise<Buffer> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('corps trop volumineux'), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks);
  }
  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const channelOf = (v: unknown): Channel => (typeof v === 'string' && CHANNELS.has(v as Channel) ? (v as Channel) : 'api');

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin ?? '';
    res.setHeader('access-control-allow-origin', !corsOrigins.length ? '*' : corsOrigins.includes(origin) ? origin : 'null');
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type, x-api-key, x-admin-key, idempotency-key');
    res.setHeader('x-content-type-options', 'nosniff');
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const client = String(req.headers['x-api-key'] ?? req.socket.remoteAddress ?? 'anon');
      if (req.method === 'POST' && !limiter.allow(client)) return json(res, 429, { error: 'trop_de_requetes' });
      const isAdminPath = url.pathname.startsWith('/v1/admin/');
      if (isAdminPath) {
        const adminKey = process.env.CT_ADMIN_KEY;
        if (!adminKey) return json(res, 503, { error: 'admin_non_configure' });
        if (!verifySecret(adminKey, req.headers['x-admin-key'] as string | undefined)) return json(res, 401, { error: 'cle_admin_requise' });
      }
      // API des institutions : clé obligatoire si CT_API_KEYS ou data/api-keys.json est actif (les passerelles télécom ont leurs routes).
      const publicPath = isAdminPath || ['/v1/health', '/v1/languages', '/v1/labels', '/v1/portal/config', '/v1/portal/keys'].includes(url.pathname) || !url.pathname.startsWith('/v1/');
      const institution = isAdminPath ? 'admin' : keys.institution(req.headers['x-api-key'] as string | undefined);
      if (!publicPath && !institution) return json(res, 401, { error: 'cle_api_requise' });
      const idemKey = req.headers['idempotency-key'] ? `${institution}:${String(req.headers['idempotency-key']).slice(0, 128)}` : null;
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
      if (req.method === 'GET' && url.pathname === '/canaux') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page('canaux.html')); }
      if (req.method === 'GET' && url.pathname === '/sdk.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(page('sdk.js')); }
      const asset = STATIC[url.pathname];
      if (req.method === 'GET' && asset) { res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' }); return res.end(page(asset[0])); }
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        // La traduction est une dépendance obligatoire : sans elle, le service est déclaré en panne (503).
        const mt = await mtStatus();
        return json(res, mt.up ? 200 : 503, { ok: mt.up, translation: mt });
      }
      if (req.method === 'GET' && url.pathname === '/v1/languages') return json(res, 200, languages);
      if (req.method === 'GET' && url.pathname === '/v1/events') return json(res, 200, engine.log.slice(-200).reverse());

      if (req.method === 'POST' && url.pathname === '/v1/message') {
        const b = JSON.parse((await body(req, 64 * 1024)).toString('utf8') || '{}');
        if (typeof b.text !== 'string' || !b.text.trim()) return json(res, 400, { error: 'text requis' });
        const userSid = continuity && typeof b.userPhone === 'string' ? userSession(b.userPhone) : null;
        const run = () => engine!.handle({ sessionId: userSid ?? String(b.sessionId ?? 'anon'), channel: channelOf(b.channel), lang: typeof b.lang === 'string' ? b.lang : undefined, text: b.text.slice(0, 1000), input: 'text', institution: institution ?? undefined });
        if (!idemKey) return json(res, 200, await run());
        const { value, replayed } = idem.run(`message:${idemKey}`, run);
        res.setHeader('idempotent-replayed', String(replayed));
        return json(res, 200, await value);
      }

      if (req.method === 'POST' && url.pathname === '/v1/confirm') {
        const b = JSON.parse((await body(req, 4 * 1024)).toString('utf8') || '{}');
        if (typeof b.token !== 'string' || (typeof b.sessionId !== 'string' && typeof b.userPhone !== 'string')) return json(res, 400, { error: 'token et sessionId (ou userPhone) requis' });
        // Même session que /v1/message : si l'opération a été présentée avec userPhone, la confirmation y est rattachée.
        const sid = continuity && typeof b.userPhone === 'string' ? userSession(b.userPhone) : b.sessionId;
        const run = () => engine!.confirmWithToken(sid, b.token, channelOf(b.channel), institution ?? undefined);
        const { value, replayed } = idemKey ? idem.run(`confirm:${idemKey}`, run) : { value: run(), replayed: false };
        res.setHeader('idempotent-replayed', String(replayed));
        const r = await value as Awaited<ReturnType<typeof run>>;
        return 'error' in r ? json(res, 409, r) : json(res, 200, r);
      }

      if (req.method === 'POST' && url.pathname === '/v1/identify') {
        const b = JSON.parse((await body(req, 16 * 1024)).toString('utf8') || '{}');
        if (typeof b.text !== 'string' || !b.text.trim()) return json(res, 400, { error: 'text requis' });
        const model = loadLangId();
        if (!model) return json(res, 503, { error: 'identification_indisponible', message: 'Profils absents : lancez tools/build-langid.ts' });
        return json(res, 200, identify(b.text.slice(0, 1000), model));
      }

      if (req.method === 'POST' && url.pathname === '/v1/analyze') {
        const b = JSON.parse((await body(req, 16 * 1024)).toString('utf8') || '{}');
        if (typeof b.text !== 'string' || !b.text.trim()) return json(res, 400, { error: 'text requis' });
        const lang = typeof b.lang === 'string' ? b.lang : 'fr';
        const it = interpret(b.text.slice(0, 1000), lang);
        const params: Record<string, string | number> = {};
        if (it.amounts[0] !== undefined) params.amount = it.amounts[0];
        if (it.phone) params.phone = it.phone;
        if (it.beneficiaryText) params.beneficiary = it.beneficiaryText;
        if (it.biller && it.intent === 'bill_payment') params.biller = it.biller;
        if (it.term) params.term = it.term;
        const status = it.intent ? 'analyzed' : 'needs_clarification';
        return json(res, 200, toCanonical({ lang, channel: channelOf(b.channel), intent: it.intent, status, params, confidence: Number(it.confidence.toFixed(2)), evidence: it.matched }));
      }

      if (req.method === 'POST' && url.pathname === '/v1/translate') {
        const b = JSON.parse((await body(req, 64 * 1024)).toString('utf8') || '{}');
        const to = typeof b.to === 'string' ? b.to.trim().toLowerCase() : '';
        const from = typeof b.from === 'string' ? b.from.trim().toLowerCase() : 'fr';
        if (!/^[a-z]{2,3}$/.test(to) || !/^[a-z]{2,3}$/.test(from)) return json(res, 400, { error: 'from et to invalides' });
        const allowDraftFlag = typeof b.allowDraft === 'boolean' ? b.allowDraft : undefined;
        if (Array.isArray(b.texts)) {
          if (!b.texts.length || b.texts.length > 20 || b.texts.some((t: unknown) => typeof t !== 'string' || !t.trim())) {
            return json(res, 400, { error: 'texts invalide (1 à 20 chaînes non vides)' });
          }
          const run = async () => ({
            institution,
            items: await Promise.all((b.texts as string[]).map((t) => translateText({ text: t.slice(0, 1000), from, to, allowDraft: allowDraftFlag }))),
          });
          if (!idemKey) return json(res, 200, await run());
          const { value, replayed } = idem.run(`translate:${idemKey}`, run);
          res.setHeader('idempotent-replayed', String(replayed));
          return json(res, 200, await value);
        }
        if (typeof b.text !== 'string' || !b.text.trim()) return json(res, 400, { error: 'text requis' });
        const run = async () => ({
          institution,
          ...(await translateText({ text: b.text.slice(0, 1000), from, to, allowDraft: allowDraftFlag })),
        });
        if (!idemKey) return json(res, 200, await run());
        const { value, replayed } = idem.run(`translate:${idemKey}`, run);
        res.setHeader('idempotent-replayed', String(replayed));
        return json(res, 200, await value);
      }

      if (req.method === 'GET' && url.pathname === '/v1/admin/keys') {
        return json(res, 200, { keys: keys.list() });
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/keys') {
        const b = JSON.parse((await body(req, 8 * 1024)).toString('utf8') || '{}');
        if (typeof b.institution !== 'string' || !b.institution.trim()) return json(res, 400, { error: 'institution requise' });
        try {
          const created = keys.issue(b.institution, typeof b.name === 'string' ? b.name : undefined);
          return json(res, 201, created);
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : 'institution invalide' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/keys/revoke') {
        const b = JSON.parse((await body(req, 4 * 1024)).toString('utf8') || '{}');
        if (typeof b.id !== 'string' || !b.id.trim()) return json(res, 400, { error: 'id requis' });
        const revoked = keys.revoke(b.id.trim());
        return revoked ? json(res, 200, { record: revoked }) : json(res, 404, { error: 'cle_introuvable' });
      }

      if (req.method === 'GET' && url.pathname === '/v1/portal/config') {
        return json(res, 200, { signupEnabled: portalSignupEnabled() });
      }
      if (req.method === 'POST' && url.pathname === '/v1/portal/keys') {
        if (!portalSignupEnabled()) {
          return json(res, 403, { error: 'auto_inscription_desactivee', message: "La création libre est désactivée. Contactez l'administrateur." });
        }
        const b = JSON.parse((await body(req, 8 * 1024)).toString('utf8') || '{}');
        if (typeof b.institution !== 'string' || !b.institution.trim()) return json(res, 400, { error: 'institution requise' });
        if (typeof b.name !== 'string' || !b.name.trim()) return json(res, 400, { error: 'nom entreprise requis' });
        try {
          const created = keys.issue(b.institution, b.name);
          return json(res, 201, created);
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : 'institution invalide' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/v1/admin/training/status') {
        return json(res, 200, {
          languages: listCollecteLanguages(opts.trainerPaths),
          mt: await mtStatus(),
          langid: getLangIdSummary(opts.trainerPaths),
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/admin/training/sheet') {
        const lang = url.searchParams.get('lang') ?? '';
        const sheet = url.searchParams.get('sheet') ?? '';
        try {
          const csv = readCollecteSheet(lang, sheet, opts.trainerPaths);
          return json(res, 200, { lang, sheet, csv });
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : 'paramètres invalides' });
        }
      }
      if (req.method === 'PUT' && url.pathname === '/v1/admin/training/sheet') {
        const b = JSON.parse((await body(req, 512 * 1024)).toString('utf8') || '{}');
        if (typeof b.lang !== 'string' || typeof b.sheet !== 'string' || typeof b.csv !== 'string') {
          return json(res, 400, { error: 'lang, sheet et csv requis' });
        }
        try {
          const saved = writeCollecteSheet(b.lang, b.sheet, b.csv, opts.trainerPaths);
          return json(res, 200, { ok: true, lang: b.lang, sheet: b.sheet, ...saved });
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : 'sauvegarde impossible' });
        }
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/training/train') {
        const b = JSON.parse((await body(req, 16 * 1024)).toString('utf8') || '{}');
        const includeDrafts = !!b.includeDrafts;
        const retrainLangId = b.retrainLangId !== false;
        const targets = typeof b.lang === 'string' && b.lang.trim()
          ? [b.lang.trim().toLowerCase()]
          : listCollecteLanguages(opts.trainerPaths).map((x) => x.lang);
        if (!targets.length) return json(res, 400, { error: 'aucune_langue_a_entrainer' });
        const results = [];
        for (const l of targets) {
          results.push(await trainLanguagePack(l, { includeDrafts, paths: opts.trainerPaths }));
        }
        const langid = retrainLangId ? refreshLangIdFromPacks(targets, opts.trainerPaths) : null;
        return json(res, 200, { ok: true, results, langid });
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/training/mt-test') {
        const b = JSON.parse((await body(req, 16 * 1024)).toString('utf8') || '{}');
        const to = typeof b.to === 'string' ? b.to.trim().toLowerCase() : '';
        const from = typeof b.from === 'string' ? b.from.trim().toLowerCase() : 'fr';
        if (typeof b.text !== 'string' || !b.text.trim() || !/^[a-z]{2,3}$/.test(to) || !/^[a-z]{2,3}$/.test(from)) {
          return json(res, 400, { error: 'text, from et to valides requis' });
        }
        return json(res, 200, await translateText({ text: b.text.slice(0, 1000), from, to, allowDraft: !!b.allowDraft }));
      }

      if (req.method === 'GET' && url.pathname === '/v1/labels') {
        const lang = url.searchParams.get('lang') ?? 'fr';
        if (!/^[a-z]{2,3}$/.test(lang)) return json(res, 400, { error: 'lang invalide' });
        return json(res, 200, uiLabels(lang));
      }

      if (req.method === 'GET' && url.pathname === '/v1/eval') {
        const lang = url.searchParams.get('lang') ?? '';
        if (!/^[a-z]{2,3}$/.test(lang)) return json(res, 400, { error: 'lang requis' });
        return json(res, 200, await evaluateLanguage(lang, { includeDrafts: url.searchParams.get('drafts') === '1' }));
      }

      if (req.method === 'GET' && url.pathname === '/v1/audit') {
        return json(res, 200, { chainIntact: verifyChain(audit.events) === -1, events: audit.events.slice(-200) });
      }

      if (req.method === 'POST' && url.pathname === '/v1/voice') {
        const audio = await body(req, MAX_AUDIO);
        if (audio.length < 1000) return json(res, 400, { error: 'audio vide ou trop court' });
        const tr = await transcribe(new Uint8Array(audio));
        if (!tr.text) return json(res, 200, { transcript: tr, result: null, note: 'Rien n’a été reconnu. Parlez plus près du micro ou tapez votre demande.' });
        const r = await engine.handle({ sessionId: url.searchParams.get('sessionId') ?? 'anon', channel: channelOf(url.searchParams.get('channel')), lang: url.searchParams.get('lang') ?? undefined, text: tr.text, input: 'voice' });
        return json(res, 200, { transcript: tr, result: r });
      }

      if (req.method === 'POST' && url.pathname === '/ussd') {
        const f = await fields(req);
        if (!f.sessionId) return json(res, 400, { error: 'sessionId requis' });
        const out = await ussd.handle({ sessionId: f.sessionId.slice(0, 100), phoneNumber: f.phoneNumber ?? '', text: (f.text ?? '').slice(0, 500) });
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(out.response);
      }

      if (req.method === 'POST' && url.pathname === '/sms') {
        const f = await fields(req);
        if (!f.from || !f.text?.trim()) return json(res, 400, { error: 'from et text requis' });
        return json(res, 200, await sms.handle({ from: f.from, text: f.text, lang: f.lang || undefined }));
      }

      if (req.method === 'POST' && url.pathname === '/safinum/middleware') {
        const b = JSON.parse((await body(req, 64 * 1024)).toString('utf8') || '{}');
        const traceId = String(b.trace_id ?? req.headers['x-trace-id'] ?? '').trim();
        const phone = String(b.phone ?? '').trim();
        if (!traceId || !phone) return json(res, 400, { error: 'trace_id et phone requis' });
        const out = await safinum.handle({
          trace_id: traceId,
          team_id: typeof b.team_id === 'string' ? b.team_id : undefined,
          channel: typeof b.channel === 'string' ? b.channel : 'ussd',
          session_id: typeof b.session_id === 'string' ? b.session_id : phone,
          phone,
          language: typeof b.language === 'string' ? b.language : null,
          input: b.input && typeof b.input === 'object' ? b.input : {},
          constraints: b.constraints && typeof b.constraints === 'object' ? b.constraints : undefined,
          bank_api: b.bank_api && typeof b.bank_api === 'object' ? b.bank_api : undefined,
        });
        return json(res, 200, out);
      }

      if (req.method === 'POST' && url.pathname === '/v1/ivr') {
        const sid = (url.searchParams.get('sessionId') ?? '').slice(0, 100);
        if (!sid) return json(res, 400, { error: 'sessionId requis' });
        if (url.searchParams.get('action') === 'start') return json(res, 200, withAudio(ivr.start(sid)));
        if (url.searchParams.get('action') === 'hangup') { ivr.end(sid); return json(res, 200, { ok: true }); }
        const audio = await body(req, MAX_AUDIO);
        let transcript;
        let speech = (url.searchParams.get('text') ?? '').slice(0, 500);
        if (audio.length >= 1000) { transcript = await transcribe(new Uint8Array(audio)); speech = transcript.text; }
        const turn = await ivr.step(sid, { digits: url.searchParams.get('digits') ?? undefined, speech });
        return json(res, 200, { ...withAudio(turn), transcript });
      }

      if (req.method === 'POST' && url.pathname === '/ivr/at') {
        const f = await fields(req);
        const sid = (f.sessionId ?? '').slice(0, 100);
        const publicUrl = (process.env.CT_PUBLIC_URL ?? `https://${req.headers.host ?? 'localhost'}`).replace(/\/$/, '');
        res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' });
        if (!sid) return res.end('<?xml version="1.0" encoding="UTF-8"?><Response/>');
        if (f.isActive === '0') { ivr.end(sid); return res.end('<?xml version="1.0" encoding="UTF-8"?><Response/>'); }
        let speech = '';
        if (f.recordingUrl && allowedRecording(f.recordingUrl)) {
          const rec = await fetch(f.recordingUrl, { signal: AbortSignal.timeout(10000) });
          if (rec.ok) speech = (await transcribe(new Uint8Array(await rec.arrayBuffer()))).text;
        }
        const turn = !f.dtmfDigits && !f.recordingUrl ? ivr.start(sid) : await ivr.step(sid, { digits: f.dtmfDigits, speech });
        return res.end(toAfricasTalkingXml(turn, publicUrl, `${publicUrl}/ivr/at`));
      }

      if (req.method === 'GET' && url.pathname === '/v1/native/coverage') return json(res, 200, coverage(url.searchParams.get('lang') ?? ''));
      if (req.method === 'GET' && url.pathname === '/v1/native') {
        const lang = url.searchParams.get('lang') ?? '';
        const clips = (url.searchParams.get('clips') ?? '').split(',').filter(Boolean).slice(0, 80);
        const samples = await assemble(lang, clips, toSamples16k);
        if (!samples) return json(res, 404, { error: 'enregistrements_manquants', missing: missingClips(lang, clips) });
        res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
        return res.end(encodeWav(samples, 16000));
      }

      if (req.method === 'GET' && url.pathname === '/v1/tts') {
        const lang = url.searchParams.get('lang') ?? 'fr';
        const text = (url.searchParams.get('text') ?? '').slice(0, 600);
        if (!ttsAvailable(lang)) return json(res, 404, { error: 'voix_indisponible', message: `Aucune voix réelle pour « ${lang} ». Nous ne lisons pas une langue nationale avec une voix française.` });
        const wav = synthesize(text, lang);
        res.writeHead(200, { 'content-type': 'audio/wav' });
        return res.end(wav);
      }
      json(res, 404, { error: 'introuvable' });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      json(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  return { server, engine, keys };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 8080);
  const mt = await ensureMtService();
  if (mt.up) console.log(`Traduction Flagship : ${mt.pairs.length} paires prêtes (${mt.url})${mt.started ? ', service démarré par le moteur' : ''}`);
  else console.error(`ATTENTION : service de traduction INDISPONIBLE (${mt.error ?? 'raison inconnue'}). /v1/health répond 503. Installation : npm run mt:install && npm run mt:models`);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopMtService(); process.exit(0); });
  createApp().server.listen(port, () => console.log(`Mon Nkap : http://localhost:${port}`));
}
