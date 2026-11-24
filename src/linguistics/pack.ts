// Pack de langue : TOUT ce qu'une langue apporte au moteur, dans un seul fichier versionné et traçable
// (data/packs/<lang>.json), produit par tools/import-collecte.ts à partir des tableurs des natifs.
//
// Chaque élément garde sa provenance (auteur, relecteur) et son statut. Le moteur n'utilise que les
// éléments VALIDÉS (relus par un second natif), sauf si CT_ALLOW_DRAFT=1 (démonstration interne, et la
// réponse est alors marquée « brouillon »).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NumberEntry } from './numbers.ts';

export interface Provenance { author: string; reviewer: string; validated: boolean }
export interface Entry extends Provenance { text: string }

export interface Utterance extends Provenance {
  situation: string;
  intent: string;
  text: string;
  expect: Record<string, string | number>;
  split: 'train' | 'test';
}

export interface LangPack {
  schema: 'ct-langpack.v1';
  lang: string;
  generatedAt: string;          // ISO 8601
  source: string;
  numbers: (NumberEntry & Provenance)[];
  concepts: Record<string, Entry[]>;
  utterances: Utterance[];
  responses: Record<string, Entry>;
  definitions: Record<string, Entry>;
  rejected: { sheet: string; row: number; reason: string }[];
}

export const PACK_DIR = fileURLToPath(new URL('../../data/packs/', import.meta.url));
export const allowDraft = () => process.env.CT_ALLOW_DRAFT === '1';

const cache = new Map<string, LangPack | null>();
export function loadPack(lang: string): LangPack | null {
  if (!cache.has(lang)) {
    const f = `${PACK_DIR}${lang}.json`;
    cache.set(lang, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as LangPack : null);
  }
  return cache.get(lang) ?? null;
}
/** Remplace le pack en mémoire (tests, rechargement à chaud après un import). */
export function setPack(lang: string, pack: LangPack | null): void { cache.set(lang, pack); }
export function clearPackCache(): void { cache.clear(); }

/** Un élément est utilisable s'il est validé, ou si les brouillons sont explicitement autorisés. */
export const usable = (p: Provenance) => p.validated || allowDraft();

/** Répartition déterministe entraînement / test (30 % en test) : la même phrase tombe toujours du même côté. */
export function splitOf(key: string): 'train' | 'test' {
  let h = 2166136261;
  for (const c of key) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; }
  return h % 10 < 3 ? 'test' : 'train';
}
