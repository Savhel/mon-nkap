// Service de traduction directe pour les applications bancaires partenaires (`POST /v1/translate`).
//
// Ordre de priorité (sans jamais inventer de texte en langue nationale) :
//   1. Correspondance validée dans le pack natif (`data/packs/<lang>.json`) → `validated`
//   2. Si `allowDraft` est activé : libellés Mboa (`data/mboa-pack.json`) → `draft`
//   3. Traduction automatique gardée (`src/mt/flagship.ts`) : jamais de chiffre, contrôle aller-retour
//      et vérification de langue → `machine` si acceptée, sinon `fallback` (`accepted: false`) avec raison.

import { readFileSync } from 'node:fs';
import { allowDraft, loadPack, usable } from '../linguistics/pack.ts';
import { DEFINITIONS, RESPONSES } from '../linguistics/collection.ts';
import { frenchTo, toFrench } from '../mt/flagship.ts';
import { normalize } from './text.ts';
import type { Quality } from './respond.ts';

export interface TranslateRequest {
  text: string;
  from?: string;
  to: string;
  allowDraft?: boolean;
}

export interface TranslateResponse {
  text: string;
  from: string;
  to: string;
  quality: Quality;
  accepted: boolean;
  source: string;
  reason?: string;
  mt?: {
    back?: string;
    score?: number;
    engine: string;
    ms: number;
  };
}

type MboaPack = {
  phrases: Record<string, Record<string, string>>;
  ui: Record<string, Record<string, string>>;
};
const mboa: MboaPack = JSON.parse(readFileSync(new URL('../../data/mboa-pack.json', import.meta.url), 'utf8'));

const REF_FR_BY_ID = new Map<string, string>([
  ...RESPONSES.filter((r) => r.placeholders.length === 0).map((r) => [r.id, r.fr] as const),
  ...DEFINITIONS.map((d) => [d.id, d.fr] as const),
]);

function matchPackFromFrench(lang: string, normText: string, draftsAllowed: boolean): { text: string; quality: Quality; source: string } | null {
  const pack = loadPack(lang);
  if (pack) {
    for (const [id, fr] of REF_FR_BY_ID) {
      if (normalize(fr) !== normText) continue;
      const entry = pack.responses[id] ?? pack.definitions[id];
      if (entry && (entry.validated || draftsAllowed || usable(entry))) {
        return { text: entry.text, quality: entry.validated ? 'validated' : 'draft', source: `pack:${lang}` };
      }
    }
  }
  if (draftsAllowed) {
    for (const group of [mboa.phrases, mboa.ui]) {
      for (const entry of Object.values(group)) {
        const src = entry.fr;
        const dst = entry[lang];
        if (src && dst && !/\{[a-z_]+\}/i.test(dst) && normalize(src) === normText) {
          return { text: dst, quality: 'draft', source: 'mboa-pack' };
        }
      }
    }
  }
  return null;
}

function matchPackToFrench(lang: string, normText: string, draftsAllowed: boolean): { text: string; quality: Quality; source: string } | null {
  const pack = loadPack(lang);
  if (pack) {
    for (const [id, fr] of REF_FR_BY_ID) {
      const entry = pack.responses[id] ?? pack.definitions[id];
      if (entry && (entry.validated || draftsAllowed || usable(entry)) && normalize(entry.text) === normText) {
        return { text: fr, quality: entry.validated ? 'validated' : 'draft', source: `pack:${lang}` };
      }
    }
  }
  if (draftsAllowed) {
    for (const group of [mboa.phrases, mboa.ui]) {
      for (const entry of Object.values(group)) {
        const src = entry[lang];
        const dst = entry.fr;
        if (src && dst && !/\{[a-z_]+\}/i.test(src) && normalize(src) === normText) {
          return { text: dst, quality: 'draft', source: 'mboa-pack' };
        }
      }
    }
  }
  return null;
}

export async function translateText(req: TranslateRequest): Promise<TranslateResponse> {
  const from = (req.from ?? 'fr').toLowerCase();
  const to = req.to.toLowerCase();
  const text = req.text.trim();
  const draftsAllowed = req.allowDraft ?? allowDraft();

  if (from === to) {
    return { text, from, to, quality: 'reference', accepted: true, source: 'identity' };
  }

  const normText = normalize(text);

  if (from === 'fr') {
    const hit = matchPackFromFrench(to, normText, draftsAllowed);
    if (hit) return { text: hit.text, from, to, quality: hit.quality, accepted: true, source: hit.source };
    const mt = await frenchTo(to, text);
    if (!mt) {
      return { text, from, to, quality: 'fallback', accepted: false, source: 'fallback', reason: 'service_traduction_indisponible' };
    }
    if (!mt.accepted) {
      return {
        text,
        from,
        to,
        quality: 'fallback',
        accepted: false,
        source: 'fallback',
        reason: mt.reason,
        mt: { back: mt.back, score: mt.score, engine: mt.engine, ms: mt.ms },
      };
    }
    return {
      text: mt.text,
      from,
      to,
      quality: 'machine',
      accepted: true,
      source: mt.engine,
      mt: { back: mt.back, score: mt.score, engine: mt.engine, ms: mt.ms },
    };
  }

  if (to === 'fr') {
    const hit = matchPackToFrench(from, normText, draftsAllowed);
    if (hit) return { text: hit.text, from, to, quality: hit.quality, accepted: true, source: hit.source };
    const mt = await toFrench(from, text);
    if (!mt) {
      return { text, from, to, quality: 'fallback', accepted: false, source: 'fallback', reason: 'service_traduction_indisponible' };
    }
    return {
      text: mt.fr,
      from,
      to,
      quality: 'machine',
      accepted: true,
      source: mt.engine,
      mt: { engine: mt.engine, ms: mt.ms },
    };
  }

  // Correspondance directe entre deux langues sans passer par un modèle non vérifié (ex. en → langue via mboa-pack si brouillons autorisés).
  if (draftsAllowed) {
    for (const group of [mboa.phrases, mboa.ui]) {
      for (const entry of Object.values(group)) {
        const src = entry[from];
        const dst = entry[to];
        if (src && dst && !/\{[a-z_]+\}/i.test(src) && !/\{[a-z_]+\}/i.test(dst) && normalize(src) === normText) {
          return { text: dst, from, to, quality: 'draft', accepted: true, source: 'mboa-pack' };
        }
      }
    }
  }

  return { text, from, to, quality: 'fallback', accepted: false, source: 'fallback', reason: 'paire_non_supportee' };
}

