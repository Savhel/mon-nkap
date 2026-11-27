// Moteur de dialogue financier, identique pour tous les canaux (mobile, web, USSD, SMS, IVR).
// Un canal n'envoie que du texte (ou de l'audio déjà transcrit) et reçoit une réponse structurée :
// c'est ce qui garantit que la même requête est interprétée de la même façon partout.

import type { Contact, FinancialBackend, Transaction } from '../backend/types.ts';
import { interpret, loadLexicon, type Intent, type Interpretation } from './nlu.ts';
import { render, type Reply, type ReplyKind } from './respond.ts';
import { FLAGSHIP_LANGS, frenchTo, toFrench } from '../mt/flagship.ts';
import { toCanonical, type CanonicalRequest } from './canonical.ts';
import { loadPack } from '../linguistics/pack.ts';
import { randomUUID } from 'node:crypto';
import type { AuditLog } from '../security/audit.ts';
import { identify, loadLangId } from '../linguistics/langid.ts';

/** Durée de validité d'une demande de confirmation : au-delà, il faut reconfirmer. */
export const CONFIRM_TTL_MS = 5 * 60_000;

export type Channel = 'mobile' | 'web' | 'ussd' | 'sms' | 'ivr' | 'atm' | 'api';
export type Status = 'answered' | 'needs_clarification' | 'awaiting_confirmation' | 'executed' | 'failed' | 'cancelled' | 'pending_reconciliation';

interface Pending {
  op: 'transfer' | 'airtime' | 'bill' | 'withdraw';
  amount?: number;
  fee?: number;
  beneficiary?: { name: string; phone: string };
  options?: Contact[];
  biller?: string;
  stage: 'collect' | 'choose' | 'confirm';
  /** Jeton de confirmation : lié à l'opération EXACTE présentée (toute correction en crée un nouveau), à usage unique. */
  token?: string;
  expires?: number;
  digest?: string;
  /** Identifiant de transaction en attente côté backend (ex. SAFINUM POST /transactions). */
  pendingTxId?: string;
  unresolved?: boolean;
}

interface Session { id: string; lang: string; accountId: string; pending?: Pending; turns: number }

export function juryTrial(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{12}$/.test(value) ? value : undefined;
}

export interface EngineRequest { sessionId: string; channel: Channel; text: string; lang?: string; accountId?: string; input?: 'text' | 'voice' | 'dtmf'; institution?: string; trial?: string }

/**
 * Clé de session commune à tous les canaux pour un même utilisateur (numéro de téléphone camerounais, 9 chiffres) :
 * une opération commencée par USSD peut être confirmée par SMS ou dans l'application.
 */
export function userSession(phone: string): string | null {
  const d = phone.replace(/\D/g, '').slice(-9);
  return /^[62]\d{8}$/.test(d) ? `user:${d}` : null;
}

export interface EngineResult {
  trial?: string;
  institution: string;
  sessionId: string;
  channel: Channel;
  lang: string;
  request: string;
  intent: Intent | 'confirm' | 'cancel' | 'correction' | 'language_switch' | 'choose' | null;
  params: Record<string, string | number>;
  status: Status;
  reply: Reply;
  transaction?: Transaction;
  latencyMs: number;
  errors: string[];
  understanding: Pick<Interpretation, 'matched' | 'confidence'> & { via: 'lexicon' | 'mt'; translation?: string; mtEngine?: string; detectedLanguage?: { code: string; confidence: number; switched: boolean } };
  /** Représentation financière canonique, identique quel que soit le canal. */
  canonical: CanonicalRequest;
  at: string;
}

const REPLY_INTROS: Partial<Record<ReplyKind['kind'], string>> = {
  balance: 'Vous pouvez consulter le solde de votre compte ci-dessous.',
  confirm_transfer: 'Vérifiez les informations du transfert avant de confirmer.',
  transfer_done: 'Le transfert est terminé. Vous pouvez consulter son reçu.',
  fee_quote: 'Vous pouvez consulter le détail des frais de ce transfert.',
};

