// Journal d'audit en ajout seul, chaîné : chaque événement contient l'empreinte SHA-256 du précédent.
// Modifier ou supprimer une ligne casse la chaîne, ce que `verifyChain` détecte.
// Les numéros de téléphone sont masqués (6XXXXXX99) : le journal sert à l'audit, pas à exposer des données.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEvent {
  at: string;              // ISO 8601
  institution: string;     // identifiant de l'institution (jamais la clé d'API elle-même)
  sessionId: string;
  channel: string;
  language: string;
  operation: string | null;
  act: string;
  status: string;
  amount?: number;
  fee?: number;
  beneficiary?: string;
  reference?: string;
  prev: string;            // empreinte de l'événement précédent
  hash: string;            // empreinte de cet événement (calculée sans le champ hash)
}

export const maskPhone = (s: string) => s.replace(/\b([62])\d{6}(\d{2})\b/g, '$1XXXXXX$2');

export class AuditLog {
  private last = 'GENESIS';
  readonly events: AuditEvent[] = [];
  private file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      if (existsSync(file)) {
        const tail = readFileSync(file, 'utf8').split('\n').filter(Boolean).at(-1);
        if (tail) this.last = (JSON.parse(tail) as AuditEvent).hash;
      }
    }
  }

  append(e: Omit<AuditEvent, 'prev' | 'hash' | 'at'> & { at?: string }): AuditEvent {
    const base = { ...e, at: e.at ?? new Date().toISOString(), beneficiary: e.beneficiary ? maskPhone(e.beneficiary) : undefined, prev: this.last };
    const hash = createHash('sha256').update(JSON.stringify(base)).digest('hex');
    const ev: AuditEvent = { ...base, hash };
    this.last = hash;
    this.events.push(ev);
    if (this.events.length > 5000) this.events.shift();
    if (this.file) appendFileSync(this.file, JSON.stringify(ev) + '\n');
    return ev;
  }
}

/** Vérifie la chaîne d'un ensemble d'événements. Renvoie l'index du premier événement altéré, ou -1. */
export function verifyChain(events: AuditEvent[]): number {
  let prev = events[0]?.prev ?? 'GENESIS';
  for (let i = 0; i < events.length; i++) {
    const { hash, ...base } = events[i];
    if (base.prev !== prev || createHash('sha256').update(JSON.stringify(base)).digest('hex') !== hash) return i;
    prev = hash;
  }
  return -1;
}
