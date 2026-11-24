// Circuit complet voix → texte → intention, avec le vrai modèle Omnilingual ASR.
// Les fichiers audio sont des voix de synthèse (Piper) : ce test vérifie le circuit, pas la
// précision sur de vrais locuteurs. Ignoré si les modèles ne sont pas téléchargés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from '../src/api/server.ts';
import { ASR_MODEL } from '../src/voice/speech.ts';

const hasModel = existsSync(new URL(`../models/${ASR_MODEL}/model.int8.onnx`, import.meta.url));
const fixture = (id: string) => readFileSync(new URL(`./fixtures/${id}.wav`, import.meta.url));

test('API voix : solde, transfert, frais (fr) et balance (en)', { skip: !hasModel && 'modèles absents (npm run models)' }, async () => {
  const { server } = createApp();
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const post = async (id: string, lang: string, sid: string) =>
    (await fetch(`http://localhost:${port}/v1/voice?sessionId=${sid}&lang=${lang}&channel=ivr`, { method: 'POST', body: fixture(id) })).json();
  try {
    const cases: [string, string, string, Record<string, number | string>][] = [
      ['fr-solde', 'fr', 'balance', { balance: 150000 }],
      ['fr-transfert', 'fr', 'transfer', { amount: 5000, beneficiary: 'Marie Ngo Bassa' }],
      ['fr-frais', 'fr', 'fees', { amount: 20000, fee: 200 }],
      ['fr-historique', 'fr', 'history', {}],
      ['en-balance', 'en', 'balance', { balance: 150000 }],
      ['en-transfer', 'en', 'transfer', { amount: 2000, beneficiary: 'Aminatou Bello' }],
    ];
    for (const [id, lang, intent, params] of cases) {
      const r = await post(id, lang, `v-${id}`);
      assert.ok(r.result, `${id}: rien reconnu (${r.transcript?.text})`);
      assert.equal(r.result.intent, intent, `${id}: « ${r.transcript.text} »`);
      for (const [k, v] of Object.entries(params)) assert.equal(r.result.params[k], v, `${id}.${k}: « ${r.transcript.text} »`);
    }
  } finally { server.close(); }
});

test('TTS : voix réelle en fr, refus explicite en langue nationale', { skip: !hasModel && 'modèles absents' }, async () => {
  const { server } = createApp();
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  try {
    const fr = await fetch(`http://localhost:${port}/v1/tts?lang=fr&text=Bonjour`);
    assert.equal(fr.status, 200);
    assert.equal(fr.headers.get('content-type'), 'audio/wav');
    const ewo = await fetch(`http://localhost:${port}/v1/tts?lang=ewo&text=Mbembe`);
    assert.equal(ewo.status, 404);
    assert.equal((await ewo.json()).error, 'voix_indisponible');
  } finally { server.close(); }
});
