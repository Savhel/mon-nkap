// Adaptateur passerelle SAFINUM (`POST /safinum/middleware`).
// Traduit le format exact du bac à sable SAFINUM (trace_id, channel, phone, language, input, constraints)
// vers notre moteur commun `Engine` et gère les contraintes par canal (USSD GSM-7, SMS ≤ 3 segments, IVR audio/DTMF ≤ 400 car.).

import { userSession, type Channel, type Engine, type EngineResult } from '../core/engine.ts';
import { runWithSafinumTrace } from '../backend/safinum.ts';
import { identify, loadLangId } from '../linguistics/langid.ts';
import { nativeResponse, uiLabels } from '../core/respond.ts';
import { transcribe } from '../voice/speech.ts';

export interface SafinumGatewayAudio {
  format?: string;
  encoding?: string;
  sample_rate?: number;
  channels?: number;
  bits_per_sample?: number;
  duration_ms?: number;
  data?: string;
}

export interface SafinumGatewayRequest {
  trace_id: string;
  team_id?: string;
  channel: string;
  session_id?: string | null;
  phone: string;
  language?: string | null;
  input?: { type?: string; text?: string | null; ussd_text?: string | null; audio?: SafinumGatewayAudio | null };
  constraints?: {
    max_chars?: number | null;
    charset?: string;
    mode?: string;
    timeout_ms?: number;
    max_segments?: number;
    columns?: number;
    key_label_chars?: number;
  };
  bank_api?: { base_url?: string };
}

export type SafinumTranscriber = (audio: Uint8Array, lang?: string) => Promise<{ text: string }>;

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
  // Lettres du yemba, du medumba, du ghomala', du haoussa… qui disparaissaient sans équivalent (28 novembre).
  'ʉ': 'u', 'Ʉ': 'U', 'ɨ': 'i', 'Ɨ': 'I', 'ɑ': 'a', 'Ɑ': 'A', 'ƙ': 'k', 'Ƙ': 'K',
  'ɲ': 'ny', 'Ɲ': 'Ny', 'ɣ': 'gh', 'Ɣ': 'Gh', 'ʃ': 'sh', 'ʒ': 'zh', 'ʔ': "'", '→': '->', '≈': '~',
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
  // Couper après le dernier élément complet (« … ; 2 » laissait une opération tronquée dans l'historique).
  const cut = Math.max(out.lastIndexOf('\n'), out.lastIndexOf(' ; '), out.lastIndexOf('. ') + 1);
  return (cut > out.length * 0.5 ? out.slice(0, cut) : out).trimEnd();
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
const USSD_MAIN_MENU: { key: string; labelId: string; utterance: string }[] = [
  { key: '1', labelId: 'menu_balance', utterance: 'solde' },
  { key: '2', labelId: 'menu_transfer', utterance: 'envoyer de l’argent' },
  { key: '3', labelId: 'menu_fees', utterance: 'frais' },
  { key: '4', labelId: 'menu_history', utterance: 'historique' },
  { key: '5', labelId: 'menu_airtime', utterance: 'acheter du crédit' },
  { key: '6', labelId: 'menu_bill', utterance: 'payer une facture' },
];

/** Début de l'accueil vocal : la salutation écrite par un natif de la langue, sinon français ou anglais rédigés. */
function ivrIntro(lang: string): string {
  if (lang === 'en') return 'Welcome to Mon Nkap. Speak or press:';
  const native = lang !== 'fr' ? nativeResponse(lang, 'greeting') : null;
  return native ? `Mon Nkap. ${native.replace(/[\s.?!]*$/u, '')} ?` : 'Bienvenue sur Mon Nkap. Parlez ou tapez :';
}

