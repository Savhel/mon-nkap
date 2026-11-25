// Entraînement et compilation des ressources linguistiques à partir de `collecte/<lang>/*.csv`.
// Réutilisé par l'interface d'administration (`/admin`) et testable de façon isolée avec des dossiers dédiés.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.ts';
import { buildPack, packReport, type Sheets } from './importer.ts';
import { loadPack, PACK_DIR, setPack, type LangPack } from './pack.ts';
import { clearRuntimeCache, runtimeFor } from './runtime.ts';
import { buildProfile, loadLangId, setLangIdModel, type LangIdModel, type LangProfile } from './langid.ts';
import { evaluateLanguage, type LangEvaluation } from '../eval/evaluate.ts';

export const COLLECTE_DIR = fileURLToPath(new URL('../../collecte/', import.meta.url));
export const EVAL_DIR = fileURLToPath(new URL('../../data/eval/', import.meta.url));
export const LANGID_FILE = fileURLToPath(new URL('../../data/langid/profiles.json', import.meta.url));

export const SHEET_NAMES = ['nombres', 'lexique', 'demandes', 'reponses', 'definitions'] as const;
export type SheetName = (typeof SHEET_NAMES)[number];

export interface TrainerPaths {
  collecteDir?: string;
  packsDir?: string;
  evalDir?: string;
  langidFile?: string;
}

function resolvePaths(p: TrainerPaths = {}) {
  return {
    collecteDir: p.collecteDir ?? COLLECTE_DIR,
    packsDir: p.packsDir ?? PACK_DIR,
    evalDir: p.evalDir ?? EVAL_DIR,
    langidFile: p.langidFile ?? LANGID_FILE,
  };
}

export function assertValidLang(lang: string): string {
  const code = lang.trim().toLowerCase();
  if (!/^[a-z]{2,3}$/.test(code)) throw new Error('Code langue invalide (2 ou 3 lettres minuscules)');
  return code;
}

export function assertValidSheet(sheet: string): SheetName {
  if (!SHEET_NAMES.includes(sheet as SheetName)) {
    throw new Error(`Tableur invalide (attendu : ${SHEET_NAMES.join(', ')})`);
  }
  return sheet as SheetName;
}

export function readCollecteSheet(lang: string, sheet: string, paths?: TrainerPaths): string {
  const l = assertValidLang(lang);
  const s = assertValidSheet(sheet);
  const { collecteDir } = resolvePaths(paths);
  const file = join(collecteDir, l, `${s}.csv`);
  if (!existsSync(file)) throw new Error(`Fichier introuvable : ${l}/${s}.csv`);
  return readFileSync(file, 'utf8');
}

