// Génère les icônes PNG (Android 7 et moins) et les écrans de démarrage de l'APK à partir du logo de public/icon.svg,
// à la taille exacte de chaque fichier du projet Android. À relancer seulement si le logo change.
//   node make-icons.mjs        (nécessite Playwright et son navigateur : npx playwright install chromium)
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const res = fileURLToPath(new URL('./android/app/src/main/res/', import.meta.url));
const NAVY = '#0f172a', GOLD = '#a16207';
const M = 'M128 352V176l64 96 64-96 64 96 64-96v176';
const mark = (rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${GOLD}"/><path d="${M}" fill="none" stroke="#fff" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Taille (largeur, hauteur) d'un PNG, lue dans son en-tête. */
const sizeOf = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, html, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent">${html}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}

let n = 0;
for (const dir of readdirSync(res)) {
  for (const f of readdirSync(res + dir)) {
    const file = `${res}${dir}/${f}`;
    if (!f.endsWith('.png')) continue;
    const [w, h] = sizeOf(file);
    if (f === 'ic_launcher.png') await render(file, mark(112).replace('<svg', `<svg width="${w}" height="${h}"`), w, h);
    else if (f === 'ic_launcher_round.png') await render(file, mark(256).replace('<svg', `<svg width="${w}" height="${h}"`), w, h);
    else if (f === 'splash.png') {
      const s = Math.round(Math.min(w, h) * 0.26);
      await render(file, `<div style="width:${w}px;height:${h}px;background:${NAVY};display:grid;place-items:center">${mark(112).replace('<svg', `<svg width="${s}" height="${s}"`)}</div>`, w, h);
    } else continue;
    n++;
  }
}
await browser.close();
console.log(`${n} images générées`);
