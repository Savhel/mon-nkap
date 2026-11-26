// Synthèse à la demande des réponses de démonstration, avec la voix configurée pour la langue.
export function plotweaverLanguage(lang: string): string | undefined {
  if (!process.env.CT_PLOTWEAVER_KEY || !/^[a-z]{2,3}$/.test(lang)) return;
  const code = process.env[`CT_PLOTWEAVER_LANG_${lang.toUpperCase()}`];
  if (code && /^[a-zA-Z0-9_-]{2,20}$/.test(code)) return code;
}

export async function plotweaverSpeech(lang: string, text: string): Promise<{ audio: Buffer; mime: string } | null> {
  const language = plotweaverLanguage(lang);
  if (!language || !text || text.length > 600) return null;
  try {
    const response = await fetch('https://api.plotweaver.app/v1/speech', {
      method: 'POST',
      headers: { 'x-api-key': process.env.CT_PLOTWEAVER_KEY!, 'content-type': 'application/json' },
      body: JSON.stringify({ text, language }),
      redirect: 'error',
      signal: AbortSignal.timeout(6500),
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
    return size ? { audio: Buffer.concat(chunks), mime } : null;
  } catch { return null; }
}