function formatChannelText(text: string, maxChars: number | null, useGsm7: boolean): string {
  if (useGsm7) return fitGsm7(text, maxChars ?? 182);
  if (!maxChars || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const cut = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. ') + 1, slice.lastIndexOf(' '));
  return (cut > slice.length * 0.5 ? slice.slice(0, cut) : slice).trimEnd();
}

const smsAllowsUcs2 = (c: SafinumGatewayRequest['constraints']) => !c?.charset || c.charset === 'gsm7_ucs2' || c.charset === 'ucs2';

function resolveLimits(
  channel: Channel,
  constraints: SafinumGatewayRequest['constraints'],
  gsm7Translit: boolean,
): { maxChars: number | null; useGsm7: boolean } {
  if (channel === 'sms') {
    const maxSegments = Math.max(1, constraints?.max_segments ?? 3);
    const useGsm7 = gsm7Translit && (!constraints?.charset || constraints.charset === 'gsm7' || constraints.charset === 'gsm7_ucs2');
    const maxChars = useGsm7
      ? (maxSegments === 1 ? (constraints?.max_chars ?? 160) : maxSegments * 153)
      : (maxSegments === 1 ? 70 : maxSegments * 67);
    return { maxChars, useGsm7 };
  }
  if (channel === 'ussd') {
    return { maxChars: constraints?.max_chars ?? 182, useGsm7: gsm7Translit };
  }
  if (channel === 'ivr') {
    return { maxChars: constraints?.max_chars ?? 400, useGsm7: false };
  }
  return {
    maxChars: constraints?.max_chars ?? null,
    useGsm7: gsm7Translit && constraints?.charset === 'gsm7',
  };
}

export class SafinumChannel {
  private engine: Engine;
  private continuity: boolean;
  private gsm7Translit: boolean;
  private transcribeFn: SafinumTranscriber;

  constructor(engine: Engine, opts: { continuity?: boolean; gsm7Translit?: boolean; transcribeFn?: SafinumTranscriber } = {}) {
    this.engine = engine;
    this.continuity = opts.continuity ?? true;
    this.gsm7Translit = opts.gsm7Translit ?? (process.env.CT_SAFINUM_GSM7_TRANSLIT !== '0');
    this.transcribeFn = opts.transcribeFn ?? transcribe;
  }

  private welcomeResponse(channel: 'ussd' | 'ivr', lang: string, maxChars: number | null, useGsm7: boolean): SafinumGatewayResponse {
    const labels = uiLabels(lang);
    const items = USSD_MAIN_MENU.map((m) =>
      channel === 'ivr' ? `${m.key}, ${labels[m.labelId]?.text ?? m.utterance}` : `${m.key}. ${labels[m.labelId]?.text ?? m.utterance}`,
    );
    const hint = labels.menu_free_text?.text ?? 'Ou ecrivez votre demande';
    const raw = channel === 'ivr'
      ? `${ivrIntro(lang)} ${items.join(' ; ')}.`
      : `Mon Nkap\n${items.join('\n')}\n${hint}`;
    return {
      response: {
        text: formatChannelText(raw, maxChars, useGsm7),
        end_session: false,
        options: USSD_MAIN_MENU.map((m) => labels[m.labelId]?.text ?? m.utterance),
      },
      interpretation: { intent: 'UNKNOWN', parameters: {}, language: lang },
      transaction: { id: null, status: 'none' },
    };
  }

  private voiceClarification(lang: string, maxChars: number | null): SafinumGatewayResponse {
    const labels = uiLabels(lang);
    const native = lang !== 'fr' && lang !== 'en' ? nativeResponse(lang, 'not_understood') : null;
    const menu = USSD_MAIN_MENU.slice(0, 4).map((m) => `${m.key}, ${labels[m.labelId]?.text ?? m.utterance}`).join(' ; ');
    const msg = native
      ? `${native} ${menu}.`
      : lang === 'en'
        ? 'Sorry, I could not hear your request clearly. Please repeat, or press 1 for balance, 2 for transfer, 3 for fees, 4 for history.'
        : "Je n'ai pas compris votre message vocal. Veuillez répéter ou taper 1 pour le solde, 2 pour un transfert, 3 pour les frais, 4 pour l'historique.";
    return {
      response: {
        text: formatChannelText(msg, maxChars ?? 400, false),
        end_session: false,
        options: USSD_MAIN_MENU.map((m) => labels[m.labelId]?.text ?? m.utterance),
      },
      interpretation: { intent: 'CLARIFICATION_NEEDED', parameters: {}, language: lang },
      transaction: { id: null, status: 'none' },
    };
  }

  private async resolveAudioText(audio: SafinumGatewayAudio | null | undefined, lang: string | undefined): Promise<string | null> {
    const rawB64 = typeof audio?.data === 'string' ? audio.data.trim() : '';
    if (!rawB64) return null;
    const cleanB64 = rawB64.replace(/^data:audio\/[^;]+;base64,/, '');
    const bytes = new Uint8Array(Buffer.from(cleanB64, 'base64'));
    if (bytes.length === 0) return null;
    try {
      const tr = await this.transcribeFn(bytes, lang);
      const txt = tr?.text?.trim().slice(0, 1000) ?? '';
      return txt || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`SAFINUM IVR transcription indisponible : ${msg}`);
      return null;
    }
  }

  async handle(req: SafinumGatewayRequest): Promise<SafinumGatewayResponse> {
    const channel: Channel = VALID_CHANNELS.has(req.channel as Channel) ? (req.channel as Channel) : 'api';
    const userSid = this.continuity && req.phone ? userSession(req.phone) : null;
    const sessionId = userSid ?? `safinum:${req.session_id || req.phone || 'anon'}`;
    const accountId = req.phone?.trim() || 'demo';
    const institution = 'safinum'; // Une instance utilise une seule clé d’équipe configurée sur le serveur.

    let lang: string | undefined = typeof req.language === 'string' && req.language.trim() ? req.language.trim().toLowerCase() : undefined;
    // Le pidgin camerounais a le code « wes » ; « pcm » (pidgin nigérian, code souvent employé) et « pidgin » y mènent aussi.
    if (lang && LANG_ALIASES[lang]) lang = LANG_ALIASES[lang];

    const { maxChars, useGsm7 } = resolveLimits(channel, req.constraints, this.gsm7Translit);
    const isAudioRequest = req.input?.type === 'audio';
    const rawInput = req.input?.text ?? req.input?.ussd_text;
    let rawText = typeof rawInput === 'string' ? rawInput.trim().slice(0, 1000) : '';

    if (isAudioRequest && !rawText) {
      const spoken = await this.resolveAudioText(req.input?.audio, lang);
      if (!spoken) return this.voiceClarification(lang ?? 'fr', maxChars);
      rawText = spoken;
    }

    if (!lang && rawText) {
      const model = loadLangId();
      if (model) {
        const g = identify(rawText, model);
        if (g.lang) lang = g.lang;
      }
    }

    if ((channel === 'ussd' || channel === 'ivr') && !rawText && !isAudioRequest && !this.engine.hasPending(sessionId, institution)) {
      return this.welcomeResponse(channel, lang ?? 'fr', maxChars, useGsm7);
    }

    const menuChoice = (channel === 'ussd' || channel === 'ivr') && !this.engine.hasPending(sessionId, institution)
      ? USSD_MAIN_MENU.find((m) => m.key === rawText)
      : undefined;
    const effectiveText = menuChoice ? menuChoice.utterance : rawText;

    return runWithSafinumTrace({ traceId: req.trace_id }, async () => {
      const result = await this.engine.handle({
        sessionId,
        channel,
        lang,
        accountId,
        text: effectiveText || 'bonjour',
        input: menuChoice || req.input?.type === 'menu' || req.input?.type === 'dtmf' ? 'dtmf' : isAudioRequest ? 'voice' : 'text',
        institution,
      });

      const intent = effectiveText ? mapSafinumIntent(result) : 'UNKNOWN';
      // Le simulateur numérote lui-même les options : on lui donne les libellés seuls (sinon « 1. 1. Confirmer »).
      // Les écrans texte (USSD et SMS), eux, gardent les choix numérotés dans le message.
      const menu = result.reply.menu ?? [];
      const options = menu.map((m) => m.label);
      const menuLines = menu.map((m) => `${m.key}. ${m.label}`);
      let text = result.reply.text;
      if ((channel === 'ussd' || channel === 'sms') && menuLines.length && !menuLines.every((o) => text.includes(o))) {
        text = `${text}\n${menuLines.join('\n')}`;
      }

      // SMS en « gsm7_ucs2 » : un texte qui porte des lettres propres à la langue (ɓ, ŋ, ɛ, tons…) part en UCS-2, intact,
      // dans la limite de 67 caractères par segment ; un texte déjà en GSM-7 garde les 153 caractères par segment.
      const lettersLost = (t: string) => [...t.normalize('NFC')].some((ch) => /[\p{L}\p{M}]/u.test(ch) && toGsm7(ch) !== ch);
      if (channel === 'sms' && useGsm7 && smsAllowsUcs2(req.constraints) && lang && lang !== 'fr' && lang !== 'en' && lettersLost(text)) {
        text = formatChannelText(text.normalize('NFC'), Math.max(1, req.constraints?.max_segments ?? 3) * 67, false);
      } else {
        text = formatChannelText(text, maxChars, useGsm7);
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

      const pendingId = this.engine.activePendingTxId(sessionId, institution);
      let transaction: SafinumGatewayResponse['transaction'] = { id: null, status: 'none' };
      if (result.status === 'executed' && result.transaction) {
        transaction = { id: result.transaction.id, status: 'confirmed' };
      } else if (pendingId && (result.status === 'awaiting_confirmation' || result.status === 'pending_reconciliation')) {
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
        // Pour la voix du serveur vocal (retiré avant l'envoi) : clips de natifs prévus et qualité de la réponse.
        _voice: { plan: result.reply.speech ?? [], quality: result.reply.quality },
      } as SafinumGatewayResponse;
    });
  }
}

