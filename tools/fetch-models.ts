// Télécharge les modèles vocaux depuis les releases officielles de Sherpa-ONNX (GitHub).
// Aucun modèle n'est versionné dans le dépôt. Usage : npm run models [-- --with-1b]
//
// | Modèle | Licence | Rôle |
// | Omnilingual ASR CTC 300M int8 (Meta) | Apache-2.0 | voix → texte, 1 600+ langues dont 17 des 20 du catalogue |
// | Piper fr_FR siwis medium | jeu de données CC-BY 4.0 (affiné depuis la voix lessac : vérifier avant production) | voix française |
// | Piper en_US amy low | jeu de données mimic3 (voir MODEL_CARD) | voix anglaise |

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';
const MODELS = [
  'asr-models/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12',
  'tts-models/vits-piper-fr_FR-siwis-medium',
  'tts-models/vits-piper-en_US-amy-low',
];
if (process.argv.includes('--with-1b')) MODELS.push('asr-models/sherpa-onnx-omnilingual-asr-1600-languages-1B-ctc-int8-2025-11-12');

const dir = fileURLToPath(new URL('../models/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const m of MODELS) {
  const name = m.split('/')[1];
  if (existsSync(join(dir, name))) { console.log(`déjà présent : ${name}`); continue; }
  console.log(`téléchargement : ${name}`);
  execFileSync('curl', ['-fL', '--retry', '3', '-o', join(dir, `${name}.tar.bz2`), `${BASE}/${m}.tar.bz2`], { stdio: 'inherit' });
  execFileSync('tar', ['xjf', `${name}.tar.bz2`], { cwd: dir, stdio: 'inherit' });
  execFileSync('rm', [`${name}.tar.bz2`], { cwd: dir });
}
