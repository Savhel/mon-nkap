// Collecte en ligne auprès des locuteurs natifs, sur invitation seulement.
//
// Garde-fous contre les fausses données :
// - accès par code d'invitation personnel, créé par l'administrateur, limité à UNE langue, révocable ;
// - aucun nom : chaque contributeur est un pseudonyme (« c-4f9a2b ») tiré au hasard ;
// - tout envoi arrive dans une file d'attente hors du dépôt Git (data/collecte/), jamais directement
//   dans les tableurs ni dans les packs ;
// - l'administrateur accepte ou rejette chaque envoi. Une contribution acceptée entre dans le tableur
//   en BROUILLON : elle ne devient « validée » qu'après la relecture d'un second natif (isValidated).
// Le texte est conservé tel qu'écrit (accents et tons compris).

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONCEPTS, DEFINITIONS, NUMBER_TARGETS, RESPONSES, SITUATIONS, TRACE_COLUMNS } from './collection.ts';
import { parseCsv, writeCsv } from './csv.ts';

export const COLLECTE_INBOX = fileURLToPath(new URL('../../data/collecte/', import.meta.url));
const COLLECTE_SHEETS = fileURLToPath(new URL('../../collecte/', import.meta.url));
const AUDIO_DIR = fileURLToPath(new URL('../../data/audio/', import.meta.url));

export type Section = 'demandes' | 'reponses' | 'definitions' | 'nombres' | 'lexique' | 'interface';
export const SECTIONS: Section[] = ['demandes', 'reponses', 'definitions', 'nombres', 'lexique', 'interface'];
const UI_DIR = () => process.env.CT_UI_DIR ?? fileURLToPath(new URL('../../data/ui/', import.meta.url));

export interface Task { section: Section; item: string; consigne: string; exemple?: string; reperes?: string[] }

const fmt = (n: number) => n.toLocaleString('fr-FR').replace(/ /g, ' ');

/** Ce qu'on demande aux natifs, tiré du catalogue unique (src/linguistics/collection.ts). */
export function tasks(): Task[] {
  return [
    ...SITUATIONS.map((s) => ({ section: 'demandes' as const, item: s.id, consigne: s.situation })),
    ...RESPONSES.map((r) => ({ section: 'reponses' as const, item: r.id, consigne: 'Comment le service dirait-il ceci dans votre langue ?', exemple: r.fr, reperes: r.placeholders.map((p) => `{${p}}`) })),
    ...DEFINITIONS.map((d) => ({ section: 'definitions' as const, item: d.id, consigne: 'Expliquez ce mot simplement, dans votre langue.', exemple: d.fr })),
    ...NUMBER_TARGETS.map((n) => ({ section: 'nombres' as const, item: String(n), consigne: `Comment dit-on ${fmt(n)} (en francs) ?`, exemple: fmt(n) })),
    ...CONCEPTS.map((c) => ({ section: 'lexique' as const, item: c.id, consigne: `Le mot ou l’expression pour « ${c.fr} »${c.hint ? ` (${c.hint})` : ''}.` })),
    ...interfaceTasks(),
  ];
}
/** Textes de l'application du bac à sable SAFINUM (captés par le middleware) : boutons, titres, messages. */
function interfaceTasks(): Task[] {
  let source: Record<string, { text: string; context?: string; max_chars?: number | null }> = {};
  try { source = JSON.parse(readFileSync(join(UI_DIR(), 'safinum-source.json'), 'utf8')); } catch { return []; }
  return Object.entries(source).sort(([a], [b]) => a.localeCompare(b)).map(([key, s]) => ({
    section: 'interface' as const, item: key,
    consigne: `Texte de l’application bancaire (${s.context ?? 'écran'})${s.max_chars ? `, ${s.max_chars} caractères au plus` : ''}.`,
    exemple: s.text, reperes: s.text.match(/\{[A-Za-z0-9_]+\}/g) ?? [],
  }));
}
export const findTask = (section: string, item: string) => tasks().find((t) => t.section === section && t.item === item);

// ---------------------------------------------------------------- invitations

