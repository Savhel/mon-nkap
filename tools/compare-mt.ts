// Compare les moteurs de traduction (Flagship, OPUS, MADLAD) langue par langue, et garde le meilleur.
//   node tools/compare-mt.ts
// Phrases : les réponses et définitions du service sans chiffre (celles qu'une traduction peut remplacer).
// Mesure, pour chaque paire aller (fr→langue) + retour (langue→fr) disponible dans le service :
//   - fidélité moyenne de l'aller-retour (recouvrement des mots porteurs de sens, 0 à 1) ;
//   - part des traductions ACCEPTÉES par le garde-fou du moteur (aller-retour ≥ 0,6, pas de chiffre inventé,
//     pas de boucle, pas de vocabulaire religieux) : c'est ce qui sera réellement montré à l'utilisateur ;
//   - temps moyen.
// Écrit data/eval/mt-compare.json et data/mt-routes.json (meilleure route par langue, lue par le moteur).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFINITIONS, RESPONSES } from '../src/linguistics/collection.ts';
import { overlap, MIN_SCORE, wrongLanguage } from '../src/mt/flagship.ts';
import { normalize, tokens } from '../src/core/text.ts';
import { ensureMtService, stopMtService } from '../src/mt/service.ts';

const URL_BASE = process.env.CT_MT_URL ?? 'http://127.0.0.1:8091';
const RELIGIOUS = ['dieu', 'seigneur', 'jesus', 'christ', 'evangile', 'esprit', 'saint', 'heureux', 'temoignage', 'prophete', 'pecheur', 'sauves', 'ressuscite', 'eternel', 'disciples', 'israel', 'sanctuaire', 'royaume'];
const LANGS: Record<string, string> = { ewo: 'ewondo', dua: 'duala', fub: 'fufulde', bum: 'bulu', bbj: 'ghomala', ybb: 'yemba', bas: 'basaa', eto: 'eton', ozm: 'koonzime', bqz: 'bakaka' };
const ENGINES = ['flagship', 'opus', 'madlad'] as const;
const pairOf = (engine: string, from: string, to: string) => (engine === 'flagship' ? `${from}-${to}` : `${engine}:${from}-${to}`);

const sentences = [...RESPONSES.filter((r) => !r.placeholders.length && !r.id.startsWith('menu_') && !r.id.startsWith('hist_')).map((r) => r.fr), ...DEFINITIONS.map((d) => d.fr)].filter((s) => !/\d/.test(s));

/** Traduit une liste par lots de 16 (limite du service). */
async function translateAll(pair: string, texts: string[]) {
  const out: string[] = []; let ms = 0;
  for (let i = 0; i < texts.length; i += 16) {
    const r = await fetch(`${URL_BASE}/translate`, { method: 'POST', body: JSON.stringify({ pair, texts: texts.slice(i, i + 16) }), signal: AbortSignal.timeout(600_000) });
    if (!r.ok) throw new Error(`${pair} : HTTP ${r.status}`);
    const j = await r.json() as { translations: string[]; ms: number };
    out.push(...j.translations); ms += j.ms;
  }
  return { translations: out, ms };
}
const repetitive = (s: string) => { const c = new Map<string, number>(); for (const w of tokens(s)) c.set(w, (c.get(w) ?? 0) + 1); return [...c.values()].some((n) => n >= 3) || tokens(s).length > 40; };

const mt = await ensureMtService(600_000);
if (!mt.up) { console.error('service de traduction indisponible :', mt.error); process.exit(1); }
const results: Record<string, Record<string, { fidelity: number; accepted: number; msPerSentence: number; n: number }>> = {};
const routes: Record<string, { engine: string; fromFr: string; toFr: string; fidelity: number; accepted: number }> = {};
try {
  for (const [code, name] of Object.entries(LANGS)) {
    results[code] = {};
    for (const engine of ENGINES) {
      const fwdPair = pairOf(engine, 'francais', name), backPair = pairOf(engine, name, 'francais');
      if (!mt.pairs.includes(fwdPair) || !mt.pairs.includes(backPair)) continue;
      const fwd = await translateAll(fwdPair, sentences);
      const back = await translateAll(backPair, fwd.translations);
      let fid = 0, ok = 0;
      sentences.forEach((fr, i) => {
        const t = fwd.translations[i], b = back.translations[i];
        const score = overlap(fr, b);
        fid += score;
        const bad = /\d/.test(t) || repetitive(t) || repetitive(b) || RELIGIOUS.some((w) => normalize(b).includes(w) && !normalize(fr).includes(w)) || score < MIN_SCORE
          || !!wrongLanguage(code, t, engine);
        if (!bad) ok++;
      });
      const r = { fidelity: Number((fid / sentences.length).toFixed(3)), accepted: Number((ok / sentences.length).toFixed(3)), msPerSentence: Math.round((fwd.ms + back.ms) / sentences.length), n: sentences.length };
      results[code][engine] = r;
      console.log(`${code} · ${engine} : fidélité ${r.fidelity} · acceptées ${Math.round(r.accepted * 100)} % · ${r.msPerSentence} ms/phrase`);
      const best = routes[code];
      if (r.accepted === 0) continue; // aucun moteur sans traduction acceptée : pas de route pour cette langue
      if (!best || r.accepted > best.accepted || (r.accepted === best.accepted && r.fidelity > best.fidelity)) {
        routes[code] = { engine, fromFr: fwdPair, toFr: backPair, fidelity: r.fidelity, accepted: r.accepted };
      }
    }
  }
} finally { stopMtService(); }

const root = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(`${root}eval`, { recursive: true });
writeFileSync(`${root}eval/mt-compare.json`, JSON.stringify({ measuredAt: new Date().toISOString(), sentences: sentences.length, method: 'aller-retour fr → langue → fr sur les réponses et définitions sans chiffre', results }, null, 1));
writeFileSync(`${root}mt-routes.json`, JSON.stringify({ chosenAt: new Date().toISOString(), rule: 'meilleure part de traductions acceptées par le garde-fou, puis meilleure fidélité', routes }, null, 1));
console.log('\nRoutes retenues :', Object.entries(routes).map(([k, r]) => `${k}=${r.engine}`).join(', '));
