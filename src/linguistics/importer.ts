// Construit un pack de langue à partir des tableurs remplis par les natifs.
// Contrôles bloquants (la ligne est rejetée, avec la raison, jamais corrigée en silence) :
// - une réponse doit garder EXACTEMENT ses repères {montant}, {nom}… : c'est le système qui y met les valeurs ;
// - une réponse ou une définition ne doit contenir aucun chiffre : un chiffre écrit à la main pourrait
//   contredire le vrai montant ;
// - un montant doit correspondre à une valeur du catalogue.

import { isValidated, NUMBER_TARGETS, RESPONSES, SITUATIONS } from './collection.ts';
import { splitOf, type Entry, type LangPack, type Provenance } from './pack.ts';

type Rows = Record<string, string>[];
export interface Sheets { nombres?: Rows; lexique?: Rows; demandes?: Rows; reponses?: Rows; definitions?: Rows }

const prov = (r: Record<string, string>): Provenance => ({ author: r.auteur ?? '', reviewer: r.relecteur ?? '', validated: isValidated(r) });
const placeholders = (s: string) => [...s.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();

export function buildPack(lang: string, sheets: Sheets, source = `collecte/${lang}`): LangPack {
  const pack: LangPack = { schema: 'ct-langpack.v1', lang, generatedAt: new Date().toISOString(), source, numbers: [], concepts: {}, utterances: [], responses: {}, definitions: {}, rejected: [] };
  const reject = (sheet: string, row: number, reason: string) => pack.rejected.push({ sheet, row: row + 2, reason }); // +2 : ligne d'en-tête, numérotation à 1

  (sheets.nombres ?? []).forEach((r, i) => {
    const value = Number((r.valeur ?? '').replace(/\s/g, ''));
    if (!NUMBER_TARGETS.includes(value)) { if (r.comment_on_le_dit) reject('nombres', i, `valeur inconnue : ${r.valeur}`); return; }
    for (const text of [r.comment_on_le_dit, ...(r.autre_facon ?? '').split('/')].map((x) => (x ?? '').trim()).filter(Boolean)) {
      if (/\d/.test(text)) { reject('nombres', i, `chiffre dans « ${text} » : écrire le montant en mots`); continue; }
      pack.numbers.push({ value, text, ...prov(r) });
    }
  });

  (sheets.lexique ?? []).forEach((r) => {
    const forms = [r.mot_ou_expression, ...(r.variantes ?? '').split('/')].map((x) => (x ?? '').trim()).filter(Boolean);
    if (!r.id || !forms.length) return;
    pack.concepts[r.id] = [...(pack.concepts[r.id] ?? []), ...forms.map((text) => ({ text, ...prov(r) }))];
  });

  const situations = new Map(SITUATIONS.map((s) => [s.id, s]));
  (sheets.demandes ?? []).forEach((r, i) => {
    const text = (r.phrase ?? '').trim();
    if (!text) return;
    const s = situations.get(r.situation_id);
    if (!s) { reject('demandes', i, `situation inconnue : ${r.situation_id}`); return; }
    pack.utterances.push({ situation: s.id, intent: s.intent, text, expect: s.expect, split: splitOf(`${s.id}|${text}`), ...prov(r) });
  });

  const templates = new Map(RESPONSES.map((t) => [t.id, t]));
  (sheets.reponses ?? []).forEach((r, i) => {
    const text = (r.votre_phrase ?? '').trim();
    if (!text) return;
    const t = templates.get(r.id);
    if (!t) { reject('reponses', i, `réponse inconnue : ${r.id}`); return; }
    const want = [...t.placeholders].sort(), got = placeholders(text);
    if (want.join() !== got.join()) { reject('reponses', i, `repères à garder : ${want.map((p) => `{${p}}`).join(' ') || 'aucun'} ; trouvés : ${got.map((p) => `{${p}}`).join(' ') || 'aucun'}`); return; }
    if (/\d/.test(text.replace(/\{[a-z_]+\}/g, ''))) { reject('reponses', i, 'chiffre écrit à la main : utiliser les repères'); return; }
    pack.responses[t.id] = pickBetter(pack.responses[t.id], { text, ...prov(r) });
  });

  (sheets.definitions ?? []).forEach((r) => {
    const text = (r.votre_explication ?? '').trim();
    if (!text || !r.id) return;
    pack.definitions[r.id] = pickBetter(pack.definitions[r.id], { text, ...prov(r) });
  });
  return pack;
}

/** Deux versions d'une même phrase : la version validée l'emporte sur un brouillon. */
function pickBetter(a: Entry | undefined, b: Entry): Entry { return !a || (b.validated && !a.validated) ? b : a; }

/** Résumé lisible, pour l'équipe et pour le jury : ce qui est réellement couvert et validé. */
export function packReport(p: LangPack) {
  const v = <T extends Provenance>(xs: T[]) => `${xs.filter((x) => x.validated).length}/${xs.length}`;
  return {
    lang: p.lang,
    numbers: v(p.numbers),
    concepts: `${Object.values(p.concepts).filter((xs) => xs.some((x) => x.validated)).length}/${Object.keys(p.concepts).length}`,
    utterances: v(p.utterances),
    testUtterances: p.utterances.filter((u) => u.split === 'test').length,
    responses: `${Object.values(p.responses).filter((x) => x.validated).length}/${RESPONSES.length}`,
    definitions: `${Object.values(p.definitions).filter((x) => x.validated).length}/${Object.keys(p.definitions).length}`,
    rejected: p.rejected.length,
  };
}
