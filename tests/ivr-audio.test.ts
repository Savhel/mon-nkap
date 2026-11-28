import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ivrAudio } from '../src/channels/ivr-audio.ts';

test('serveur vocal SAFINUM : voix des natives quand tout est enregistré, rien en français, montant jamais inventé', () => {
  const base = 'https://exemple.trycloudflare.com';
  // Réponse entièrement enregistrée par la native fulfulde (« cancelled ») : un seul morceau, sa voix.
  assert.deepEqual(ivrAudio('fub', 'mi yidda', base, { plan: ['cancelled'], quality: 'draft' }), [{ url: `${base}/voix/fub/cancelled.mp3` }]);
  // Français, anglais ou texte resté en français : pas d'audio, SAFINUM lit le texte.
  assert.equal(ivrAudio('fr', 'Votre solde est de 5 000 FCFA.', base), undefined);
  assert.equal(ivrAudio('fub', 'Votre solde', base, { quality: 'fallback' }), undefined);
  // Sans adresse publique : rien.
  assert.equal(ivrAudio('fub', 'mi yidda', '', { plan: ['cancelled'] }), undefined);
});