export class Engine {
  private sessions = new Map<string, Session>();
  private turns = new Map<string, Promise<unknown>>();
  readonly log: EngineResult[] = [];
  private backend: FinancialBackend;
  private defaultLang: string;
  private audit?: AuditLog;
  constructor(backend: FinancialBackend, defaultLang = 'fr', audit?: AuditLog) { this.backend = backend; this.defaultLang = defaultLang; this.audit = audit; }

  private sessionKey(id: string, institution = 'local'): string {
    return JSON.stringify([institution, id]);
  }

  activePendingTxId(sessionId: string, institution?: string): string | undefined {
    return this.sessions.get(this.sessionKey(sessionId, institution))?.pending?.pendingTxId;
  }

  /**
   * Confirmation par jeton (bouton « Confirmer » d'une application bancaire) : n'exécute que si le jeton est
   * celui de l'opération actuellement présentée et n'a pas expiré. Un jeton déjà utilisé ne vaut plus rien.
   */
  async confirmWithToken(sessionId: string, token: string, channel: Channel, institution?: string, trial?: string): Promise<EngineResult | { error: string }> {
    const key = this.sessionKey(sessionId, institution);
    return this.inOrder<EngineResult | { error: string }>(key, () => {
      const p = this.sessions.get(key)?.pending;
      if (!p || p.stage !== 'confirm' || p.token !== token) return Promise.resolve({ error: 'jeton_invalide' });
      if (Date.now() > (p.expires ?? 0)) return Promise.resolve({ error: 'jeton_expire' });
      return this.handleTurn({ sessionId, channel, text: '1', input: 'dtmf', institution, trial });
    });
  }

