// Apprentissage des expressions-clés à partir des phrases des natifs, avec une langue FICTIVE (mots inventés).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnPhrases } from '../src/linguistics/runtime.ts';
import { learnGrammar } from '../src/linguistics/numbers.ts';
import type { LangPack } from '../src/linguistics/pack.ts';

const u = (situation: string, intent: string, text: string) =>
  ({ situation, intent, text, split: 'train' as const, author: 'Natif A', reviewer: 'Natif B', validated: true });

test('un mot présent dans au moins 3 intentions (« je veux ») ne devient pas un mot-clé', () => {
  const pack = {
    schema: 'ct-langpack.v1', lang: 'zz', generatedAt: '', source: 'test', numbers: [], concepts: {}, responses: {}, definitions: {}, rejected: [],
    utterances: [
      u('tr1', 'TRANSFER_MONEY', 'mo vudi velaka kilo'), u('tr2', 'TRANSFER_MONEY', 'mo vudi velaka pira'),
      u('tr3', 'TRANSFER_MONEY', 'mo vudi velaka sambo'), u('bal1', 'CONSULT_BALANCE', 'mo vudi kubora'),
      u('his1', 'VIEW_HISTORY', 'mo vudi pelora'),
    ],
  } as unknown as LangPack;
  const learned = learnPhrases(pack, learnGrammar([]));
  const phrases = learned.map((l) => l.phrase);
  assert.ok(phrases.includes('velaka'), JSON.stringify(learned));
  for (const p of phrases) assert.ok(!/\b(mo|vudi)\b/.test(p), `mot outil appris comme mot-clé : ${p}`);
});
