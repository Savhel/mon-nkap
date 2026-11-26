// SDK navigateur / client JS Mon Nkap : une application web ou bancaire appelle le moteur commun.
//   <script src="https://<serveur>/sdk.js"></script>
//   const ct = MonNkap.connect('https://<serveur>', { apiKey: 'nk_live_…', channel: 'web', lang: 'ewo' });
//   const r = await ct.message('envoie 5000 a Marie');   // r.reply.text, r.reply.menu, r.intent, r.params…
//   const tr = await ct.translate('Votre solde', 'ewo'); // { text, quality, accepted, source }
//   const v = await ct.voice(blobAudio);                 // { transcript, result }
//   await ct.confirm(r.canonical.confirmationToken);     // exécute l'opération présentée (jeton à usage unique)
// En production navigateur, privilégier un relais côté backend bancaire pour garder la clé secrète côté serveur.
(function (g) {
  function connect(base, opts) {
    opts = opts || {};
    var url = String(base || '').replace(/\/$/, '');
    var session = opts.sessionId || 'sdk-' + Math.random().toString(36).slice(2, 10);
    var channel = opts.channel || 'web';
    var lang = opts.lang || 'fr';
    var apiKey = opts.apiKey || '';
    async function call(path, init) {
      init = init || {};
      var headers = Object.assign({}, init.headers || {});
      if (apiKey) headers['x-api-key'] = apiKey;
      var res = await fetch(url + path, Object.assign({}, init, { headers: headers }));
      var data = await res.json();
      if (!res.ok || data.error) throw new Error(data.message || data.error || ('HTTP ' + res.status));
      return data;
    }
    return {
      get sessionId() { return session; },
      setLang: function (l) { lang = l; },
      setApiKey: function (k) { apiKey = k || ''; },
      message: async function (text) {
        var r = await call('/v1/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session, channel: channel, lang: lang, text: text, userPhone: opts.userPhone, trial: opts.trial }) });
        lang = r.lang; // le moteur peut changer de langue en cours de conversation
        return r;
      },
      voice: async function (blob, opts) {
        var q = new URLSearchParams({ sessionId: session, channel: channel, lang: lang });
        if (opts && opts.transcribeOnly) q.set('mode', 'transcribe');
        var r = await call('/v1/voice?' + q, { method: 'POST', body: blob });
        if (r.result) lang = r.result.lang;
        return r;
      },
      /** Confirme l'opération présentée, avec le jeton reçu (result.canonical.confirmationToken). */
      confirm: async function (token) {
        return call('/v1/confirm', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'confirm-' + token }, body: JSON.stringify({ sessionId: session, token: token, channel: channel, userPhone: opts.userPhone, trial: opts.trial }) });
      },
      /** Analyse sans dialogue ni exécution : représentation canonique d'une phrase. */
      analyze: async function (text) {
        return call('/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text, lang: lang, channel: channel }) });
      },
      /** Traduit un texte ou une liste de textes vers une langue cible via le serveur. */
      translate: async function (text, to, from, translateOpts) {
        var payload = Array.isArray(text) ? { texts: text } : { text: text };
        payload.to = to || lang;
        if (from) payload.from = from;
        if (translateOpts && typeof translateOpts.allowDraft === 'boolean') payload.allowDraft = translateOpts.allowDraft;
        return call('/v1/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      },
      speech: async function (turn) {
        var headers = { 'content-type': 'application/json' };
        if (apiKey) headers['x-api-key'] = apiKey;
        var res = await fetch(url + '/v1/tts/plotweaver', {
          method: 'POST', headers: headers, body: JSON.stringify({ at: turn.at, sessionId: turn.sessionId }),
        });
        return res.ok ? res.blob() : null;
      },
      languages: function () { return call('/v1/languages'); },
      /** Libellés d'interface dans la langue (menu_balance, menu_transfer…), avec leur qualité. */
      labels: function (l) { return call('/v1/labels?lang=' + encodeURIComponent(l || lang)); },
      reset: function () { session = 'sdk-' + Math.random().toString(36).slice(2, 10); },
    };
  }
  function demoLanguages(registry) {
    var languages = registry.languages || [];
    if (!registry.demoLanguages) return languages.filter(function (l) { return l.capabilities?.understanding?.status !== 'unavailable'; });
    return registry.demoLanguages.map(function (code) {
      return languages.find(function (language) { return language.code === code; });
    }).filter(Boolean);
  }
  var bankingLabels = {
    reference: 'Assistant bancaire', collected: 'Collecte native · brouillon', guided: 'Parcours guidé · brouillon',
    translation: 'Traduction expérimentale', none: 'Exploration',
  };
  function languageLabel(language) {
    var experience = language.experience || {};
    var label = bankingLabels[experience.banking];
    if (experience.banking === 'none' && experience.microphone) return 'Transcription seule';
    return label || (language.capabilities?.understanding?.status === 'draft' ? 'Brouillon' : 'Texte');
  }
  g.MonNkap = { connect: connect, demoLanguages: demoLanguages, languageLabel: languageLabel };
})(typeof window !== 'undefined' ? window : globalThis);