  private async inOrder<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
    // Créer la continuation dans le contexte de la requête courante (institution et trace SAFINUM).
    const turn = (this.turns.get(sessionId) ?? Promise.resolve()).then(run, run);
    this.turns.set(sessionId, turn);
    try { return await turn; }
    finally { if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId); }
  }

  session(id: string, lang?: string, accountId = 'demo', institution?: string): Session {
    const key = this.sessionKey(id, institution);
    let s = this.sessions.get(key);
    if (!s) { s = { id, lang: lang ?? this.defaultLang, accountId, turns: 0 }; this.sessions.set(key, s); }
    else {
      if (lang && lang !== s.lang) s.lang = lang;
      if (accountId !== 'demo' && s.accountId !== accountId) throw new Error('compte incompatible avec la session');
    }
    return s;
  }

  handle(req: EngineRequest): Promise<EngineResult> {
    return this.inOrder(this.sessionKey(req.sessionId, req.institution), () => this.handleTurn(req));
  }

  private async handleTurn(req: EngineRequest): Promise<EngineResult> {
    const t0 = performance.now();
    const s = this.session(req.sessionId, req.lang, req.accountId, req.institution);
    s.turns++;
    const opBefore = s.pending?.op;
    const phoneBefore = s.pending?.beneficiary?.phone;
    const errors: string[] = [];
    let out: { kind: ReplyKind; status: Status; intent: EngineResult['intent']; tx?: Transaction };
    let it: Interpretation = interpret('', s.lang);
    let via: { via: 'lexicon' | 'mt'; translation?: string; mtEngine?: string } = { via: 'lexicon' };
    let detected: { code: string; confidence: number; switched: boolean } | undefined;
    try {
      const contacts = await this.backend.listContacts(s.accountId, req.text);
      it = interpret(req.text, s.lang, contacts);
      // Langue détectée dans le texte : on ne change de langue que si l'identification est sûre ET que la langue
      // détectée comprend la demande alors que la langue courante ne la comprend pas.
      const model = loadLangId();
      if (model && req.text.trim().length >= 6 && !/^\s*\d+\s*$/.test(req.text)) {
        const g = identify(req.text, model);
        if (g.lang) {
          let switched = false;
          const signal = (x: Interpretation) => x.asksLanguage || !!x.intent || x.isConfirm || x.isDeny || x.isCorrection;
          if (g.lang !== s.lang && !it.switchTo && loadLexicon(g.lang) && !signal(it)) {
            const alt = interpret(req.text, g.lang, contacts);
            if (signal(alt)) { it = alt; s.lang = g.lang; switched = true; }
          }
          detected = { code: g.lang, confidence: g.confidence, switched };
        }
      }
      // Langue nationale non comprise par le lexique : on essaie la traduction Flagship vers le français.
      // Seulement si le lexique n'a RIEN compris : une traduction automatique (mesurée peu fiable dans ce sens)
      // ne doit jamais remplacer une demande reconnue (« mon solde » devenait un transfert en Ewondo).
      // Les montants et numéros restent ceux du texte d'origine (la traduction les perd ou les invente).
      const menuKey = /^\s*\d\s*$/.test(req.text);
      if (FLAGSHIP_LANGS[s.lang] && !it.intent && !it.isConfirm && !it.isDeny && !it.isCorrection && !it.asksLanguage && !menuKey) {
        const mt = await toFrench(s.lang, req.text);
        if (mt) {
          const viaFr = interpret(mt.fr, 'fr', contacts);
          if (viaFr.intent && !viaFr.isConfirm && !viaFr.isDeny) {
            it = { ...it, intent: viaFr.intent, term: viaFr.term, matched: viaFr.matched, confidence: viaFr.confidence };
            via = { via: 'mt', translation: mt.fr, mtEngine: mt.engine };
          }
        }
      }
      out = await this.step(s, it, req.text, contacts, req.input);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      out = { kind: { kind: 'backend_error' }, status: 'failed', intent: null };
    }
    let reply: Reply;
    try { reply = render(out.kind, s.lang); }
    catch (e) { errors.push(String(e)); reply = render({ kind: 'backend_error' }, 'fr'); out.status = 'failed'; }

    // Traduire une annonce sans valeurs lorsque le récapitulatif doit rester en français.
    if (FLAGSHIP_LANGS[s.lang] && reply.lang === s.lang && reply.quality !== 'validated') {
      const mt = await frenchTo(s.lang, reply.fr);
      if (mt) {
        const { ms: _ms, ...rest } = mt;
        reply.mt = rest;
        if (mt.accepted && reply.quality === 'fallback') { reply.text = mt.text; reply.quality = 'machine'; }
        else if (reply.quality === 'fallback' && mt.reason === 'contient un chiffre' &&
                 (req.channel === 'mobile' || req.channel === 'web')) {
          const reference = REPLY_INTROS[out.kind.kind];
          const intro = reference ? await frenchTo(s.lang, reference) : null;
          if (intro?.accepted) reply.localizedIntro = { text: intro.text, engine: intro.engine };
        }
      }
    }

    const p = s.pending;
    const params: Record<string, string | number> = {};
    const k = out.kind as Record<string, unknown>;
    for (const f of ['amount', 'fee', 'total', 'beneficiary', 'phone', 'biller', 'term', 'balance'] as const) {
      const v = k[f];
      if (typeof v === 'string' || typeof v === 'number') params[f] = v;
    }
    if (p?.amount && params.amount === undefined) params.amount = p.amount;
    if (p?.beneficiary && params.beneficiary === undefined) params.beneficiary = p.beneficiary.name;
    if (out.tx) Object.assign(params, { amount: out.tx.amount, fee: out.tx.fee, total: out.tx.amount + out.tx.fee, beneficiary: out.tx.counterparty ?? '', reference: out.tx.id });
    if (out.tx && phoneBefore && /^\d{9}$/.test(phoneBefore) && params.phone === undefined) params.phone = phoneBefore;

    const OPS = { transfer: 'TRANSFER_MONEY', airtime: 'BUY_AIRTIME', bill: 'PAY_BILL', withdraw: 'WITHDRAW_MONEY' } as const;
    const op = s.pending?.op ?? opBefore;
    const pack = loadPack(s.lang);
    const confidence = Number(it.confidence.toFixed(2));
    const confirmationToken = s.pending?.stage === 'confirm' && out.status === 'awaiting_confirmation' ? s.pending.token : undefined;
    const canonical = toCanonical({ confirmationToken,
      lang: s.lang, channel: req.channel, intent: out.intent, status: out.status, params, transaction: out.tx, confidence,
      evidence: it.matched, operation: op ? OPS[op] : null, resources: pack ? { [`pack:${s.lang}`]: pack.generatedAt } : {},
    });
    const result: EngineResult = {
      ...(req.trial ? { trial: req.trial } : {}), institution: req.institution ?? 'local', sessionId: s.id, channel: req.channel, lang: s.lang, request: req.text, intent: out.intent, params, status: out.status,
      reply, transaction: out.tx, latencyMs: Math.round(performance.now() - t0), errors,
      understanding: { matched: it.matched, confidence, ...via, ...(detected ? { detectedLanguage: detected } : {}) }, canonical, at: new Date().toISOString(),
    };
    if (this.audit && op && ['executed', 'cancelled', 'failed'].includes(out.status) && out.intent !== null) {
      this.audit.append({
        ...(req.trial ? { trial: req.trial } : {}), institution: req.institution ?? 'local', sessionId: s.id, channel: req.channel, language: s.lang, operation: canonical.operation ?? OPS[op],
        act: canonical.act, status: out.status, amount: canonical.entities.amount, fee: canonical.entities.fee,
        beneficiary: canonical.entities.beneficiary?.phone ?? canonical.entities.beneficiary?.name ?? canonical.entities.biller, reference: canonical.entities.reference,
      });
    }
    this.log.push(result);
    if (this.log.length > 1000) this.log.shift();
    return result;
  }

  private async step(s: Session, it: Interpretation, raw: string, contacts: Contact[], input: EngineRequest['input']): Promise<{ kind: ReplyKind; status: Status; intent: EngineResult['intent']; tx?: Transaction }> {
    const unresolved = s.pending;
    if (unresolved?.unresolved && unresolved.pendingTxId) {
      const result = await this.backend.reconcilePending?.(unresolved.pendingTxId);
      return this.finishExecution(s, unresolved, result ?? { ok: false, code: 'outcome_unknown', message: 'Statut indisponible.' });
    }
    // 1. Changement de langue : l'opération en cours est conservée.
    if (it.switchTo && it.switchTo !== s.lang) {
      s.lang = it.switchTo;
      if (s.pending?.stage === 'confirm') return { ...(await this.prompt(s)), intent: 'language_switch' };
      return { kind: { kind: 'language_switched' }, status: 'answered', intent: 'language_switch' };
    }

    if (it.asksLanguage && !it.switchTo) {
      return { kind: { kind: 'which_language' }, status: 'needs_clarification', intent: 'language_switch' };
    }

    const p = s.pending;
    if (p) {
      // 2a. Choix entre plusieurs bénéficiaires (chiffre au clavier ou nom).
      if (p.stage === 'choose' && p.options) {
        const digit = raw.trim().match(/^\d$/)?.[0];
        const matchingOptions = p.options.filter((option) => it.phone
          ? option.phone === it.phone
          : !it.phones.length && it.beneficiaryCandidates.some((candidate) => candidate.phone === option.phone));
        const chosen = digit ? p.options[Number(digit) - 1] : matchingOptions.length === 1 ? matchingOptions[0] : undefined;
        if (chosen) { p.beneficiary = { name: chosen.name, phone: chosen.phone }; p.options = undefined; p.stage = 'collect'; return { ...(await this.advance(s)), intent: 'choose' }; }
        if (it.isDeny) return this.cancel(s);
        // Une autre demande pendant « Lequel ? » : une question de vocabulaire y répond sans perdre le transfert ;
        // une autre opération abandonne le choix (rien n'a été exécuté) et est traitée. Sinon on restait bloqué.
        if (it.intent === 'explain_term' && it.term) return { kind: { kind: 'explain', term: it.term }, status: 'answered', intent: 'explain_term' };
        if (it.intent && !['transfer', 'airtime', 'greeting', 'help'].includes(it.intent)) {
          if (p.pendingTxId && this.backend.cancelPending) await this.backend.cancelPending(p.pendingTxId).catch(() => {});
          s.pending = undefined;
          return this.step(s, it, raw, contacts, input);
        }
        return { kind: { kind: 'ask_which_beneficiary', options: p.options.map((o) => ({ name: o.name, phone: o.phone })) }, status: 'needs_clarification', intent: 'choose' };
      }

      // Touche de menu (USSD, IVR, clavier) : 1 = confirmer, 2 = annuler. Jamais lue comme un montant.
      if (p.stage === 'confirm' && input !== 'voice' && /^\s*[12]\s*$/.test(raw)) return raw.trim() === '1' ? this.execute(s) : this.cancel(s);

      if (it.amounts.length > 1 && !it.isCorrection) {
        p.token = undefined;
        p.amount = undefined;
        p.stage = 'collect';
        return { kind: { kind: 'ask_amount' }, status: 'needs_clarification', intent: 'correction' };
      }
      const newAmount = it.isCorrection && it.amounts.length > 1 ? it.amounts.at(-1) : it.amounts[0];
      const newBenef = p.op === 'transfer' || p.op === 'airtime' ? this.resolveBeneficiary(it, contacts) : { kind: 'none' as const };
      const changes = (newAmount !== undefined && newAmount !== p.amount) || (newBenef.kind === 'one' && newBenef.value.phone !== p.beneficiary?.phone) || newBenef.kind === 'many';
      const otherIntent = it.intent && it.intent !== (p.op === 'bill' ? 'bill_payment' : p.op) && !['greeting', 'help'].includes(it.intent) && !changes;

      // 2b. Correction avant exécution.
      if (changes && (p.stage === 'confirm' || p.stage === 'collect')) {
        const corrected: 'amount' | 'beneficiary' = newAmount !== undefined && newAmount !== p.amount ? 'amount' : 'beneficiary';
        if (newAmount !== undefined) p.amount = newAmount;
        if (newBenef.kind === 'one') p.beneficiary = newBenef.value;
        if (newBenef.kind === 'many') { p.token = undefined; p.options = newBenef.options; p.stage = 'choose'; return { kind: { kind: 'ask_which_beneficiary', options: newBenef.options.map((o) => ({ name: o.name, phone: o.phone })) }, status: 'needs_clarification', intent: 'correction' }; }
        const wasConfirm = p.stage === 'confirm';
        const r = await this.advance(s, wasConfirm ? corrected : undefined);
        return { ...r, intent: wasConfirm ? 'correction' : r.intent };
      }
      if (p.stage === 'confirm') {
        if (it.isConfirm && !it.isDeny && input !== 'voice') return this.execute(s);
        if (it.isDeny) return this.cancel(s);
        if (!otherIntent) return { ...(await this.prompt(s)), intent: 'confirm' };
        if (p.pendingTxId && this.backend.cancelPending) await this.backend.cancelPending(p.pendingTxId).catch(() => {});
        s.pending = undefined; // nouvelle demande : on abandonne l'opération en attente sans l'exécuter
      } else if (p.stage === 'collect') {
        if (it.isDeny && !it.amounts.length) return this.cancel(s);
        if (!otherIntent) return this.advance(s);
        if (p.pendingTxId && this.backend.cancelPending) await this.backend.cancelPending(p.pendingTxId).catch(() => {});
        s.pending = undefined;
      }
    }

    // 3. Nouvelle demande.
    switch (it.intent) {
      case 'balance': {
        const b = await this.backend.getBalance(s.accountId);
        if (!b.ok) return { kind: { kind: b.code === 'unknown_account' ? 'unknown_account' : 'backend_error' }, status: 'failed', intent: 'balance' };
        return { kind: { kind: 'balance', balance: b.value.balance }, status: 'answered', intent: 'balance' };
      }
      case 'fees': {
        if (!it.amounts.length) return { kind: { kind: 'explain', term: 'fees' }, status: 'answered', intent: 'fees' };
        const q = await this.backend.quoteFee(s.accountId, 'transfer', it.amounts[0]);
        if (!q.ok) return { kind: { kind: 'ask_amount' }, status: 'needs_clarification', intent: 'fees' };
        return { kind: { kind: 'fee_quote', ...q.value }, status: 'answered', intent: 'fees' };
      }
      case 'history': {
        const h = await this.backend.history(s.accountId, 5);
        if (!h.ok) return { kind: { kind: h.code === 'unknown_account' ? 'unknown_account' : 'backend_error' }, status: 'failed', intent: 'history' };
        return { kind: { kind: 'history', items: h.value }, status: 'answered', intent: 'history' };
      }
      case 'explain_term': return { kind: it.term ? { kind: 'explain', term: it.term } : { kind: 'help' }, status: 'answered', intent: 'explain_term' };
      case 'help': return { kind: { kind: 'help' }, status: 'answered', intent: 'help' };
      case 'greeting': return { kind: { kind: 'greeting' }, status: 'answered', intent: 'greeting' };
      case 'transfer': case 'airtime': case 'bill_payment': case 'withdraw': {
        const op = it.intent === 'bill_payment' ? 'bill' : it.intent;
        if (it.amounts.length > 1 && !it.isCorrection) return { kind: { kind: 'ask_amount' }, status: 'needs_clarification', intent: it.intent };
        s.pending = { op, stage: 'collect', amount: it.isCorrection && it.amounts.length > 1 ? it.amounts.at(-1) : it.amounts[0], biller: it.biller };
        if (op === 'airtime') {
          const recipient = this.resolveBeneficiary(it, contacts);
          if (recipient.kind === 'many') {
            s.pending.options = recipient.options;
            s.pending.stage = 'choose';
            return { kind: { kind: 'ask_which_beneficiary', options: recipient.options }, status: 'needs_clarification', intent: 'airtime' };
          }
          s.pending.beneficiary = recipient.kind === 'one' ? recipient.value : { name: 'mon numéro', phone: 'mon numéro' };
        }
        if (op === 'transfer') {
          const b = this.resolveBeneficiary(it, contacts);
          if (b.kind === 'one') s.pending.beneficiary = b.value;
          if (b.kind === 'many') { s.pending.options = b.options; s.pending.stage = 'choose'; return { kind: { kind: 'ask_which_beneficiary', options: b.options.map((o) => ({ name: o.name, phone: o.phone })) }, status: 'needs_clarification', intent: 'transfer' }; }
        }
        return this.advance(s);
      }
      default:
        // Un montant seul, ou rien de reconnu : on demande au lieu de deviner.
        return { kind: { kind: it.amounts.length || it.beneficiaryCandidates.length ? 'ask_intent' : 'not_understood' }, status: 'needs_clarification', intent: null };
    }
  }

  private resolveBeneficiary(it: Interpretation, contacts: Contact[]): { kind: 'none' } | { kind: 'one'; value: { name: string; phone: string } } | { kind: 'many'; options: Contact[] } {
    if (it.phones.length > 1) {
      return { kind: 'many', options: it.phones.slice(0, 6).map((phone) =>
        contacts.find((contact) => contact.phone === phone) ?? { id: phone, name: phone, phone }) };
    }
    if (it.phone) {
      const c = contacts.find((x) => x.phone === it.phone);
      return { kind: 'one', value: { name: c?.name ?? it.phone, phone: it.phone } };
    }
    if (it.beneficiaryCandidates.length === 1) return { kind: 'one', value: { name: it.beneficiaryCandidates[0].name, phone: it.beneficiaryCandidates[0].phone } };
    if (it.beneficiaryCandidates.length > 1) return { kind: 'many', options: it.beneficiaryCandidates };
    return { kind: 'none' };
  }

  /** Complète l'opération en cours : demande ce qui manque, vérifie le solde, puis demande confirmation. */
  private async advance(s: Session, corrected?: 'amount' | 'beneficiary') {
    const p = s.pending!;
    const intent = p.op === 'bill' ? 'bill_payment' as const : p.op;
    if (p.op === 'transfer' && !p.amount) return { kind: { kind: 'ask_amount', beneficiary: p.beneficiary?.name } as ReplyKind, status: 'needs_clarification' as Status, intent };
    if (p.op === 'transfer' && !p.beneficiary) return { kind: { kind: 'ask_beneficiary', amount: p.amount } as ReplyKind, status: 'needs_clarification' as Status, intent };
    if (p.op !== 'transfer' && !p.amount) return { kind: { kind: 'ask_amount' } as ReplyKind, status: 'needs_clarification' as Status, intent };
    if (p.op === 'bill' && !p.biller) return { kind: { kind: 'ask_intent' } as ReplyKind, status: 'needs_clarification' as Status, intent };
    p.stage = 'confirm';
    return { ...(await this.prompt(s, corrected)), intent };
  }

  private async prompt(s: Session, corrected?: 'amount' | 'beneficiary'): Promise<{ kind: ReplyKind; status: Status; intent: EngineResult['intent'] }> {
    const p = s.pending!;
    const kind = p.op === 'bill' ? 'bill' : p.op;
    const intent = p.op === 'bill' ? 'bill_payment' as const : p.op;
    // Invalider l'ancien récapitulatif avant tout appel réseau.
    p.token = undefined;
    const q = await this.backend.quoteFee(s.accountId, kind, p.amount!);
    if (!q.ok) {
      if (p.pendingTxId && this.backend.cancelPending) await this.backend.cancelPending(p.pendingTxId).catch(() => {});
      s.pending = undefined;
      if (q.code === 'limit_exceeded') return { kind: { kind: 'limit_exceeded', limit: Number(q.details?.limit ?? 500_000) }, status: 'failed', intent };
      return { kind: { kind: 'backend_error' }, status: 'failed', intent: null };
    }
    const bal = await this.backend.getBalance(s.accountId);
    if (bal.ok && bal.value.balance < q.value.total) {
      if (p.pendingTxId && this.backend.cancelPending) await this.backend.cancelPending(p.pendingTxId).catch(() => {});
      s.pending = undefined;
      return { kind: { kind: 'insufficient', balance: bal.value.balance, required: q.value.total, missing: q.value.total - bal.value.balance }, status: 'failed', intent };
    }
    let fee = q.value.fee;
    let total = q.value.total;
    const txInput = { op: p.op, amount: p.amount!, to: p.beneficiary, biller: p.biller };
    if (p.pendingTxId && this.backend.updatePending) {
      const upd = await this.backend.updatePending(p.pendingTxId, txInput);
      if (!upd.ok) return this.handlePendingError(s, upd, intent);
      fee = upd.value.fee;
      total = upd.value.total;
    } else if (!p.pendingTxId && this.backend.createPending) {
      const cr = await this.backend.createPending(s.accountId, txInput);
      if (!cr.ok) return this.handlePendingError(s, cr, intent);
      p.pendingTxId = cr.value.id;
      fee = cr.value.fee;
      total = cr.value.total;
    }
    if (!Number.isSafeInteger(fee) || fee < 0 || total !== p.amount! + fee || !Number.isSafeInteger(total)) {
      return { kind: { kind: 'backend_error' }, status: 'failed', intent };
    }
    p.fee = fee;
    p.token = randomUUID(); p.expires = Date.now() + CONFIRM_TTL_MS; p.digest = this.digest(p);
    if (p.op === 'transfer') return { kind: { kind: 'confirm_transfer', amount: p.amount!, fee, total, beneficiary: p.beneficiary!.name, phone: p.beneficiary!.phone, corrected }, status: 'awaiting_confirmation', intent };
    if (p.op === 'withdraw') return { kind: { kind: 'confirm_withdraw', amount: p.amount!, fee, total }, status: 'awaiting_confirmation', intent };
    if (p.op === 'airtime') return { kind: { kind: 'confirm_airtime', amount: p.amount!, phone: p.beneficiary!.phone }, status: 'awaiting_confirmation', intent };
    return { kind: { kind: 'confirm_bill', biller: p.biller!, amount: p.amount!, fee, total }, status: 'awaiting_confirmation', intent };
  }

  private handlePendingError(
    s: Session,
    err: { ok: false; code: string; details?: Record<string, number | string> },
    intent: EngineResult['intent'],
  ): { kind: ReplyKind; status: Status; intent: EngineResult['intent'] } {
    s.pending = undefined;
    if (err.code === 'insufficient_funds') {
      return { kind: { kind: 'insufficient', balance: Number(err.details?.balance ?? 0), required: Number(err.details?.required ?? 0), missing: Number(err.details?.missing ?? 0) }, status: 'failed', intent };
    }
    if (err.code === 'unknown_account') return { kind: { kind: 'unknown_account' }, status: 'failed', intent };
    if (err.code === 'limit_exceeded') {
      return { kind: { kind: 'limit_exceeded', limit: Number(err.details?.limit ?? 500_000) }, status: 'failed', intent };
    }
    return { kind: { kind: 'backend_error' }, status: 'failed', intent };
  }

  private async execute(s: Session) {
    const p = s.pending!;
    // Une prédiction linguistique n'est jamais une autorisation : on n'exécute que l'opération exacte qui a été
    // présentée et confirmée, dans le délai. Sinon, on la représente pour une nouvelle confirmation.
    if (!p.token || Date.now() > (p.expires ?? 0) || p.digest !== this.digest(p)) return { ...(await this.prompt(s)), intent: 'confirm' as const };
    if (!p.pendingTxId) {
      const quote = await this.backend.quoteFee(s.accountId, p.op, p.amount!);
      if (!quote.ok || quote.value.fee !== p.fee || quote.value.total !== p.amount! + p.fee!) {
        return { ...(await this.prompt(s)), intent: 'confirm' as const };
      }
    }
    s.pending = undefined;
    const r = p.pendingTxId && this.backend.confirmPending
      ? await this.backend.confirmPending(p.pendingTxId)
      : p.op === 'transfer' ? await this.backend.transfer(s.accountId, p.beneficiary!, p.amount!)
      : p.op === 'airtime' ? await this.backend.buyAirtime(s.accountId, p.beneficiary!.phone, p.amount!)
      : p.op === 'withdraw' ? await this.backend.withdraw(s.accountId, p.amount!)
      : await this.backend.payBill(s.accountId, p.biller!, p.amount!);
    return this.finishExecution(s, p, r);
  }

  private async finishExecution(s: Session, p: Pending, r: Awaited<ReturnType<FinancialBackend['transfer']>>) {
    if (!r.ok && r.code === 'outcome_unknown' && p.pendingTxId) {
      p.token = undefined;
      p.unresolved = true;
      s.pending = p;
      return { kind: { kind: 'outcome_unknown', reference: p.pendingTxId } as ReplyKind, status: 'pending_reconciliation' as const, intent: 'confirm' as const };
    }
    s.pending = undefined;
    // Le reçu de la banque peut ne donner que le numéro du bénéficiaire : on affiche le nom qui a été confirmé.
    if (r.ok && p.beneficiary?.name && /^\+?\d{9,12}$/.test(r.value.counterparty ?? '') && r.value.counterparty!.endsWith(p.beneficiary.phone.replace(/\D/g, '').slice(-9))) {
      r.value.counterparty = p.beneficiary.name;
    }
    if (!r.ok) {
      if (r.code === 'insufficient_funds') return { kind: { kind: 'insufficient', balance: Number(r.details?.balance), required: Number(r.details?.required), missing: Number(r.details?.missing) } as ReplyKind, status: 'failed' as Status, intent: 'confirm' as const };
      if (r.code === 'limit_exceeded') return { kind: { kind: 'limit_exceeded', limit: Number(r.details?.limit) } as ReplyKind, status: 'failed' as Status, intent: 'confirm' as const };
      return { kind: { kind: r.code === 'unknown_account' ? 'unknown_account' : 'backend_error' } as ReplyKind, status: 'failed' as Status, intent: 'confirm' as const };
    }
    const bal = await this.backend.getBalance(s.accountId);
    const balance = bal.ok ? bal.value.balance : 0;
    const kind: ReplyKind = p.op === 'transfer' ? { kind: 'transfer_done', tx: r.value, balance } : p.op === 'airtime' ? { kind: 'airtime_done', tx: r.value, balance }
      : p.op === 'withdraw' ? { kind: 'withdraw_done', tx: r.value, balance } : { kind: 'bill_done', tx: r.value, balance };
    return { kind, status: 'executed' as Status, intent: 'confirm' as const, tx: r.value };
  }

  private digest(p: Pending): string {
    return JSON.stringify([p.op, p.amount, p.fee, p.beneficiary?.phone, p.biller]);
  }

  private async cancel(s: Session) {
    const txId = s.pending?.pendingTxId;
    s.pending = undefined;
    if (txId && this.backend.cancelPending) await this.backend.cancelPending(txId).catch(() => {});
    return { kind: { kind: 'cancelled' } as ReplyKind, status: 'cancelled' as Status, intent: 'cancel' as const };
  }
}
