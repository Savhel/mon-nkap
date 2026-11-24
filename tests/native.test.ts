// Voix native par enregistrements assemblés. On simule ici des « enregistrements ewondo » avec la
// voix française de synthèse, UNIQUEMENT pour vérifier la mécanique (ordre, montants, repli) :
// rien de cela n'est livré ni présenté comme de l'ewondo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'ct-audio-'));
process.env.CT_AUDIO_DIR = dir;
const { amountClips, speechPlan, coverage, PHRASES, missingClips } = await import('../src/voice/native.ts');
const speech = await import('../src/voice/speech.ts');
const { Engine } = await import('../src/core/engine.ts');
const { MockBackend } = await import('../src/backend/mock.ts');
const { IvrChannel } = await import('../src/channels/ivr.ts');
const { createApp } = await import('../src/api/server.ts');
after(() => rmSync(dir, { recursive: true, force: true }));

test('Montants décomposés en parties enregistrables', () => {
  assert.deepEqual(amountClips(5000), ['n_5000', 'fcfa']);
  assert.deepEqual(amountClips(144900), ['n_100000', '?n_and', 'n_40000', '?n_and', 'n_4000', '?n_and', 'n_900', 'fcfa']);
  assert.deepEqual(amountClips(2_000_000), ['n_unsupported']);
  // Chaque morceau produit existe dans le catalogue à enregistrer.
  const keys = new Set(PHRASES.map((p) => p.key));
  for (const n of [1, 15, 100, 5100, 150000, 999999]) for (const k of amountClips(n)) assert.ok(keys.has(k.replace('?', '')), k);
});

test('Le plan d’une confirmation de transfert ne contient que des clés du catalogue', () => {
  const plan = speechPlan({ kind: 'confirm_transfer', amount: 5000, fee: 100, total: 5100, beneficiary: 'Marie Ngo Bassa', phone: '655778899' }, 'ewo');
  assert.deepEqual(plan, ['confirm_send', 'n_5000', 'fcfa', 'word_to', 'name_marie_ngo_bassa', 'word_fee', 'n_100', 'fcfa', 'word_total', 'n_5000', '?n_and', 'n_100', 'fcfa', 'confirm_q']);
  const keys = new Set(PHRASES.map((p) => p.key));
  for (const k of plan) assert.ok(keys.has(k.replace('?', '')), k);
});

test('Une langue peut changer l’ordre des morceaux sans toucher au code (plans.json)', () => {
  mkdirSync(join(dir, 'dua'), { recursive: true });
  writeFileSync(join(dir, 'dua', 'plans.json'), JSON.stringify({ balance: ['$balance', 'balance_is'] }));
  assert.deepEqual(speechPlan({ kind: 'balance', balance: 5000 }, 'dua'), ['n_5000', 'fcfa', 'balance_is']);
});

test('Sans enregistrement : rien n’est joué, le serveur vocal garde son repli français annoncé', async () => {
  const ivr = new IvrChannel(new Engine(new MockBackend()));
  ivr.start('a'); await ivr.step('a', { digits: '5' }); // fulfulde, rien d'enregistré
  const r = await ivr.step('a', { speech: 'envoie 5000 a Marie' });
  assert.equal(r.nativeVoice, false);
  assert.ok(r.prompts.every((p) => !p.clips && p.voice === 'fr'));
  assert.ok(missingClips('fub', r.result!.reply.speech).length > 0);
});

const hasTts = speech.ttsAvailable('fr');
test('Avec les enregistrements : le serveur vocal parle avec eux, assemblés dans le bon ordre', { skip: !hasTts && 'voix fr absente' }, async () => {
  // Faux « enregistrements » (voix française de synthèse) pour la seule mécanique de test.
  mkdirSync(join(dir, 'ewo'), { recursive: true });
  const fr = Object.fromEntries(PHRASES.map((p) => [p.key, p.fr.replace(/…/g, ' ')]));
  for (const k of ['ivr_speak', 'ivr_again', 'confirm_send', 'n_5000', 'n_100', 'fcfa', 'word_to', 'name_marie_ngo_bassa', 'word_fee', 'word_total', 'confirm_q', 'press_1_confirm', 'press_2_cancel']) {
    writeFileSync(join(dir, 'ewo', `${k}.wav`), speech.synthesize(fr[k], 'fr')!);
  }
  const ivr = new IvrChannel(new Engine(new MockBackend()));
  ivr.start('b');
  const intro = await ivr.step('b', { digits: '3' });
  assert.equal(intro.nativeVoice, true);
  assert.deepEqual(intro.prompts.map((p) => p.clips), [['ivr_speak']]);
  const r = await ivr.step('b', { speech: 'envoie 5000 a Marie' });
  assert.equal(r.nativeVoice, true);
  assert.equal(r.prompts[0].voice, 'ewo');
  assert.deepEqual(r.prompts[1].clips, ['press_1_confirm', 'press_2_cancel']);

  // L'audio assemblé, réécouté par la reconnaissance vocale, redit bien le montant et le nom.
  const { server } = createApp(new Engine(new MockBackend()));
  await new Promise<void>((ok) => server.listen(0, ok));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const wav = await fetch(`${base}/v1/native?lang=ewo&clips=${r.prompts[0].clips!.join(',')}`);
    assert.equal(wav.status, 200);
    const heard = (await speech.transcribe(new Uint8Array(await wav.arrayBuffer()))).text;
    // La reconnaissance varie un peu d'un essai à l'autre (« cinqt mille ») : on vérifie que les
    // repères attendus apparaissent DANS L'ORDRE, en tolérant au plus un repère mal entendu.
    // (« cent », mot très court, ressort parfois « cant » ou « cint ».)
    // Plus longue suite de repères trouvés DANS L'ORDRE (alignement), et non une recherche gloutonne qui, après
    // un repère mal entendu, sauterait à une occurrence plus loin et en perdrait plusieurs.
    const marks = [/^envoyer/, /^mille/, /^c[aei]n?t$/, /^total/, /^mille/, /^c[aei]n?t$/, /^confirm/];
    const words = heard.split(/\s+/);
    const L: number[][] = Array.from({ length: marks.length + 1 }, () => new Array(words.length + 1).fill(0));
    for (let i = 1; i <= marks.length; i++) for (let j = 1; j <= words.length; j++) {
      L[i][j] = marks[i - 1].test(words[j - 1]) ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
    const found = L[marks.length][words.length];
    assert.ok(found >= marks.length - 1, `ordre ou contenu inattendu (${found}/${marks.length}) : « ${heard} »`);
    const miss = await fetch(`${base}/v1/native?lang=ewo&clips=balance_is,n_5000,fcfa`);
    assert.equal(miss.status, 404);
    assert.deepEqual((await miss.json()).missing, ['balance_is']);
    const cov = coverage('ewo');
    assert.equal(cov.recorded, 13);
    assert.ok(cov.missingPriority1.includes('balance_is'));
  } finally { server.close(); }
});
