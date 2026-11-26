// Service de traduction Flagship : fournisseur facultatif du moteur.
// Au démarrage, le serveur vérifie qu'il répond ; sinon il le lance lui-même (services/mt_server.py, avec le
// Python de .venv s'il existe) et attend qu'il ait chargé ses modèles. Son état est exposé par /v1/health.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const URL_BASE = process.env.CT_MT_URL ?? 'http://127.0.0.1:8091';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface MtStatus { up: boolean; pairs: string[]; url: string; error?: string }

export async function mtStatus(timeoutMs = 2000): Promise<MtStatus> {
  try {
    const r = await fetch(`${URL_BASE}/pairs`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { up: false, pairs: [], url: URL_BASE, error: `HTTP ${r.status}` };
    const { pairs } = await r.json() as { pairs: string[] };
    return { up: pairs.length > 0, pairs, url: URL_BASE, ...(pairs.length ? {} : { error: 'aucun modèle chargé (npm run mt:models)' }) };
  } catch (e) {
    return { up: false, pairs: [], url: URL_BASE, error: e instanceof Error ? e.message : String(e) };
  }
}

let child: ChildProcess | null = null;

/** Vérifie le service ; le démarre s'il est absent (sauf CT_MT_AUTOSTART=0 ou service distant). Attend au plus `waitMs`. */
export async function ensureMtService(waitMs = 120_000): Promise<MtStatus & { started: boolean }> {
  const first = await mtStatus();
  if (first.up) return { ...first, started: false };
  if (process.env.CT_MT_AUTOSTART === '0' || process.env.CT_MT_URL) return { ...first, started: false };
  if (!existsSync(`${ROOT}models/flagship-cameroon-int8`)) return { ...first, started: false, error: 'modèles absents : npm run mt:models' };
  const python = existsSync(`${ROOT}.venv/bin/python`) ? `${ROOT}.venv/bin/python` : 'python3';
  const port = new URL(URL_BASE).port || '8091';
  child = spawn(python, [`${ROOT}services/mt_server.py`, '--port', port], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('exit', (code) => { if (code) console.error(`Service de traduction arrêté (code ${code})`); child = null; });
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const s = await mtStatus();
    if (s.up) return { ...s, started: true };
    if (!child) break;
  }
  return { ...(await mtStatus()), started: true };
}

export function stopMtService(): void { child?.kill(); child = null; }
