// Voix entrante (ASR) et sortante (TTS), via Sherpa-ONNX, entièrement hors ligne.
//
// ASR : Meta Omnilingual ASR (CTC, Apache-2.0). Le modèle CTC ne prend pas de code langue :
// il transcrit ce qu'il entend, dans n'importe laquelle de ses 1 600+ langues.
// TTS : Piper pour fr/en uniquement. Aucune voix de synthèse n'existe pour les langues nationales
// du catalogue : on ne lit JAMAIS une langue nationale avec une voix française.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const execFileP = promisify(execFile);
const MODELS = fileURLToPath(new URL('../../models/', import.meta.url));

interface Wave { samples: Float32Array; sampleRate: number }
// Types minimaux du binding natif (sherpa-onnx-node n'expose pas de types TypeScript).
interface SherpaStream { acceptWaveform(w: Wave): void }
interface SherpaRecognizer { createStream(): SherpaStream; decode(s: SherpaStream): void; getResult(s: SherpaStream): { text: string } }
interface SherpaTts { generate(o: { text: string; sid: number; speed: number }): Wave }
interface Sherpa {
  OfflineRecognizer: new (cfg: object) => SherpaRecognizer;
  OfflineTts: new (cfg: object) => SherpaTts;
}
let sherpa: Sherpa | null = null;
function so(): Sherpa { return (sherpa ??= require('sherpa-onnx-node') as Sherpa); }

export const ASR_MODEL = process.env.CT_ASR_MODEL ?? 'sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12';

let recognizer: SherpaRecognizer | null = null;
function asr(): SherpaRecognizer {
  if (!recognizer) {
    const d = MODELS + ASR_MODEL + '/';
    if (!existsSync(d + 'model.int8.onnx')) throw new Error(`Modèle ASR absent : lancez « npm run models » (${ASR_MODEL})`);
    recognizer = new (so().OfflineRecognizer)({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { omnilingual: { model: d + 'model.int8.onnx' }, tokens: d + 'tokens.txt', numThreads: 2 },
    });
  }
  return recognizer;
}

/** Convertit n'importe quel audio (webm/opus du navigateur, m4a, mp3, wav…) en échantillons mono 16 kHz. */
export async function toSamples16k(input: Uint8Array): Promise<Wave> {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(tmpdir() + '/ct-');
  try {
    await writeFile(dir + '/in', input);
    await execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', dir + '/in', '-ac', '1', '-ar', '16000', '-f', 'f32le', dir + '/out.raw']);
    const raw = await readFile(dir + '/out.raw');
    const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    return { samples, sampleRate: 16000 };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export interface Transcript { text: string; engine: string; audioSeconds: number; decodeMs: number }

export async function transcribe(audio: Uint8Array): Promise<Transcript> {
  const wav = await toSamples16k(audio);
  const r = asr();
  const s = r.createStream();
  s.acceptWaveform({ samples: wav.samples, sampleRate: wav.sampleRate });
  const t0 = performance.now();
  r.decode(s);
  return { text: r.getResult(s).text.trim(), engine: `omnilingual-asr:${ASR_MODEL.includes('1B') ? '1B' : '300M'}`, audioSeconds: Number((wav.samples.length / wav.sampleRate).toFixed(2)), decodeMs: Math.round(performance.now() - t0) };
}

const VOICES: Record<string, string> = { fr: 'vits-piper-fr_FR-siwis-medium/fr_FR-siwis-medium', en: 'vits-piper-en_US-amy-low/en_US-amy-low' };
const ttsCache = new Map<string, SherpaTts>();

export function ttsAvailable(lang: string): boolean { return lang in VOICES && existsSync(MODELS + VOICES[lang] + '.onnx'); }

/** Synthèse fr/en en WAV PCM 16 bits. Renvoie null pour une langue sans vraie voix. */
export function synthesize(text: string, lang: string): Uint8Array | null {
  if (!ttsAvailable(lang)) return null;
  let t = ttsCache.get(lang);
  if (!t) {
    const base = MODELS + VOICES[lang];
    const dir = base.slice(0, base.lastIndexOf('/') + 1);
    t = new (so().OfflineTts)({ model: { vits: { model: base + '.onnx', tokens: dir + 'tokens.txt', dataDir: dir + 'espeak-ng-data' } }, numThreads: 2 });
    ttsCache.set(lang, t);
  }
  const a = t.generate({ text, sid: 0, speed: 1.0 });
  return encodeWav(a.samples, a.sampleRate);
}

/** Enregistrements natifs éventuels : data/audio/<langue>/<clé>.wav (fournis par des locuteurs, avec consentement). */
export function nativeClip(lang: string, key: string): Uint8Array | null {
  const f = fileURLToPath(new URL(`../../data/audio/${lang}/${key}.wav`, import.meta.url));
  return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return new Uint8Array(buf);
}
