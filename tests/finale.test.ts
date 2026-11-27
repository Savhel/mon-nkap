import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import { createApp } from '../src/api/server.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { UssdChannel, USSD_IDLE_MS } from '../src/channels/ussd.ts';
import { Engine, type EngineResult } from '../src/core/engine.ts';

process.env.CT_ALLOW_DRAFT = '1';

test('Finale : transfert en fulfulde, montant libre, correction, même opération sur mobile, web et USSD', async (t) => {
  const { server, engine } = createApp(undefined, { auditFile: null, keysFile: null, connectorsFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: object) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const trial = '25af10b15c01';
  const amount = 6200 + Number.parseInt(randomUUID().slice(0, 3), 16) % 1800;
  const correctedAmount = amount - 725;
  const request = `a yidi yerbinego ${amount} FCFA ha Marie na`;
  const correction = `non plutôt ${correctedAmount} FCFA`;
  const operations = [];

  for (const channel of ['mobile', 'web'] as const) {
    const sessionId = `finale-${channel}`;
    const message = async (text: string) => (await post('/v1/message', { sessionId, channel, text, lang: 'fub', trial })).json() as Promise<EngineResult>;
    const confirm = (turn: EngineResult) => post('/v1/confirm', { sessionId, channel, token: turn.canonical.confirmationToken, trial });
    const initial = await message(request);
    assert.equal(initial.status, 'awaiting_confirmation');
    assert.equal(initial.params.amount, amount);
    const revised = await message(correction);
    assert.equal(revised.status, 'awaiting_confirmation');
    assert.equal(revised.params.amount, correctedAmount);
    assert.equal((await confirm(initial)).status, 409);
    const responses = await Promise.all([confirm(revised), confirm(revised)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const receipt = await responses.find((r) => r.ok)!.json() as EngineResult;
    assert.equal(receipt.status, 'executed');
    assert.equal(receipt.lang, 'fub');
    operations.push(receipt.canonical);
  }

  let text = '';
  const ussd = async (input?: string) => {
    if (input) text += (text ? '*' : '') + input;
    const response = await post('/ussd', { sessionId: 'finale-ussd', phoneNumber: '670000123', text, trial });
    assert.equal(response.status, 200);
    const screen = await response.text();
    assert.ok(screen.slice(4).length <= 182, screen);
    return screen;
  };
  const readPages = async (screen: string) => {
    while (screen.includes('\n98.')) screen = await ussd('98');
    return screen;
  };
  await ussd();
  await ussd('5');
  await readPages(await ussd(request));
  assert.equal(engine.log.at(-1)?.params.amount, amount);
  let screen = await readPages(await ussd(correction));
  assert.equal(engine.log.at(-1)?.params.amount, correctedAmount);
  assert.match(screen, /^CON /);
  screen = await readPages(await ussd('1'));
  assert.match(screen, /^END /);
  assert.equal(await ussd(), screen, 'un retry USSD retrouve le reçu');
  const receipt = engine.log.at(-1)!;
  assert.equal(receipt.status, 'executed');
  assert.equal(receipt.lang, 'fub');
  operations.push(receipt.canonical);

  const fee = 100;
  for (const op of operations) {
    assert.equal(op.operation, 'TRANSFER_MONEY');
    assert.equal(op.entities.amount, correctedAmount);
    assert.equal(op.entities.fee, fee);
    assert.equal(op.entities.beneficiary?.phone, '655778899');
  }
  const balance = await (await post('/v1/message', { sessionId: 'no-trial', channel: 'web', text: 'solde' })).json() as EngineResult;
  const journal = await (await fetch(base + '/v1/events?trial=' + trial)).json() as EngineResult[];
  assert.ok(journal.every((event) => event.trial === trial && !event.canonical.confirmationToken));
  assert.deepEqual(journal.filter((event) => event.status === 'executed').map((event) => event.channel).sort(), ['mobile', 'ussd', 'web']);
  assert.equal(balance.params.balance, 150000 - 3 * (correctedAmount + fee));
});

test('Un récapitulatif USSD expire et ne confirme jamais une version modifiée sur web', async (t) => {
  const clock = t.mock.method(Date, 'now', () => 1000);
  const engine = new Engine(new MockBackend());
  const channel = new UssdChannel(engine, { continuity: true });
  const step = (sessionId: string, phoneNumber: string, text: string) => channel.handle({ sessionId, phoneNumber, text });
  for (const [id, phone] of [['expired', '670000124'], ['changed', '670000125']]) {
    await step(id, phone, '');
    await step(id, phone, '1');
    assert.equal((await step(id, phone, '1*envoie 5000 à Marie')).result?.status, 'awaiting_confirmation');
    if (id === 'expired') {
      clock.mock.mockImplementation(() => 1000 + USSD_IDLE_MS);
      assert.match((await step(id, phone, '1*envoie 5000 à Marie*1')).response, /^END Session expirée/);
    } else {
      const amended = await engine.handle({ sessionId: `user:${phone}`, channel: 'web', text: 'non plutôt 4000' });
      assert.equal(amended.status, 'awaiting_confirmation');
      assert.match((await step(id, phone, '1*envoie 5000 à Marie*1')).response, /^END Récapitulatif expiré ou modifié/);
    }
  }
  assert.equal(engine.log.filter((r) => r.status === 'executed').length, 0);
});

test('Jeton borné à son institution et confirmation vocale soumise au récapitulatif', async () => {
  const engine = new Engine(new MockBackend());
  const sessionId = 'same-session';
  const initial = await engine.handle({ sessionId, channel: 'mobile', text: 'envoie 5000 à Marie', institution: 'gifa' });
  assert.equal(initial.status, 'awaiting_confirmation');
  const other = await engine.confirmWithToken(sessionId, initial.canonical.confirmationToken!, 'web', 'autre');
  assert.deepEqual(other, { error: 'jeton_invalide' });
  const spoken = await engine.handle({ sessionId, channel: 'mobile', text: 'oui', institution: 'gifa', input: 'voice' });
  assert.equal(spoken.status, 'awaiting_confirmation');
  assert.equal(engine.log.filter((r) => r.status === 'executed').length, 0);
});

test('Le catalogue distingue la collecte du parcours guidé et des montants en mode mixte', async (t) => {
  const { server } = createApp(new Engine(new MockBackend()), { auditFile: null, keysFile: null });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(base + '/v1/languages');
  assert.equal(response.status, 200);
  const result = await response.json();
  const language = (code: string) => result.languages.find((entry: { code: string }) => entry.code === code).experience;
  for (const code of ['fub', 'ewo', 'dua', 'bas', 'bum', 'wes']) assert.ok(result.demoLanguages.includes(code));
  assert.equal(language('fub').banking, 'collected');
  assert.equal(language('fub').clips, true);
  assert.equal(language('wes').clips, true);
  assert.equal(language('ewo').banking, 'guided');
  assert.equal(language('dua').banking, 'guided');
  assert.equal(language('bas').banking, 'mixed');
  assert.equal(language('bas').asr, true);
  assert.equal(language('bas').microphone, result.runtime.speechToText);
  assert.equal(language('bum').banking, language('bum').translation ? 'translation' : 'mixed');
  const fetchReal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (request: string, options?: RequestInit) => request.endsWith('/pairs')
    ? Promise.resolve(Response.json({ pairs: ['ghomala-francais', 'francais-ghomala', 'yemba-francais'] }))
    : fetchReal(request, options));
  const withModels = await (await fetch(base + '/v1/languages')).json();
  assert.ok(withModels.demoLanguages.includes('bbj'));
  assert.ok(!withModels.demoLanguages.includes('ybb'), 'les deux directions sont nécessaires');
});

test('Ewondo et duala : le mot de transfert du lexique prépare un récapitulatif chiffré', async () => {
  const engine = new Engine(new MockBackend());
  for (const [lang, text] of [['ewo', 'lóm mɔ́nə 6325 à Marie'], ['dua', 'lóma mɔ́ni 6325 à Marie']]) {
    const turn = await engine.handle({ sessionId: 'guided-' + lang, lang, channel: 'web', text });
    assert.equal(turn.lang, lang);
    assert.equal(turn.understanding.via, 'lexicon');
    assert.equal(turn.status, 'awaiting_confirmation');
    assert.equal(turn.canonical.entities.amount, 6325);
    assert.equal(turn.canonical.entities.beneficiary?.phone, '655778899');
    assert.ok(turn.reply.quality === 'draft' || turn.reply.quality === 'fallback');
  }
});

test('Une correction avec deux numéros annule le premier récapitulatif et demande un choix', async () => {
  const backend = new MockBackend();
  const engine = new Engine(backend);
  const sessionId = 'trial-two-phones';
  const turn = (text: string) => engine.handle({ sessionId, channel: 'web', text });
  const original = await turn('envoie 6500 à Marie');
  assert.equal(original.status, 'awaiting_confirmation');
  const ambiguous = await turn('non plutôt au 677112233 ou au 655778899');
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.equal(ambiguous.canonical.confirmationToken, undefined);
  assert.equal(ambiguous.reply.menu?.length, 2);
  assert.deepEqual(await engine.confirmWithToken(sessionId, original.canonical.confirmationToken!, 'web'), { error: 'jeton_invalide' });
  const chosen = await turn('677112233');
  assert.equal(chosen.status, 'awaiting_confirmation');
  assert.equal(chosen.canonical.entities.beneficiary?.phone, '677112233');
  assert.equal(chosen.canonical.entities.amount, 6500);
  const balance = await backend.getBalance('demo');
  assert.equal(balance.value.balance, 150000);
});

test('Les montants documentés alimentent le récapitulatif en ewondo, duala, basaa et bulu', async () => {
  const engine = new Engine(new MockBackend());
  const requests = [
    ['ewo', 'lóm mɔ́nə àkúdà à Marie', 1000],
    ['ewo', 'lóm mɔ́nə bàkúdà bəbɛ à Marie', 2000],
    ['dua', 'lóma mɔ́ni lokoli loba na bebwea betanu à Marie', 2500],
    ['dua', 'lóma mɔ́ni lokoli lotanu à Marie', 5000],
    ['bas', 'envoie hikóó à Marie', 1000],
    ['bum', 'envoie tɔ́jínì ébae à Marie', 2000],
  ] as const;
  for (const [i, [lang, text, amount]] of requests.entries()) {
    const turn = await engine.handle({ sessionId: 'numbers-' + i, channel: 'api', lang, text });
    assert.equal(turn.status, 'awaiting_confirmation', text);
    assert.equal(turn.lang, lang, text);
    assert.equal(turn.params.amount, amount, text);
    assert.equal(turn.canonical.entities.beneficiary?.phone, '655778899');
  }
  const ambiguous = await engine.handle({ sessionId: 'numbers-incomplete', channel: 'api', lang: 'ewo', text: 'lóm mɔ́nə tɔɡsin i zzzz à Marie' });
  assert.equal(ambiguous.status, 'needs_clarification');
  assert.equal(ambiguous.params.amount, undefined);
  assert.equal(engine.log.filter((turn) => turn.status === 'executed').length, 0);
});

test('En bulu, l’annonce traduite reste séparée des valeurs bancaires exactes', async (t) => {
  const requests: { pair: string; texts: string[] }[] = [];
  const reference = 'Vérifiez les informations du transfert avant de confirmer.';
  const scriptedTranslation = 'Texte de test du fournisseur simulé';
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    const input = JSON.parse(String(options?.body)) as { pair: string; texts: string[] };
    requests.push(input);
    return Response.json({ translations: [input.pair === 'francais-bulu' ? scriptedTranslation : reference], ms: 1 });
  });
  const engine = new Engine(new MockBackend());
  const turn = await engine.handle({ sessionId: 'bulu-intro', lang: 'bum', channel: 'mobile', text: 'envoie tɔ́jínì ébae à Marie' });
  assert.equal(turn.status, 'awaiting_confirmation');
  assert.deepEqual(turn.reply.localizedIntro, { text: scriptedTranslation, engine: 'flagship:francais-bulu' });
  assert.equal(turn.reply.quality, 'fallback');
  assert.match(turn.reply.text, /2 000/);
  assert.equal(turn.params.amount, 2000);
  assert.equal(turn.params.fee, 100);
  assert.ok(requests.every((request) => request.texts.every((text) => !/\d|Marie/.test(text))));
});