export function writeCollecteSheet(lang: string, sheet: string, csv: string, paths?: TrainerPaths): { rows: number } {
  const l = assertValidLang(lang);
  const s = assertValidSheet(sheet);
  const parsed = parseCsv(csv);
  const { collecteDir } = resolvePaths(paths);
  const dir = join(collecteDir, l);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${s}.csv`), csv.endsWith('\n') ? csv : csv + '\n', 'utf8');
  return { rows: parsed.length };
}

export interface LanguageTrainingStatus {
  lang: string;
  sheets: Record<SheetName, number>;
  pack: ReturnType<typeof packReport> | null;
  generatedAt: string | null;
  runtime: {
    learnedPhrases: number;
    grammarWords: number;
    grammarFailures: number;
    complete: boolean;
  } | null;
  eval: Pick<LangEvaluation, 'n' | 'includesDrafts' | 'intentAccuracy' | 'amountAccuracy' | 'beneficiaryAccuracy' | 'crossChannelConsistency' | 'note'> & { at?: string } | null;
}

export function listCollecteLanguages(paths?: TrainerPaths): LanguageTrainingStatus[] {
  const { collecteDir, packsDir, evalDir } = resolvePaths(paths);
  if (!existsSync(collecteDir)) return [];
  const langs = readdirSync(collecteDir)
    .filter((d) => /^[a-z]{2,3}$/.test(d) && statSync(join(collecteDir, d)).isDirectory())
    .sort();

  return langs.map((lang) => {
    const sheets = {} as Record<SheetName, number>;
    for (const name of SHEET_NAMES) {
      const f = join(collecteDir, lang, `${name}.csv`);
      sheets[name] = existsSync(f) ? parseCsv(readFileSync(f, 'utf8')).length : 0;
    }
    const packFile = join(packsDir, `${lang}.json`);
    const pack = existsSync(packFile) ? JSON.parse(readFileSync(packFile, 'utf8')) as LangPack : loadPack(lang);
    const rt = pack ? runtimeFor(lang) : null;
    const evalFile = join(evalDir, `${lang}.json`);
    const ev = existsSync(evalFile)
      ? JSON.parse(readFileSync(evalFile, 'utf8')) as LangEvaluation & { at?: string }
      : null;

    return {
      lang,
      sheets,
      pack: pack ? packReport(pack) : null,
      generatedAt: pack?.generatedAt ?? null,
      runtime: rt ? {
        learnedPhrases: rt.lexicon.learned.length,
        grammarWords: Object.keys(rt.grammar.words).length,
        grammarFailures: rt.grammar.failures.length,
        complete: rt.lexicon.complete,
      } : null,
      eval: ev ? {
        n: ev.n,
        includesDrafts: ev.includesDrafts,
        intentAccuracy: ev.intentAccuracy,
        amountAccuracy: ev.amountAccuracy,
        beneficiaryAccuracy: ev.beneficiaryAccuracy,
        crossChannelConsistency: ev.crossChannelConsistency,
        note: ev.note,
        at: ev.at,
      } : null,
    };
  });
}

export interface TrainLangResult {
  lang: string;
  report: ReturnType<typeof packReport>;
  rejected: LangPack['rejected'];
  runtime: {
    learnedPhrases: number;
    grammarWords: number;
    grammarFailures: number;
    complete: boolean;
  };
  eval: LangEvaluation;
}

/** Compile les tableurs CSV d'une langue, met à jour le moteur à chaud et recalcule son évaluation. */
export async function trainLanguagePack(
  lang: string,
  opts: { includeDrafts?: boolean; paths?: TrainerPaths } = {},
): Promise<TrainLangResult> {
  const l = assertValidLang(lang);
  const { collecteDir, packsDir, evalDir } = resolvePaths(opts.paths);
  const langDir = join(collecteDir, l);
  if (!existsSync(langDir)) throw new Error(`Dossier collecte/${l} introuvable`);

  const sheets: Sheets = {};
  for (const name of SHEET_NAMES) {
    const f = join(langDir, `${name}.csv`);
    if (existsSync(f)) sheets[name] = parseCsv(readFileSync(f, 'utf8'));
  }

  const pack = buildPack(l, sheets, `collecte/${l}`);
  mkdirSync(packsDir, { recursive: true });
  writeFileSync(join(packsDir, `${l}.json`), JSON.stringify(pack, null, 1));

  // Rechargement à chaud du pack et du runtime appris
  setPack(l, pack);
  clearRuntimeCache();
  const rt = runtimeFor(l);

  const ev = await evaluateLanguage(l, { includeDrafts: !!opts.includeDrafts });
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, `${l}.json`), JSON.stringify({ ...ev, at: new Date().toISOString() }, null, 1));

  return {
    lang: l,
    report: packReport(pack),
    rejected: pack.rejected,
    runtime: {
      learnedPhrases: rt?.lexicon.learned.length ?? 0,
      grammarWords: Object.keys(rt?.grammar.words ?? {}).length,
      grammarFailures: rt?.grammar.failures.length ?? 0,
      complete: rt?.lexicon.complete ?? false,
    },
    eval: ev,
  };
}

function mergeLangProfile(base: LangProfile | undefined, extraTexts: string[], keep = 600): LangProfile {
  if (!extraTexts.length && base) return base;
  const extra = buildProfile(extraTexts, keep);
  if (!base) return extra;
  const merged = new Map<string, number>(Object.entries(base.grams));
  for (const [g, count] of Object.entries(extra.grams)) merged.set(g, (merged.get(g) ?? 0) + count);
  const top = [...merged].sort((a, b) => b[1] - a[1]).slice(0, keep);
  return { total: top.reduce((s, [, n]) => s + n, 0), grams: Object.fromEntries(top) };
}

/**
 * Enrichit les profils d'identification de langue (`profiles.json`) avec les phrases d'entraînement
 * des packs natifs sans écraser les profils Common Voice existants, puis recharge le modèle en mémoire.
 */
export function refreshLangIdFromPacks(langs: string[], paths?: TrainerPaths): { updated: string[]; languages: string[]; built: string } {
  const { langidFile, packsDir } = resolvePaths(paths);
  const existing: LangIdModel = existsSync(langidFile)
    ? JSON.parse(readFileSync(langidFile, 'utf8')) as LangIdModel
    : { version: 1, built: new Date().toISOString(), sources: {}, profiles: {} };

  const updated: string[] = [];
  for (const raw of langs) {
    const l = assertValidLang(raw);
    const packFile = join(packsDir, `${l}.json`);
    const pack = existsSync(packFile) ? JSON.parse(readFileSync(packFile, 'utf8')) as LangPack : loadPack(l);
    if (!pack) continue;
    const trainTexts = pack.utterances.filter((u) => u.split === 'train' && u.validated).map((u) => u.text);
    if (!trainTexts.length) continue;
    if (!existing.profiles[l] && trainTexts.length < 3) continue;
    existing.profiles[l] = mergeLangProfile(existing.profiles[l], trainTexts);
    const prevSrc = existing.sources[l] ?? '';
    const suffix = `+ ${trainTexts.length} phrases de natifs`;
    existing.sources[l] = prevSrc ? (prevSrc.includes('phrases de natifs') ? prevSrc.replace(/\+\s*\d+ phrases de natifs/, suffix) : `${prevSrc} ${suffix}`) : `${trainTexts.length} phrases de natifs`;
    updated.push(l);
  }

  existing.built = new Date().toISOString();
  mkdirSync(join(langidFile, '..'), { recursive: true });
  writeFileSync(langidFile, JSON.stringify(existing));
  setLangIdModel(existing);
  return { updated, languages: Object.keys(existing.profiles), built: existing.built };
}

export function getLangIdSummary(paths?: TrainerPaths) {
  const { langidFile } = resolvePaths(paths);
  const model = existsSync(langidFile)
    ? JSON.parse(readFileSync(langidFile, 'utf8')) as LangIdModel
    : loadLangId();
  if (!model) return { loaded: false, built: null, languages: [] as string[], sources: {} as Record<string, string> };
  return {
    loaded: true,
    built: model.built,
    languages: Object.keys(model.profiles),
    sources: model.sources,
  };
}
