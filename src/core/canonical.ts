// Représentation financière canonique (cmfi.v1) : ce que le moteur a compris, indépendamment de la langue
// et du canal. Une même demande donne la même représentation en ewondo par USSD ou en duala sur mobile.
// C'est ce contrat qu'une institution financière consomme ; la langue n'y apparaît que comme métadonnée.

import type { Transaction } from '../backend/types.ts';
import { ENGINE_TO_CANONICAL } from '../linguistics/runtime.ts';

export interface CanonicalRequest {
  schema: 'cmfi.v1';
  language: string;
  channel: string;
  /** Opération financière concernée (même lors d'une confirmation ou d'une correction). */
  operation: string | null;
  /** Acte de dialogue de ce tour : nouvelle demande, confirmation, annulation, correction… */
  act: 'REQUEST' | 'CONFIRM' | 'CANCEL' | 'CORRECT' | 'CHOOSE_OPTION' | 'SWITCH_LANGUAGE' | 'UNKNOWN';
  entities: {
    amount?: number; currency?: 'XAF'; fee?: number; total?: number;
    beneficiary?: { name?: string; phone?: string };
    biller?: string; term?: string; reference?: string;
  };
  confidence: number;
  requiresClarification: boolean;
  requiresConfirmation: boolean;
  /** Jeton à renvoyer à POST /v1/confirm pour exécuter (présent seulement quand une confirmation est attendue). */
  confirmationToken?: string;
  status: string;
  evidence: string[];
  resources: Record<string, string>;
}

const TX_OPERATION: Record<Transaction['type'], string> = { transfer_out: 'TRANSFER_MONEY', transfer_in: 'TRANSFER_MONEY', airtime: 'BUY_AIRTIME', bill: 'PAY_BILL', deposit: 'DEPOSIT', withdrawal: 'WITHDRAW_MONEY' };
const ACTS: Record<string, CanonicalRequest['act']> = { confirm: 'CONFIRM', cancel: 'CANCEL', correction: 'CORRECT', choose: 'CHOOSE_OPTION', language_switch: 'SWITCH_LANGUAGE' };

export function toCanonical(r: {
  lang: string; channel: string; intent: string | null; status: string; params: Record<string, string | number>;
  transaction?: Transaction; confidence: number; evidence: string[]; operation?: string | null; resources?: Record<string, string>; confirmationToken?: string;
}): CanonicalRequest {
  const p = r.params;
  const act: CanonicalRequest['act'] = r.intent ? ACTS[r.intent] ?? 'REQUEST' : 'UNKNOWN';
  const operation = r.transaction ? TX_OPERATION[r.transaction.type] : act === 'REQUEST' ? ENGINE_TO_CANONICAL[r.intent ?? ''] ?? null : r.operation ?? null;
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : undefined);
  const str = (k: string) => (p[k] !== undefined && p[k] !== '' ? String(p[k]) : undefined);
  const beneficiary = str('beneficiary') || str('phone') ? { name: str('beneficiary'), phone: str('phone') } : undefined;
  const entities: CanonicalRequest['entities'] = {
    amount: num('amount'), currency: num('amount') !== undefined ? 'XAF' : undefined, fee: num('fee'), total: num('total'),
    beneficiary, biller: str('biller'), term: str('term'), reference: str('reference'),
  };
  for (const k of Object.keys(entities) as (keyof typeof entities)[]) if (entities[k] === undefined) delete entities[k];
  return {
    schema: 'cmfi.v1', language: r.lang, channel: r.channel, operation, act, entities,
    confidence: r.confidence, requiresClarification: r.status === 'needs_clarification', requiresConfirmation: r.status === 'awaiting_confirmation',
    ...(r.status === 'awaiting_confirmation' && r.confirmationToken ? { confirmationToken: r.confirmationToken } : {}),
    status: r.status, evidence: r.evidence, resources: r.resources ?? {},
  };
}
