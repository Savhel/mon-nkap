// Adaptateur passerelle SAFINUM (`POST /safinum/middleware`).
// Traduit le format exact du bac à sable SAFINUM (trace_id, channel, phone, language, input, constraints)
// vers notre moteur commun `Engine` et renvoie la réponse normalisée + conformité GSM-7 USSD (≤ 182 septets).

import { userSession, type Channel, type Engine, type EngineResult } from '../core/engine.ts';
import { runWithSafinumTrace } from '../backend/safinum.ts';
import { identify, loadLangId } from '../linguistics/langid.ts';

export interface SafinumGatewayRequest {
  trace_id: string;
  team_id?: string;
  channel: string;
  session_id: string;
  phone: string;
  language?: string | null;
  input?: { type?: string; text?: string; ussd_text?: string };
  constraints?: { max_chars?: number | null; charset?: string; mode?: string; timeout_ms?: number };
  bank_api?: { base_url?: string };
}

export type SafinumIntent =
  | 'BALANCE_INQUIRY'
  | 'TRANSFER'
  | 'FEE_INQUIRY'
  | 'TRANSACTION_HISTORY'
  | 'AIRTIME_PURCHASE'
  | 'BILL_PAYMENT'
  | 'CONFIRM'
  | 'CANCEL'
  | 'CORRECTION'
  | 'CLARIFICATION_NEEDED'
  | 'TERM_EXPLANATION'
  | 'LANGUAGE_SWITCH'
  | 'UNKNOWN';

export interface SafinumGatewayResponse {
  response: {
    text: string;
    end_session: boolean;
    options: string[];
  };
  interpretation: {
    intent: SafinumIntent;
    parameters: Record<string, string | number>;
    language: string;
  };
  transaction: {
    id: string | null;
    status: 'none' | 'pending' | 'confirmed' | 'cancelled' | 'failed';
  };
}

// Alphabet GSM-7 standard (1 septet) et table d'extension (2 septets : Escape + caractère).
const GSM7_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM7_EXT = new Set('^{}\\[~]|€');

const GSM7_REPLACEMENTS: Record<string, string> = {
  'ɛ': 'e', 'Ɛ': 'E',
  'ɔ': 'o', 'Ɔ': 'O',
  'ə': 'e', 'Ə': 'E',
  'ŋ': 'ng', 'Ŋ': 'Ng',
  'ɓ': 'b', 'Ɓ': 'B',
  'ɗ': 'd', 'Ɗ': 'D',
  'ƴ': 'y', 'Ƴ': 'Y',
  '’': "'", '‘': "'", '`': "'", 'ʼ': "'",
  '«': '"', '»': '"', '“': '"', '”': '"',
  '—': '-', '–': '-', '−': '-', '·': '-',
  '…': '...', ' ': ' ', ' ': ' ', '•': '*', '✓': 'OK',
  'à': 'à', 'â': 'a', 'á': 'a', 'À': 'A', 'Â': 'A', 'Á': 'A',
  'ê': 'e', 'ë': 'e', 'Ê': 'E', 'Ë': 'E', 'È': 'E',
  'î': 'i', 'ï': 'i', 'í': 'i', 'Î': 'I', 'Ï': 'I', 'Í': 'I',
  'ô': 'o', 'ó': 'o', 'Ô': 'O', 'Ó': 'O',
  'û': 'u', 'ú': 'u', 'Ù': 'U', 'Û': 'U', 'Ú': 'U',
  'œ': 'oe', 'Œ': 'OE', 'ç': 'ç',
};

/** Translittère un texte pour garantir qu'il reste 100 % dans l'alphabet GSM-7 (évite le basculement UCS-2 à 70 car.). */
export function toGsm7(input: string): string {
  let out = '';
  for (const ch of input.normalize('NFC')) {
    if (GSM7_BASIC.has(ch) || GSM7_EXT.has(ch)) { out += ch; continue; }
    if (GSM7_REPLACEMENTS[ch] !== undefined) { out += GSM7_REPLACEMENTS[ch]; continue; }
    const folded = ch.normalize('NFD').replace(/\p{M}+/gu, '');
    for (const f of folded) {
      if (GSM7_BASIC.has(f) || GSM7_EXT.has(f)) out += f;
      else if (GSM7_REPLACEMENTS[f] !== undefined) out += GSM7_REPLACEMENTS[f];
    }
  }
  return out;
}

/** Compte exactement les septets GSM-7 (les caractères de la table d'extension comptent pour 2). */
export function gsm7Septets(text: string): number {
  let n = 0;
  for (const ch of text) n += GSM7_EXT.has(ch) ? 2 : 1;
  return n;
}

/** Tronque proprement aux sauts de ligne / espaces pour rester ≤ maxSeptets. */
export function fitGsm7(text: string, maxSeptets: number): string {
  const safe = toGsm7(text);
  if (gsm7Septets(safe) <= maxSeptets) return safe;
  let out = '';
  let count = 0;
  for (const ch of safe) {
    const cost = GSM7_EXT.has(ch) ? 2 : 1;
    if (count + cost > maxSeptets) break;
    out += ch;
    count += cost;
  }
  return out.trimEnd();
}

