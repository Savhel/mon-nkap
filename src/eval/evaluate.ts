// Évaluation du moteur sur les phrases de TEST écrites par les natifs (jamais utilisées pour apprendre).
// Chaque langue est mesurée séparément : on ne mélange jamais le français et une langue nationale.
//
// Pour chaque phrase, on prépare le contexte de sa situation (une correction ou une confirmation suppose une
// opération en attente), on envoie la phrase, et on compare la représentation canonique à l'attendu.
// La même phrase est aussi envoyée sur trois canaux pour mesurer la cohérence intercanale.

import { MockBackend } from '../backend/mock.ts';
import { Engine, type Channel, type EngineResult } from '../core/engine.ts';
import { loadPack, type Utterance } from '../linguistics/pack.ts';

export interface ItemResult {
  situation: string; text: string; expected: string; predicted: string; intentOk: boolean;
  amountOk?: boolean; beneficiaryOk?: boolean; clarificationOk?: boolean; consistent: boolean; latencyMs: number; reply: string;
}
export interface LangEvaluation {
  lang: string; split: 'test'; includesDrafts: boolean; n: number;
  intentAccuracy: number | null;
  perIntent: Record<string, { precision: number; recall: number; f1: number; support: number }>;
  amountAccuracy: number | null; amountN: number;
  beneficiaryAccuracy: number | null; beneficiaryN: number;
  clarificationRate: number | null; clarificationN: number;
  crossChannelConsistency: number | null;
  latencyMs: { p50: number; p95: number } | null;
  items: ItemResult[];
  note?: string;
}

// Contexte à préparer avant la phrase (en français, langue de référence du jeu de test).
const SETUP: Record<string, string> = {
  cor1: 'envoie 5000 à Marie', cor2: 'envoie 5000 à Paul Mbarga', yes1: 'envoie 5000 à Marie', no1: 'envoie 5000 à Marie',
};
// Situations où la bonne réaction est de demander une précision.
const NEEDS_CLARIFICATION = new Set(['amb1', 'tr3']);

const pct = (a: number, b: number) => (b ? Number((a / b).toFixed(3)) : null);
const strip = (r: EngineResult) => JSON.stringify({ ...r.canonical, channel: null, confirmationToken: null });

function label(r: EngineResult): string {
  const c = r.canonical;
  if (c.act === 'REQUEST') return c.operation ?? 'UNKNOWN';
  return c.act;
}

async function runOne(u: Utterance, lang: string, channel: Channel, sid: string): Promise<EngineResult> {
  const engine = new Engine(new MockBackend());
  if (SETUP[u.situation]) await engine.handle({ sessionId: sid, channel, lang: 'fr', text: SETUP[u.situation] });
  return engine.handle({ sessionId: sid, channel, lang, text: u.text });
}

export async function evaluateLanguage(lang: string, opts: { includeDrafts?: boolean } = {}): Promise<LangEvaluation> {
  const pack = loadPack(lang);
  const items: ItemResult[] = [];
  const base: LangEvaluation = { lang, split: 'test', includesDrafts: !!opts.includeDrafts, n: 0, intentAccuracy: null, perIntent: {}, amountAccuracy: null, amountN: 0, beneficiaryAccuracy: null, beneficiaryN: 0, clarificationRate: null, clarificationN: 0, crossChannelConsistency: null, latencyMs: null, items };
  if (!pack) return { ...base, note: 'Aucun pack de langue : rien à évaluer.' };
  const tests = pack.utterances.filter((u) => u.split === 'test' && (u.validated || opts.includeDrafts));
  if (!tests.length) return { ...base, note: 'Aucune phrase de test validée par un second natif.' };

  for (const [i, u] of tests.entries()) {
    const rs = await Promise.all((['mobile', 'web', 'ussd'] as Channel[]).map((c, k) => runOne(u, lang, c, `eval-${i}-${k}`)));
    const r = rs[0];
    const predicted = label(r);
    const exp = u.expect;
    const item: ItemResult = {
      situation: u.situation, text: u.text, expected: u.intent, predicted, intentOk: predicted === u.intent,
      consistent: rs.every((x) => strip(x) === strip(r)), latencyMs: r.latencyMs, reply: r.reply.text,
    };
    if (typeof exp.amount === 'number') item.amountOk = r.canonical.entities.amount === exp.amount;
    if (typeof exp.beneficiary === 'string') item.beneficiaryOk = (r.canonical.entities.beneficiary?.name ?? '').toLowerCase().includes(String(exp.beneficiary).toLowerCase());
    else if (typeof exp.phone === 'string') item.beneficiaryOk = r.canonical.entities.beneficiary?.phone === exp.phone;
    if (NEEDS_CLARIFICATION.has(u.situation)) item.clarificationOk = r.canonical.requiresClarification;
    items.push(item);
  }

  const labels = [...new Set(items.flatMap((x) => [x.expected, x.predicted]))];
  const perIntent: LangEvaluation['perIntent'] = {};
  for (const l of labels) {
    const tp = items.filter((x) => x.expected === l && x.predicted === l).length;
    const fp = items.filter((x) => x.expected !== l && x.predicted === l).length;
    const fn = items.filter((x) => x.expected === l && x.predicted !== l).length;
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
    const support = tp + fn;
    if (support) perIntent[l] = { precision: Number(precision.toFixed(3)), recall: Number(recall.toFixed(3)), f1: Number((precision + recall ? (2 * precision * recall) / (precision + recall) : 0).toFixed(3)), support };
  }
  const am = items.filter((x) => x.amountOk !== undefined), be = items.filter((x) => x.beneficiaryOk !== undefined), cl = items.filter((x) => x.clarificationOk !== undefined);
  const lat = items.map((x) => x.latencyMs).sort((a, b) => a - b);
  return {
    ...base, n: items.length,
    intentAccuracy: pct(items.filter((x) => x.intentOk).length, items.length), perIntent,
    amountAccuracy: pct(am.filter((x) => x.amountOk).length, am.length), amountN: am.length,
    beneficiaryAccuracy: pct(be.filter((x) => x.beneficiaryOk).length, be.length), beneficiaryN: be.length,
    clarificationRate: pct(cl.filter((x) => x.clarificationOk).length, cl.length), clarificationN: cl.length,
    crossChannelConsistency: pct(items.filter((x) => x.consistent).length, items.length),
    latencyMs: { p50: lat[Math.floor(lat.length * 0.5)], p95: lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] },
  };
}
