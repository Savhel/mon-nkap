// Voix du serveur vocal SAFINUM (`response.audio`) : au lieu de laisser leur synthèse lire notre texte, on leur donne
// une liste de morceaux joués dans l'ordre (20 au plus) :
//   1. la réponse entière dite par une native, si chaque morceau est enregistré ;
//   2. sinon le texte dit par une voix naturelle (PlotWeaver), sans aucun chiffre, et les montants dits avec les
//      nombres enregistrés par les natives quand ils existent, sinon par leur synthèse (`{ "say": "5 000 FCFA" }`).
// Les fichiers sont servis par notre adresse déclarée (/voix/…), en mp3 comme le demande SAFINUM.
// `response.text` reste la référence : SAFINUM le lit si un fichier ne se charge pas.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { amountClips, clipFile, hasNativeVoice } from '../voice/native.ts';
import { plotweaverLanguage, plotweaverSpeech } from '../voice/plotweaver.ts';

export type AudioPiece = { url: string } | { say: string };
const MAX_PIECES = 20;
const segments = new Map<string, { lang: string; text: string; at: number; audio?: Promise<Buffer | null> }>();

/** Convertit n'importe quel audio en mp3 (ffmpeg), ou null. */
function toMp3(input: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const p = execFile('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '22050', '-b:a', '64k', '-f', 'mp3', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 10000 }, (err, out) => resolve(err || !out?.length ? null : out as Buffer));
    p.stdin?.end(input);
  });
}

const clipCache = new Map<string, Promise<Buffer | null>>();
/** Enregistrement d'une native, en mp3. */
export function clipMp3(lang: string, key: string): Promise<Buffer | null> {
  const f = /^[a-z]{2,3}$/.test(lang) && /^[a-z0-9_]+$/.test(key) ? clipFile(lang, key) : null;
  if (!f) return Promise.resolve(null);
  let p = clipCache.get(f);
  if (!p) { p = readFile(f).then((b) => (f.endsWith('.mp3') ? b : toMp3(b))).catch(() => null); clipCache.set(f, p); }
  return p;
}

/** Morceau de texte dit par la voix naturelle, en mp3 (préparé dès la réponse, servi à la demande). */
export function segmentMp3(id: string): Promise<Buffer | null> {
  const s = segments.get(id);
  if (!s) return Promise.resolve(null);
  s.audio ??= plotweaverSpeech(s.lang, s.text).then((r) => (!r ? null : r.mime === 'audio/mpeg' ? r.audio : toMp3(r.audio))).catch(() => null)
    .then((b) => { if (!b) s.audio = undefined; return b; }); // échec : on retentera à la prochaine demande
  return s.audio;
}

/** Même langue et même phrase → même fichier : une phrase déjà dite est resservie sans attendre la synthèse. */
function newSegment(lang: string, text: string): string {
  const now = Date.now();
  const clean = text.replace(/\s+/g, ' ').trim();
  const id = createHash('sha256').update(`${lang}\u0000${clean}`).digest('base64url').slice(0, 16);
  const hit = segments.get(id);
  if (hit) { hit.at = now; return id; }
  if (segments.size > 500) for (const [k, v] of segments) if (now - v.at > 6 * 3600_000) segments.delete(k);
  segments.set(id, { lang, text: clean, at: now });
  void segmentMp3(id); // la synthèse commence tout de suite : le fichier est prêt quand SAFINUM le demande
  return id;
}

const AMOUNT = /\d[\d\s  .]*\d(?:\s*(?:FCFA|XAF|F)\b)?|\d(?:\s*(?:FCFA|XAF|F)\b)?/g;

/** Montant dit avec les nombres enregistrés par les natives ; sinon par la synthèse de SAFINUM. */
function amountPieces(lang: string, raw: string, base: string): AudioPiece[] {
  const digits = raw.replace(/\D/g, '');
  const isMoney = /FCFA|XAF|F\b/.test(raw);
  const n = Number(digits);
  if (isMoney && digits.length <= 6 && n > 0) {
    const keys = amountClips(n).filter((k) => k !== 'fcfa' && k !== 'n_unsupported');
    const words = keys.filter((k) => !k.startsWith('?')).every((k) => clipFile(lang, k));
    if (keys.length && words) {
      const out: AudioPiece[] = keys.filter((k) => !k.startsWith('?') || clipFile(lang, k.slice(1)))
        .map((k) => ({ url: `${base}/voix/${lang}/${k.replace(/^\?/, '')}.mp3` }));
      out.push(clipFile(lang, 'fcfa') ? { url: `${base}/voix/${lang}/fcfa.mp3` } : { say: 'FCFA' });
      return out;
    }
  }
  return [{ say: raw.trim() }];
}

/**
 * Morceaux audio pour une réponse du serveur vocal, ou undefined (SAFINUM lit alors `response.text`).
 * `base` : notre adresse publique déclarée (schéma + hôte), sans barre finale.
 */
export function ivrAudio(lang: string, text: string, base: string, voice?: { plan?: string[]; quality?: string }): AudioPiece[] | undefined {
  if (!base || !lang || lang === 'fr' || lang === 'en' || process.env.CT_IVR_AUDIO === '0') return undefined;
  if (voice?.quality === 'fallback') return undefined; // texte resté en français : pas de voix de la langue dessus
  const plan = (voice?.plan ?? []).filter((k) => !k.startsWith('?') || clipFile(lang, k.slice(1))).map((k) => k.replace(/^\?/, ''));
  if (plan.length && plan.length <= MAX_PIECES && hasNativeVoice(lang, plan)) {
    return plan.map((k) => ({ url: `${base}/voix/${lang}/${k}.mp3` }));
  }
  if (!plotweaverLanguage(lang)) return undefined;
  const pieces: AudioPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(last, m.index);
    if (/\p{L}{2,}/u.test(before)) pieces.push({ url: `${base}/voix/tts/${newSegment(lang, before)}.mp3` });
    pieces.push(...amountPieces(lang, m[0], base));
    last = m.index! + m[0].length;
  }
  const rest = text.slice(last);
  if (/\p{L}{2,}/u.test(rest)) pieces.push({ url: `${base}/voix/tts/${newSegment(lang, rest)}.mp3` });
  return pieces.length && pieces.length <= MAX_PIECES ? pieces : undefined;
}

/** Prépare à l'avance la voix des phrases fixes (accueil, « pas compris »…) : resservies sans attente ensuite. */
export function prewarm(lang: string, texts: string[]): number {
  if (!plotweaverLanguage(lang)) return 0;
  let n = 0;
  for (const t of texts) if (t && ivrAudio(lang, t, 'http://prewarm')) n++;
  return n;
}