test('Un transfert en pidgin vers un numéro dicté garde le montant et les neuf chiffres dans le récapitulatif', async () => {
  const engine = new Engine(new MockBackend());
  const result = await engine.handle({
    sessionId: 'pidgin-dictation', channel: 'mobile', lang: 'wes',
    text: 'a wan send twenty five tasen for six five five seven seven eight eight nine nine',
  });
  assert.equal(result.status, 'awaiting_confirmation');
  assert.equal(result.params.amount, 25000);
  assert.equal(result.canonical.entities.beneficiary?.phone, '655778899');
});

test('Les formulations de la collecte indiquent une consultation, une explication ou un refus explicite', async () => {
  const engine = new Engine(new MockBackend());
  const turn = (sessionId: string, text: string, lang = 'fub') => engine.handle({ sessionId, channel: 'mobile', lang, text });
  assert.equal((await turn('solde-fub', 'a done mari dallah noy')).intent, 'balance');
  assert.equal((await turn('historique-fub', 'a yidi larougo tchede dje a yerbi be dje be yerbine ma daga boye ma na')).intent, 'history');
  const glossary = await turn('frais-fub', 'frais do ba wigonoy');
  assert.equal(glossary.intent, 'explain_term');
  assert.equal(glossary.params.term, 'fees');
  const quote = await turn('devis-fub', 'envoie 5000 à Marie');
  assert.equal(quote.status, 'awaiting_confirmation');
  const refusal = await turn('devis-fub', 'mi yida yerbougo');
  assert.equal(refusal.status, 'cancelled');
  assert.deepEqual(await engine.confirmWithToken('devis-fub', quote.canonical.confirmationToken!, 'web'), { error: 'jeton_invalide' });
  const language = await turn('langue-wes', 'tok for me for my contry tok', 'wes');
  assert.equal(language.intent, 'language_switch');
  assert.equal(language.status, 'needs_clarification');
});

test('« Lequel ? » ne bloque pas : un terme s’explique sans perdre le transfert, une autre demande prend la main', async () => {
  const engine = new Engine(new MockBackend());
  const ask = (text: string) => engine.handle({ sessionId: 'choix', channel: 'ussd', lang: 'fr', text });
  assert.equal((await ask('envoie 5000 à Paul')).status, 'needs_clarification');
  const term = await ask('c’est quoi les frais ?');
  assert.equal(term.intent, 'explain_term');
  assert.equal((await ask('1')).status, 'awaiting_confirmation');        // le choix en cours est toujours là
  assert.equal((await ask('envoie 5000 à Paul')).status, 'needs_clarification');
  const balance = await ask('quel est mon solde');
  assert.equal(balance.intent, 'balance');
  assert.equal(engine.log.filter((t) => t.status === 'executed').length, 0);
});
