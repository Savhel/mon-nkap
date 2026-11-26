import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { asrStatus, transcribe } from '../src/voice/speech.ts';

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

test('Le fournisseur vocal reçoit un WAV borné et le code Meta de la langue attendue', { skip: !ffmpeg && 'ffmpeg absent' }, async (t) => {
  const calls: string[] = [];
  const model = 'omniASR_LLM_300M_v2';
  const service = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ model, languageConditioning: true }));
    calls.push(req.url ?? '');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const audio = Buffer.concat(chunks);
    assert.equal(req.headers['content-type'], 'audio/wav');
    assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
    assert.equal(audio.readUInt32LE(24), 16000);
    const languageHint = new URL(req.url!, 'http://local').searchParams.get('lang');
    res.end(JSON.stringify({ text: 'montant test', model, languageHint }));
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  const previous = process.env.CT_ASR_LLM_URL;
  process.env.CT_ASR_LLM_URL = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
  t.after(() => {
    if (previous === undefined) delete process.env.CT_ASR_LLM_URL;
    else process.env.CT_ASR_LLM_URL = previous;
    service.close();
  });
  assert.equal((await asrStatus()).conditioned, model);
  const audio = readFileSync(new URL('./fixtures/fr-solde.wav', import.meta.url));
  for (const [locale, expected] of [['fub', 'fub_Latn'], ['ewo', 'ewo_Latn'], ['dua', 'dua_Latn'], ['bas', 'bas_Latn'], ['bum', 'bum_Latn']]) {
    const transcript = await transcribe(audio, locale);
    assert.equal(transcript.languageHint, expected);
    assert.equal(transcript.engine, model);
  }
  assert.equal(calls.length, 5);
});
