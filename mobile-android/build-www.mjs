// Prépare les pages embarquées dans l'APK (dossier www/) à partir de public/ : une seule source pour le web
// et pour l'application installée.
//   MONNKAP_SERVER=http://192.168.1.20:8080 node build-www.mjs   (adresse proposée au premier lancement, facultative)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const www = fileURLToPath(new URL('./www/', import.meta.url));
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const f of ['sdk.js', 'assistant.js', 'assistant.css', 'tokens.css', 'icon.svg']) copyFileSync(pub + f, www + f);

// Page d'accueil = page mobile, avec la configuration de l'application installée chargée en premier.
// Le manifeste et le service worker sont propres au site web : inutiles dans l'APK.
const html = readFileSync(pub + 'mobile.html', 'utf8')
  .replace('<link rel="manifest" href="/manifest.webmanifest">\n', '')
  .replace('<script src="/sdk.js"></script>', '<script src="/config.js"></script>\n<script src="/sdk.js"></script>');
if (!html.includes('/config.js')) throw new Error('mobile.html : point d’insertion de config.js introuvable');
writeFileSync(www + 'index.html', html);

const server = (process.env.MONNKAP_SERVER ?? '').trim();
writeFileSync(www + 'config.js', `window.MONNKAP_CONFIG = ${JSON.stringify({ server })};\n`);
console.log(`www/ prêt${server ? ` (serveur proposé : ${server})` : ' (adresse du serveur demandée au premier lancement)'}`);
