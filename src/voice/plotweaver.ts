// Synthèse à la demande des réponses de démonstration, avec la voix configurée pour la langue.
export function plotweaverLanguage(lang: string): string | undefined {
  if (!process.env.CT_PLOTWEAVER_KEY || !/^[a-z]{2,3}$/.test(lang)) return;
  const code = process.env[`CT_PLOTWEAVER_LANG_${lang.toUpperCase()}`];
  if (code && /^[a-zA-Z0-9_-]{2,20}$/.test(code)) return code;
}

/**
 * Ce que la voix de synthèse peut dire : la phrase sans aucun chiffre. Essayé sur nos réponses,
 * « 125 000 FCFA » est sauté en ewondo, inintelligible en fulfulde et douteux en pidgin. Les montants,
 * numéros et références sont retirés (ils restent affichés à l'écran) ; null s'il ne reste rien à dire.
 */
export function speakable(text: string): { text: string; omitted: boolean } | null {
  const cleaned = text
    .replace(/(?=[^\s().,;:!?]*\d)(?=[^\s().,;:!?]*\p{L})[^\s().,;:!?]+/gu, ' ')   // références : TX9A2B, 5000F…
    .replace(/\(?\+?\d[\d\s.,\u00a0\u202f]*(?:\s*(?:FCFA|XAF|F|frs?)\b)?\)?/gi, ' ')
    .replace(/\S*\d\S*/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*[:,;]\s*(?=[.!?]|$)/g, '')   // « Frais : . » → « Frais. » (l'espace française avant « ? » reste)
    .replace(/\s+([.,])/g, '$1')
    .replace(/^[\s.,;:]+/, '')
    .trim();
  if (/\d/.test(cleaned) || !/\p{L}{2,}/u.test(cleaned)) return null;
  return { text: cleaned, omitted: /\d/.test(text) };
}

export async function plotweaverSpeech(lang: string, text: string): Promise<{ audio: Buffer; mime: string; omitted: boolean } | null> {
  const language = plotweaverLanguage(lang);
  const said = text && text.length <= 600 ? speakable(text) : null;
  if (!language || !said) return null;
  try {
    const response = await fetch('https://api.plotweaver.app/v1/speech', {
      method: 'POST',
      headers: { 'x-api-key': process.env.CT_PLOTWEAVER_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify({ text: said.text, language }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!response.ok || !response.body || !['audio/mpeg', 'audio/wav'].includes(mime)) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) return null;
      chunks.push(chunk);
    }
    return size ? { audio: Buffer.concat(chunks), mime, omitted: said.omitted } : null;
  } catch { return null; }
}

// Reconnaissance vocale PlotWeaver : seulement là où leur catalogue l'annonce et où elle s'est montrée
// meilleure que notre modèle local sur les voix des natifs (pidgin : « a wan know ma balance » compris, contre
// « awanumabalans » en local). CT_PLOTWEAVER_ASR=0 la coupe. L'audio part chez PlotWeaver : démonstration seulement.
const ASR_CODES = new Set(['pcm']);
export function plotweaverAsrLanguage(lang: string): string | undefined {
  const code = plotweaverLanguage(lang);
  return code && ASR_CODES.has(code) && process.env.CT_PLOTWEAVER_ASR !== '0' ? code : undefined;
}

export async function plotweaverTranscribe(lang: string, wav: Uint8Array): Promise<string | null> {
  const language = plotweaverAsrLanguage(lang);
  if (!language) return null;
  try {
    const form = new FormData();
    form.set('file', new Blob([Uint8Array.from(wav)], { type: 'audio/wav' }), 'demande.wav');
    form.set('language', language);
    const response = await fetch('https://api.plotweaver.app/v1/transcriptions', {
      method: 'POST', headers: { 'x-api-key': process.env.CT_PLOTWEAVER_KEY! }, body: form,
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { text?: unknown };
    return typeof payload.text === 'string' && payload.text.trim() && payload.text.length <= 1500 ? payload.text.trim() : null;
  } catch { return null; }
}
