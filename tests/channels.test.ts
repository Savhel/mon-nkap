// Canaux USSD et SMS : même moteur, même interprétation, mêmes montants que l'application et le web.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/core/engine.ts';
import { MockBackend } from '../src/backend/mock.ts';
import { UssdChannel, USSD_MAX } from '../src/channels/ussd.ts';
import { SmsChannel } from '../src/channels/sms.ts';

let backend: MockBackend, engine: Engine, ussd: UssdChannel, sms: SmsChannel;
beforeEach(() => { backend = new MockBackend(); engine = new Engine(backend); ussd = new UssdChannel(engine); sms = new SmsChannel(engine); });

/** Simule la passerelle : chaque saisie est ajoutée à `text` avec « * ». */
async function dial(sessionId: string, keys: string[]) {
  const screens: string[] = []; let last;
  for (let i = 0; i <= keys.length; i++) {
    last = await ussd.handle({ sessionId, phoneNumber: '+237677000000', text: keys.slice(0, i).join('*') });
    screens.push(last.response);
  }
  return { screens, last: last! };
}

test('USSD : premier écran = choix de la langue, chaque écran ≤ 182 caractères', async () => {
  const { screens } = await dial('u1', ['1', '1']);
  assert.match(screens[0], /^CON .*Français/s);
  assert.match(screens[1], /^CON /);
  for (const s of screens) assert.ok(s.length - 4 <= USSD_MAX, `écran trop long (${s.length}) : ${s}`);
});

test('USSD : solde en français → END avec le solde exact', async () => {
  const { last } = await dial('u2', ['1', '1']);
  assert.match(last.response, /^END /);
  assert.match(last.response, /150\s000 FCFA/);
  assert.equal(last.result?.intent, 'balance');
  assert.equal(last.result?.channel, 'ussd');
});

test('USSD : transfert complet par menus (2 → montant → bénéficiaire → 1) exécute la même opération', async () => {
  const { screens, last } = await dial('u3', ['1', '2', '5000', 'Marie', '1']);
  assert.match(screens[3], /^CON /);
  assert.match(screens[4], /^CON .*5\s000 FCFA.*Marie Ngo Bassa/s); // confirmation avant exécution
  assert.match(screens[4], /1\. /);
  assert.match(last.response, /^END /);
  assert.equal(last.result?.status, 'executed');
  assert.equal(last.result?.transaction?.amount, 5000);
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000 - 5000 - 100);
});

test('USSD : saisie libre au menu principal, ambiguïté « Paul » résolue par un numéro', async () => {
  const { screens, last } = await dial('u4', ['1', 'envoie 2000 a Paul', '2', '1']);
  assert.equal(screens[2].startsWith('CON'), true);
  assert.match(screens[2], /Paul Mbarga/);
  assert.match(screens[2], /Paul Ekwalla/);
  assert.equal(last.result?.status, 'executed');
  assert.equal(last.result?.params.beneficiary, 'Paul Ekwalla');
});

test('USSD : annulation par 2, rien n’est débité', async () => {
  const { last } = await dial('u5', ['1', 'envoie 5000 a Marie', '2']);
  assert.equal(last.result?.status, 'cancelled');
  const bal = await backend.getBalance('demo');
  assert.ok(bal.ok && bal.value.balance === 150000);
});

test('USSD : menus en ewondo (libellés Mboa) et en anglais', async () => {
  const ewo = await dial('u6', ['3']);
  const en = await dial('u7', ['2']);
  assert.notEqual(ewo.last.response, en.last.response);
  assert.match(en.last.response, /Balance/);
});

test('USSD : la pagination ne coupe jamais une ligne', async () => {
  const { last } = await dial('u8', ['1', '4']);
  const body = last.response.slice(4);
  assert.ok(body.length <= USSD_MAX);
  const full = (await engine.handle({ sessionId: 'x', channel: 'api', lang: 'fr', text: 'historique' })).reply.text;
  for (const line of body.split('\n').filter((l) => !l.startsWith('98.'))) assert.ok(full.includes(line), `ligne modifiée : ${line}`);
});

test('USSD : un historique long est réparti sur plusieurs écrans ≤ 182, sans altérer une ligne', async () => {
  for (let i = 0; i < 2; i++) { await engine.handle({ sessionId: 'h', channel: 'api', lang: 'fr', text: 'envoie 1000 a Marie' }); await engine.handle({ sessionId: 'h', channel: 'api', lang: 'fr', text: 'oui' }); }
  const full = (await engine.handle({ sessionId: 'x', channel: 'api', lang: 'fr', text: 'historique' })).reply.text;
  const { screens } = await dial('u10', ['1', '4', '98', '98', '98']);
  const pages = screens.slice(2).filter((s, i, a) => a.indexOf(s) === i && !s.includes('Choisissez'));
  assert.ok(pages.length >= 2, 'devrait être paginé');
  assert.match(pages.at(-1)!, /^END /);
  for (const pg of pages) {
    assert.ok(pg.length - 4 <= USSD_MAX, `écran trop long : ${pg.length}`);
    for (const line of pg.slice(4).split('\n').filter((l) => !l.startsWith('98.'))) assert.ok(full.includes(line.replace(/\.$/, '').replace(/ :$/, '')), `ligne modifiée : ${line}`);
  }
});

test('USSD : la confirmation garde « 1 » et « 2 » sur le même écran, même en ewondo', async () => {
  const { screens } = await dial('u11', ['3', '2', '5000', 'Marie']);
  assert.match(screens.at(-1)!, /\n1\. .*\n2\. /s);
  assert.ok(!screens.at(-1)!.includes('98.'));
});

test('SMS : transfert en deux SMS, confirmation par « 1 », langue mémorisée par numéro', async () => {
  const a = await sms.handle({ from: '+237 677 00 00 00', text: 'send 3000 to Aminatou', lang: 'en' });
  assert.equal(a.result.status, 'awaiting_confirmation');
  assert.match(a.reply, /Reply 1 : /);
  const b = await sms.handle({ from: '+237677000000', text: '1' });
  assert.equal(b.result.lang, 'en');
  assert.equal(b.result.status, 'executed');
  assert.equal(b.result.transaction?.amount, 3000);
});

test('Cohérence multicanale : la même demande donne la même intention et les mêmes paramètres partout', async () => {
  const text = 'envoie 5000 a Marie';
  const web = await engine.handle({ sessionId: 'w', channel: 'web', lang: 'fr', text });
  const mob = await engine.handle({ sessionId: 'm', channel: 'mobile', lang: 'fr', text });
  const s = (await sms.handle({ from: '690000000', text, lang: 'fr' })).result;
  const u = (await dial('u9', ['1', text])).last.result!;
  for (const r of [mob, s, u]) {
    assert.equal(r.intent, web.intent);
    assert.deepEqual(r.params, web.params);
    assert.equal(r.status, web.status);
  }
  assert.deepEqual(new Set([web.channel, mob.channel, s.channel, u.channel]), new Set(['web', 'mobile', 'sms', 'ussd']));
});