const INTENT_MAP: Record<string, SafinumIntent> = {
  balance: 'BALANCE_INQUIRY',
  transfer: 'TRANSFER',
  fees: 'FEE_INQUIRY',
  history: 'TRANSACTION_HISTORY',
  airtime: 'AIRTIME_PURCHASE',
  bill_payment: 'BILL_PAYMENT',
  confirm: 'CONFIRM',
  cancel: 'CANCEL',
  correction: 'CORRECTION',
  explain_term: 'TERM_EXPLANATION',
  language_switch: 'LANGUAGE_SWITCH',
  choose: 'CLARIFICATION_NEEDED',
};

function mapSafinumIntent(r: EngineResult): SafinumIntent {
  if (r.status === 'needs_clarification') return 'CLARIFICATION_NEEDED';
  return (r.intent && INTENT_MAP[r.intent]) || 'UNKNOWN';
}

const VALID_CHANNELS = new Set<Channel>(['mobile', 'web', 'ussd', 'sms', 'ivr', 'atm', 'api']);
const LANG_ALIASES: Record<string, string> = { pcm: 'wes', pidgin: 'wes', kamtok: 'wes' };

export class SafinumChannel {
  private engine: Engine;
  private continuity: boolean;
  private gsm7Translit: boolean;

  constructor(engine: Engine, opts: { continuity?: boolean; gsm7Translit?: boolean } = {}) {
    this.engine = engine;
    this.continuity = opts.continuity ?? true;
    this.gsm7Translit = opts.gsm7Translit ?? (process.env.CT_SAFINUM_GSM7_TRANSLIT !== '0');
  }

  async handle(req: SafinumGatewayRequest): Promise<SafinumGatewayResponse> {
    const channel: Channel = VALID_CHANNELS.has(req.channel as Channel) ? (req.channel as Channel) : 'api';
    const userSid = this.continuity && req.phone ? userSession(req.phone) : null;
    const sessionId = userSid ?? `safinum:${req.session_id || req.phone || 'anon'}`;
    const accountId = req.phone?.trim() || 'demo';
    const rawText = (req.input?.text ?? '').trim();

    let lang: string | undefined = typeof req.language === 'string' && req.language.trim() ? req.language.trim().toLowerCase() : undefined;
    // Le pidgin camerounais a le code « wes » ; « pcm » (pidgin nigérian, code souvent employé) et « pidgin » y mènent aussi.
    if (lang && LANG_ALIASES[lang]) lang = LANG_ALIASES[lang];
    if (!lang && rawText) {
      const model = loadLangId();
      if (model) {
        const g = identify(rawText, model);
        if (g.lang) lang = g.lang;
      }
    }

    return runWithSafinumTrace({ traceId: req.trace_id, baseUrl: req.bank_api?.base_url }, async () => {
      const result = await this.engine.handle({
        sessionId,
        channel,
        lang,
        accountId,
        text: rawText || 'bonjour',
        input: req.input?.type === 'menu' ? 'dtmf' : req.input?.type === 'audio' ? 'voice' : 'text',
        institution: req.team_id ? `safinum:${req.team_id}` : 'safinum',
      });

      const intent = rawText ? mapSafinumIntent(result) : 'UNKNOWN';
      const options = (result.reply.menu ?? []).map((m) => `${m.key}. ${m.label}`);
      let text = result.reply.text;
      if (channel === 'ussd' && options.length && !options.every((o) => text.includes(o))) {
        text = `${text}\n${options.join('\n')}`;
      }

      const maxChars = req.constraints?.max_chars ?? (channel === 'ussd' ? 182 : null);
      const isGsm7 = req.constraints?.charset === 'gsm7' || channel === 'ussd';
      if (isGsm7 && this.gsm7Translit) {
        text = fitGsm7(text, maxChars ?? 182);
      } else if (maxChars && text.length > maxChars) {
        text = text.slice(0, maxChars).trimEnd();
      }

      const parameters: Record<string, string | number> = {};
      if (typeof result.params.amount === 'number') parameters.amount = result.params.amount;
      if (typeof result.params.fee === 'number') parameters.fee = result.params.fee;
      if (typeof result.params.total === 'number') parameters.total = result.params.total;
      if (parameters.amount !== undefined || typeof result.params.balance === 'number') parameters.currency = 'XAF';
      if (typeof result.params.balance === 'number') parameters.balance = result.params.balance;
      if (typeof result.params.beneficiary === 'string') parameters.beneficiary = result.params.beneficiary;
      if (typeof result.params.phone === 'string') parameters.phone = result.params.phone;
      if (typeof result.params.biller === 'string') parameters.biller = result.params.biller;
      if (typeof result.params.term === 'string') parameters.term = result.params.term;

      const pendingId = this.engine.activePendingTxId(sessionId);
      let transaction: SafinumGatewayResponse['transaction'] = { id: null, status: 'none' };
      if (result.status === 'executed' && result.transaction) {
        transaction = { id: result.transaction.id, status: 'confirmed' };
      } else if (pendingId && result.status === 'awaiting_confirmation') {
        transaction = { id: pendingId, status: 'pending' };
      } else if (result.status === 'cancelled') {
        transaction = { id: null, status: 'cancelled' };
      } else if (result.status === 'failed') {
        transaction = { id: null, status: 'failed' };
      }

      return {
        response: {
          text,
          end_session: false,
          options,
        },
        interpretation: {
          intent,
          parameters,
          language: result.lang,
        },
        transaction,
      };
    });
  }
}

