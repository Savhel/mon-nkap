// Génère des fichiers audio de test en français et en anglais avec Piper (voix SYNTHÉTIQUES).
// Ils testent le circuit voix → intention, pas la qualité de reconnaissance sur de vrais locuteurs :
// pour les langues nationales, il faut des enregistrements natifs (voir docs/TESTING.md).
import { writeFileSync } from 'node:fs';
import { synthesize } from '../src/voice/speech.ts';
import { fileURLToPath } from 'node:url';

const CASES: [string, string, string][] = [
  ['fr-solde', 'fr', 'Quel est le solde de mon compte ?'],
  ['fr-transfert', 'fr', 'Je veux envoyer cinq mille francs à Marie.'],
  ['fr-frais', 'fr', 'Combien coûtent les frais pour un transfert de vingt mille francs ?'],
  ['fr-historique', 'fr', 'Montre-moi mon historique.'],
  ['en-balance', 'en', 'What is my balance?'],
  ['en-transfer', 'en', 'Send two thousand francs to Aminatou.'],
];
const out = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const manifest = CASES.map(([id, lang, text]) => {
  const wav = synthesize(text, lang);
  if (!wav) throw new Error(`pas de voix ${lang}`);
  writeFileSync(`${out}${id}.wav`, wav);
  return { id, lang, text, synthetic: true };
});
writeFileSync(`${out}manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} fichiers`);
