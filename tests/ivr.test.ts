// Serveur vocal : choix de langue au clavier, demande parlée, confirmation au clavier.
// Règle vérifiée : aucune invite n'est jamais lue avec une voix d'une autre langue que la sienne.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { IvrChannel, speakable, toAfricasTalkingXml, type IvrTurn } from '../src/channels/ivr.ts';
import { ttsAvailable, synthesize, transcribe } from '../src/voice/speech.ts';
import { createApp } from '../src/api/server.ts';

let backend: MockBackend, engine: Engine, ivr: IvrChannel;
beforeEach(() => { backend = new MockBackend(); engine = new Engine(backend); ivr = new IvrChannel(engine); });
const voicesOk = (t: IvrTurn) => t.prompts.every((p) => p.voice === 'fr' || p.voice === 'en');

test('IVR : montants et numéros rendus prononçables sans changer les chiffres', () => {
  assert.equal(speakable('Envoyer 5 000 FCFA à Marie (655778899).', 'fr'), 'Envoyer 5000 francs CFA à Marie, 6 55 77 88 99.');
  assert.match(speakable('Send 12,500 FCFA', 'en'), /12500 CFA francs/);
});

test('IVR français : transfert parlé puis confirmé par la touche 1', async () => {
  const s = 'c1';
  assert.equal(ivr.start(s).expect, 'digits');
  const intro = await ivr.step(s, { digits: '1' });
  assert.equal(intro.expect, 'speech');
  const a = await ivr.step(s, { speech: 'je veux envoyer cinq mille francs à marie' });
  assert.equal(a.result?.status, 'awaiting_confirmation');
  assert.equal(a.expect, 'digits');
  assert.match(a.prompts.map((p) => p.text).join(' '), /5000 francs CFA.*Tapez 1 pour confirmer/s);
  const b = await ivr.step(s, { digits: '1' });
  assert.equal(b.result?.status, 'executed');
  assert.equal(b.result?.channel, 'ivr');
  assert.equal(b.result?.transaction?.amount, 5000);
});

test('IVR ewondo : compris en ewondo, jamais lu avec une voix ewondo inventée ; l’appelant est prévenu', async () => {
  const s = 'c2';
  ivr.start(s);
  const intro = await ivr.step(s, { digits: '3' });
  assert.equal(intro.lang, 'ewo');
  if (!ttsAvailable('ewo')) {
    assert.equal(intro.nativeVoice, false);
    assert.match(intro.prompts[0].text, /seront lues en français/);
  }
  const a = await ivr.step(s, { speech: 'envoie 2000 a Aminatou' });
  assert.ok(voicesOk(intro) && voicesOk(a));
  assert.equal(a.result?.lang, 'ewo');
  assert.equal(a.result?.params.amount, 2000);
  // Ce qui est lu est l'équivalent français exact, pas le texte ewondo.
  assert.ok(!a.prompts[0].text.includes('Mɔ́nə'));
  assert.match(a.prompts[0].text, /2000 francs CFA/);
});

test('IVR : ambiguïté « Paul » résolue au clavier, numéros lus par paires', async () => {
  const s = 'c3'; ivr.start(s); await ivr.step(s, { digits: '1' });
  const a = await ivr.step(s, { speech: 'envoie 1000 a paul' });
  assert.equal(a.expect, 'digits');
  assert.match(a.prompts.at(-1)!.text, /Tapez 1 pour Paul Mbarga\. Tapez 2 pour Paul Ekwalla\./);
  const b = await ivr.step(s, { digits: '2' });
  assert.equal(b.result?.params.beneficiary, 'Paul Ekwalla');
});

test('IVR : XML Africa’s Talking avec nos propres fichiers audio, échappé', () => {
  const xml = toAfricasTalkingXml({ prompts: [{ text: 'Solde & frais', voice: 'fr' }], expect: 'digits' }, 'https://exemple.cm', 'https://exemple.cm/ivr/at');
  assert.match(xml, /<GetDigits [^>]*callbackUrl="https:\/\/exemple.cm\/ivr\/at"><Play url="https:\/\/exemple.cm\/v1\/tts\?lang=fr&amp;text=Solde%20%26%20frais"\/><\/GetDigits>/);
  assert.match(toAfricasTalkingXml({ prompts: [], expect: 'speech' }, 'https://x', 'https://x/cb'), /<Record [^>]*playBeep="true"/);
});

const hasVoice = ttsAvailable('fr') && existsSync(new URL('../models/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12/model.int8.onnx', import.meta.url));

test('IVR voix réelle : l’invite synthétisée redit bien le montant (aller-retour TTS → ASR)', { skip: !hasVoice && 'modèles absents' }, async () => {
  const wav = synthesize(speakable('Vous allez envoyer 5 000 FCFA à Marie.', 'fr'), 'fr')!;
  const back = await transcribe(wav);
  assert.match(back.text, /cinq mille/);
});

test('IVR voix réelle de bout en bout par l’API : audio → transcription → confirmation', { skip: !hasVoice && 'modèles absents' }, async () => {
  const { server } = createApp(new Engine(new MockBackend()));
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const post = async (q: string, body?: Buffer) => (await fetch(`${base}/v1/ivr?sessionId=v1&${q}`, { method: "POST", body: body ? new Blob([new Uint8Array(body)]) : undefined })).json();
    await post('action=start');
    await post('digits=1');
    const r = await post('', readFileSync(new URL("./fixtures/fr-transfert.wav", import.meta.url)));
    assert.ok(r.transcript.text.length > 0);
    assert.equal(r.result.intent, 'transfer');
    assert.equal(r.result.params.amount, 5000);
    assert.equal(r.expect, 'digits');
    assert.ok(r.prompts.every((p: { audio: string }) => /^\/v1\/tts\?lang=(fr|en)&/.test(p.audio)));
  } finally { server.close(); }
});