export interface Invitation { id: string; lang: string; hash: string; createdAt: string; revokedAt?: string }
export interface InvitationPublic { id: string; lang: string; createdAt: string; active: boolean }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// Sans 0/O, 1/I/L : le code se dicte au téléphone ou se recopie d'un message sans erreur.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const canonicalCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export class Contributions {
  readonly root: string;
  private sheetsDir: string;
  private audioDir: string;
  private uiDir: string;
  constructor(opts: { root?: string; sheetsDir?: string; audioDir?: string; uiDir?: string } = {}) {
    this.root = opts.root ?? process.env.CT_COLLECTE_DIR ?? COLLECTE_INBOX;
    this.sheetsDir = opts.sheetsDir ?? COLLECTE_SHEETS;
    this.audioDir = opts.audioDir ?? AUDIO_DIR;
    this.uiDir = opts.uiDir ?? UI_DIR();
  }

  private get invitationsFile() { return join(this.root, 'invitations.json'); }
  private invitations(): Invitation[] {
    if (!existsSync(this.invitationsFile)) return [];
    const data = JSON.parse(readFileSync(this.invitationsFile, 'utf8')) as { invitations?: Invitation[] };
    return Array.isArray(data.invitations) ? data.invitations : [];
  }
  private saveInvitations(list: Invitation[]) {
    mkdirSync(this.root, { recursive: true });
    writeFileSync(this.invitationsFile, JSON.stringify({ version: 1, invitations: list }, null, 2) + '\n', { mode: 0o600 });
  }

  /** Crée une invitation pour une langue. Le code n'est montré qu'une fois : seule son empreinte est gardée. */
  invite(lang: string): { code: string; invitation: InvitationPublic } {
    if (!/^[a-z]{2,3}$/.test(lang)) throw fail('Code langue invalide', 400);
    const code = newCode();
    const inv: Invitation = { id: `c-${randomBytes(3).toString('hex')}`, lang, hash: sha256(canonicalCode(code)), createdAt: new Date().toISOString() };
    this.saveInvitations([...this.invitations(), inv]);
    return { code, invitation: this.toPublic(inv) };
  }

  revoke(id: string): boolean {
    const list = this.invitations();
    const inv = list.find((x) => x.id === id && !x.revokedAt);
    if (!inv) return false;
    inv.revokedAt = new Date().toISOString();
    this.saveInvitations(list);
    return true;
  }

  listInvitations(): InvitationPublic[] { return this.invitations().map((x) => this.toPublic(x)); }
  private toPublic(x: Invitation): InvitationPublic { return { id: x.id, lang: x.lang, createdAt: x.createdAt, active: !x.revokedAt }; }

  /** Invitation active correspondant au code, ou null (comparaison à temps constant). */
  check(code: string | undefined): Invitation | null {
    if (!code || code.length > 40) return null;
    const candidate = Buffer.from(sha256(canonicalCode(code)), 'hex');
    for (const inv of this.invitations()) {
      if (inv.revokedAt) continue;
      if (timingSafeEqual(Buffer.from(inv.hash, 'hex'), candidate)) return inv;
    }
    return null;
  }

  // -------------------------------------------------------------- file d'attente

  private inboxFile(lang: string) { return join(this.root, lang, 'contributions.jsonl'); }

  list(lang: string): Contribution[] {
    if (!/^[a-z]{2,3}$/.test(lang) || !existsSync(this.inboxFile(lang))) return [];
    const byId = new Map<string, Contribution>();
    // Journal en ajout seul : la dernière ligne d'un identifiant donne son état (envoi, puis décision).
    for (const line of readFileSync(this.inboxFile(lang), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as Contribution;
      byId.set(entry.id, { ...byId.get(entry.id), ...entry });
    }
    return [...byId.values()];
  }

  languages(): string[] {
    return [...new Set(this.invitations().map((x) => x.lang))].sort();
  }

  /** Enregistre un envoi. L'audio a déjà été vérifié (décodable, durée) par l'appelant. */
  submit(inv: Invitation, input: { section: string; item: string; texte?: string; consent: boolean; audio?: { bytes: Uint8Array; ext: string; seconds: number } }): Contribution {
    const task = findTask(input.section, input.item);
    if (!task) throw fail('Élément de collecte inconnu.', 400);
    if (input.consent !== true) throw fail('Le consentement est nécessaire pour envoyer.', 400);
    const texte = (input.texte ?? '').normalize('NFC').trim();
    if (texte.length > 500) throw fail('Texte trop long (500 caractères au plus).', 400);
    if (!texte && !input.audio) throw fail('Écrivez la phrase ou enregistrez-la.', 400);
    const missing = texte ? (task.reperes ?? []).filter((r) => !texte.includes(r)) : [];
    if (missing.length) throw fail(`Gardez les repères tels quels : ${missing.join(' ')}`, 400);
    if (this.list(inv.lang).filter((c) => c.contributeur === inv.id).length >= 2000) throw fail('Limite d’envois atteinte pour cette invitation.', 429);

    const id = randomUUID();
    let audio: string | undefined;
    if (input.audio) {
      audio = `${id}.${input.audio.ext}`;
      mkdirSync(join(this.root, inv.lang, 'audio'), { recursive: true });
      writeFileSync(join(this.root, inv.lang, 'audio', audio), input.audio.bytes);
    }
    const entry: Contribution = {
      id, at: new Date().toISOString(), lang: inv.lang, contributeur: inv.id, section: task.section, item: task.item,
      texte, ...(audio ? { audio, secondes: input.audio!.seconds } : {}), consentement: true, statut: 'en_attente',
    };
    this.append(inv.lang, entry);
    return entry;
  }

  private append(lang: string, entry: Partial<Contribution> & { id: string }) {
    mkdirSync(dirname(this.inboxFile(lang)), { recursive: true });
    appendFileSync(this.inboxFile(lang), JSON.stringify(entry) + '\n');
  }

  audioPath(lang: string, id: string): string | null {
    const c = this.list(lang).find((x) => x.id === id);
    return c?.audio ? join(this.root, lang, 'audio', c.audio) : null;
  }

  /**
   * Décision de l'administrateur. « accepte » recopie le texte dans le tableur de la langue en brouillon
   * (auteur = pseudonyme, relecteur vide) ; l'audio d'une demande rejoint le jeu de test vocal.
   */
  review(lang: string, id: string, decision: 'accepte' | 'rejete'): Contribution {
    const c = this.list(lang).find((x) => x.id === id);
    if (!c) throw fail('Contribution introuvable.', 404);
    if (c.statut !== 'en_attente') throw fail('Contribution déjà traitée.', 409);
    const decided = { id, statut: decision, decideLe: new Date().toISOString() } as const;
    if (decision === 'accepte') {
      if (c.texte && c.section === 'interface') this.addToInterface(c);
      else if (c.texte) this.addToSheet(c);
      if (c.audio && c.section === 'demandes') this.addToVoiceTests(c);
    }
    this.append(lang, decided);
    return { ...c, ...decided };
  }

  private addToSheet(c: Contribution) {
    const task = findTask(c.section, c.item)!;
    const file = join(this.sheetsDir, c.lang, `${c.section}.csv`);
    const trace = { auteur: c.contributeur, relecteur: '', statut: '', commentaire: `collecte en ligne ${c.at.slice(0, 10)}` };
    const fresh: Record<Exclude<Section, 'interface'>, { header: string[]; row: Record<string, string> }> = {
      demandes: { header: ['situation_id', 'intention', 'situation', 'phrase'], row: { situation_id: c.item, intention: SITUATIONS.find((s) => s.id === c.item)!.intent, situation: task.consigne, phrase: c.texte } },
      reponses: { header: ['id', 'en_francais', 'reperes_a_garder', 'votre_phrase'], row: { id: c.item, en_francais: task.exemple ?? '', reperes_a_garder: (task.reperes ?? []).join(' '), votre_phrase: c.texte } },
      definitions: { header: ['id', 'en_francais', 'votre_explication'], row: { id: c.item, en_francais: task.exemple ?? '', votre_explication: c.texte } },
      nombres: { header: ['valeur', 'en_chiffres', 'comment_on_le_dit', 'autre_facon'], row: { valeur: c.item, en_chiffres: task.exemple ?? '', comment_on_le_dit: c.texte, autre_facon: '' } },
      lexique: { header: ['id', 'en_francais', 'precision', 'mot_ou_expression', 'variantes'], row: { id: c.item, en_francais: CONCEPTS.find((x) => x.id === c.item)?.fr ?? '', precision: '', mot_ou_expression: c.texte, variantes: '' } },
    };
    const spec = fresh[c.section as Exclude<Section, 'interface'>];
    const row: Record<string, string> = { ...spec.row, ...trace };
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) {
      const header = [...spec.header, ...TRACE_COLUMNS];
      writeFileSync(file, writeCsv(header, [header.map((h) => row[h] ?? '')]));
      return;
    }
    // Ajout en fin de fichier : les lignes déjà écrites par les natifs ne sont jamais réécrites.
    const text = readFileSync(file, 'utf8');
    const firstLine = text.replace(/^﻿/, '').split(/\r?\n/)[0];
    const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
    const header = Object.keys(parseCsv(`${firstLine}\nx`)[0] ?? {});
    const line = header.map((h) => `"${(row[h] ?? '').replace(/"/g, '""')}"`).join(sep);
    appendFileSync(file, (text.endsWith('\n') ? '' : '\n') + line + '\n');
  }

  /** Texte d'écran accepté : rejoint le catalogue de la traduction d'écrans SAFINUM, en brouillon. */
  private addToInterface(c: Contribution) {
    const file = join(this.uiDir, `safinum-${c.lang}.json`);
    let cat: Record<string, unknown> = {};
    try { cat = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier texte de cette langue */ }
    cat[c.item] = { text: c.texte, fr: findTask('interface', c.item)?.exemple ?? '', auteur: c.contributeur, valide: false };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cat, null, 1) + '\n');
  }

  private addToVoiceTests(c: Contribution) {
    const dir = join(this.audioDir, c.lang, 'demandes');
    mkdirSync(dir, { recursive: true });
    const ext = c.audio!.split('.').pop();
    const name = `${c.item}_w${c.id.slice(0, 8)}.${ext}`;
    copyFileSync(join(this.root, c.lang, 'audio', c.audio!), join(dir, name));
    const labels = join(dir, 'labels.csv');
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    if (!existsSync(labels)) writeFileSync(labels, 'fichier,fichier_d_origine,situation_id,intention,texte_natif,commentaire\n');
    const intent = SITUATIONS.find((s) => s.id === c.item)!.intent;
    appendFileSync(labels, [name, `collecte en ligne ${c.id}`, c.item, intent, c.texte, `contributeur ${c.contributeur}`].map(esc).join(',') + '\n');
  }
}

export interface Contribution {
  id: string; at: string; lang: string; contributeur: string; section: Section; item: string; texte: string;
  audio?: string; secondes?: number; consentement: true; statut: 'en_attente' | 'accepte' | 'rejete'; decideLe?: string;
}
